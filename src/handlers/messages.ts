import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText, type ToolSet } from "ai";
import type { Context } from "hono";
import { config } from "../config.js";
import { highlightJson } from "../server.js";
import {
  toOpenAIMessages,
  toOpenAIToolChoice,
  toOpenAITools,
} from "../converters/to-openai.js";
import { googleSearchTool } from "../tools/google-search.js";
import type {
  AnthropicRequest,
  AnthropicResponse,
  AnthropicResponseContent,
  AnthropicStopReason,
  AnthropicStreamEvent,
} from "../types/anthropic.js";

function getProvider(apiKey: string) {
  const { baseURL, authType } = config;
  if (authType === "api-key") {
    return createOpenAI({
      apiKey: "no-key",
      baseURL,
      headers: { "api-key": apiKey },
      compatibility: "compatible",
    });
  }
  return createOpenAI({ apiKey, baseURL, compatibility: "compatible" });
}

function resolveModel(requestedModel: string): string {
  return config.defaultModel || requestedModel;
}

function makeMessageId(): string {
  return `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function makeToolUseId(): string {
  return `toolu_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

function extractUpstreamError(err: unknown): { type: string; message: string; statusCode: number } {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const statusCode = typeof e.statusCode === "number" ? e.statusCode : 502;
    const data = e.data as Record<string, unknown> | undefined;
    const upstreamError = data?.error as Record<string, unknown> | undefined;
    if (upstreamError) {
      return {
        type: typeof upstreamError.type === "string" ? upstreamError.type : "api_error",
        message: typeof upstreamError.message === "string" ? upstreamError.message : String(err),
        statusCode,
      };
    }
    const message = typeof e.message === "string" ? e.message : "Upstream error";
    return { type: "api_error", message, statusCode };
  }
  return { type: "api_error", message: "Upstream error", statusCode: 502 };
}

function mapFinishReason(
  finishReason: string,
  hasToolCalls: boolean
): AnthropicStopReason {
  if (hasToolCalls || finishReason === "tool-calls") return "tool_use";
  if (finishReason === "length") return "max_tokens";
  if (finishReason === "stop") return "end_turn";
  return "end_turn";
}

// SSE ヘルパー
function sseEvent(event: AnthropicStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function handleMessages(c: Context): Promise<Response> {
  let body: AnthropicRequest;
  try {
    body = await c.req.json<AnthropicRequest>();
  } catch {
    return c.json({ type: "error", error: { type: "invalid_request_error", message: "Invalid JSON" } }, 400);
  }

  const toolNames = body.tools?.map((t) => t.name) ?? [];
  const summary = {
    model: body.model,
    stream: body.stream ?? false,
    messages: body.messages,
    tools: toolNames.length > 0 ? toolNames : undefined,
    tool_choice: body.tool_choice,
  };
  console.log(highlightJson(JSON.stringify(summary, null, 2)));

  const apiKey = config.apiKey || c.req.header("x-api-key") || "no-key";
  const provider = getProvider(apiKey);
  const model = resolveModel(body.model);
  const messages = toOpenAIMessages(body.messages, body.system);
  const clientTools = toOpenAITools(body.tools);
  // WebSearch はクライアント定義を上書きしてサーバー側で実行する
  const tools: ToolSet = { ...clientTools, "google_search": googleSearchTool, "WebSearch": googleSearchTool };
  // サーバー側で内部処理するツール名: クライアントには公開しない
  const serverToolNames = new Set(["google_search", "WebSearch"]);
  const toolChoice = toOpenAIToolChoice(body.tool_choice);
  const msgId = makeMessageId();

  const commonParams = {
    model: provider(model),
    messages,
    maxTokens: body.max_completion_tokens,
    temperature: body.temperature,
    topP: body.top_p,
    stopSequences: body.stop_sequences,
    tools,
    ...(toolChoice ? { toolChoice } : {}),
    maxSteps: 5,
  };

  // ストリーミング
  if (body.stream) {
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const enqueue = (event: AnthropicStreamEvent) =>
          controller.enqueue(enc.encode(sseEvent(event)));

        enqueue({ type: "message_start", message: { id: msgId, type: "message", role: "assistant", content: [], model, stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
        enqueue({ type: "ping" });

        // ブロック管理: index 0 はテキスト、tool_use は連番。
        // テキストは最初の text-delta 到来時に open する。
        let textBlockIndex: number | null = null;
        let nextIndex = 0;
        // toolCallId -> { index, argsEmitted }
        const toolBlocks = new Map<string, { index: number; argsEmitted: boolean }>();
        const openBlocks = new Set<number>();
        let sawToolCall = false;

        const openTextBlock = () => {
          if (textBlockIndex !== null) return;
          textBlockIndex = nextIndex++;
          openBlocks.add(textBlockIndex);
          enqueue({
            type: "content_block_start",
            index: textBlockIndex,
            content_block: { type: "text", text: "" },
          });
        };

        try {
          const result = streamText(commonParams);

          for await (const part of result.fullStream) {
            switch (part.type) {
              case "text-delta": {
                openTextBlock();
                enqueue({
                  type: "content_block_delta",
                  index: textBlockIndex!,
                  delta: { type: "text_delta", text: part.textDelta },
                });
                break;
              }
              case "tool-call-streaming-start": {
                // サーバー側ツールは内部実行のためクライアントに公開しない
                if (serverToolNames.has(part.toolName)) break;
                sawToolCall = true;
                const id = part.toolCallId;
                if (!toolBlocks.has(id)) {
                  const index = nextIndex++;
                  toolBlocks.set(id, { index, argsEmitted: false });
                  openBlocks.add(index);
                  enqueue({
                    type: "content_block_start",
                    index,
                    content_block: {
                      type: "tool_use",
                      id,
                      name: part.toolName,
                      input: {},
                    },
                  });
                }
                break;
              }
              case "tool-call-delta": {
                if (serverToolNames.has(part.toolName)) break;
                sawToolCall = true;
                const id = part.toolCallId;
                let entry = toolBlocks.get(id);
                if (!entry) {
                  const index = nextIndex++;
                  entry = { index, argsEmitted: false };
                  toolBlocks.set(id, entry);
                  openBlocks.add(index);
                  enqueue({
                    type: "content_block_start",
                    index,
                    content_block: {
                      type: "tool_use",
                      id,
                      name: part.toolName,
                      input: {},
                    },
                  });
                }
                if (part.argsTextDelta) {
                  entry.argsEmitted = true;
                  enqueue({
                    type: "content_block_delta",
                    index: entry.index,
                    delta: { type: "input_json_delta", partial_json: part.argsTextDelta },
                  });
                }
                break;
              }
              case "tool-call": {
                if (serverToolNames.has(part.toolName)) break;
                sawToolCall = true;
                const id = part.toolCallId;
                let entry = toolBlocks.get(id);
                if (!entry) {
                  // ストリーミング非対応のプロバイダー: 一括で生成
                  const index = nextIndex++;
                  entry = { index, argsEmitted: false };
                  toolBlocks.set(id, entry);
                  openBlocks.add(index);
                  enqueue({
                    type: "content_block_start",
                    index,
                    content_block: {
                      type: "tool_use",
                      id,
                      name: part.toolName,
                      input: {},
                    },
                  });
                }
                if (!entry.argsEmitted) {
                  enqueue({
                    type: "content_block_delta",
                    index: entry.index,
                    delta: {
                      type: "input_json_delta",
                      partial_json: JSON.stringify(part.args ?? {}),
                    },
                  });
                  entry.argsEmitted = true;
                }
                break;
              }
              case "error": {
                console.error("[stream] upstream error:", part.error);
                throw part.error;
              }
              default:
                break;
            }
          }

          for (const index of openBlocks) {
            enqueue({ type: "content_block_stop", index });
          }

          const usage = await result.usage;
          const outputTokens = usage?.completionTokens ?? 0;
          const finishReason = await result.finishReason;
          const stopReason = mapFinishReason(finishReason, sawToolCall);

          enqueue({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } });
          enqueue({ type: "message_stop" });
        } catch (err) {
          console.error("[stream] upstream error:", err);
          const { type, message } = extractUpstreamError(err);
          controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type, message } })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // 非ストリーミング
  try {
    const result = await generateText(commonParams);
    // サーバー側ツールは内部実行済みのためクライアントには返さない
    const toolCalls = (result.toolCalls ?? []).filter(c => !serverToolNames.has(c.toolName));
    const hasToolCalls = toolCalls.length > 0;
    const stopReason = mapFinishReason(result.finishReason, hasToolCalls);

    const content: AnthropicResponseContent[] = [];
    if (result.text) {
      content.push({ type: "text", text: result.text });
    }
    for (const call of toolCalls) {
      content.push({
        type: "tool_use",
        id: call.toolCallId || makeToolUseId(),
        name: call.toolName,
        input: call.args ?? {},
      });
    }

    const response: AnthropicResponse = {
      id: msgId,
      type: "message",
      role: "assistant",
      content,
      model,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: result.usage.promptTokens,
        output_tokens: result.usage.completionTokens,
      },
    };

    return c.json(response);
  } catch (err) {
    console.error("[non-stream] upstream error:", err);
    const { type, message, statusCode } = extractUpstreamError(err);
    return c.json({ type: "error", error: { type, message } }, statusCode as 400 | 401 | 403 | 404 | 429 | 500 | 502);
  }
}
