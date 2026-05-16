import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, streamText, type LanguageModelV1, type ToolSet } from "ai";
import type { Context } from "hono";
import { config } from "../config.js";
import { highlightJson } from "../server.js";
import { filterSystemForNonClaudeModel, toMessages, toToolChoice } from "../converters/shared.js";
import { toChatCompletionsTools } from "../converters/to-chat-completions.js";
import { toGeminiTools } from "../converters/to-gemini.js";
import { googleSearchTool } from "../tools/google-search.js";
import type {
  AnthropicRequest,
  AnthropicResponse,
  AnthropicResponseContent,
  AnthropicStopReason,
  AnthropicStreamEvent,
} from "../types/anthropic.js";

function isGoogleProvider(providerName: string): boolean {
  return providerName === "google" || providerName === "gemini";
}

function getProvider(apiKey: string) {
  const { baseURL, customBaseURL, authType, providerName } = config;
  if (isGoogleProvider(providerName)) {
    return createGoogleGenerativeAI({ apiKey, ...(customBaseURL ? { baseURL: customBaseURL } : {}) });
  }
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

function stripEmptyStringValues(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return (args ?? {}) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (value !== "") result[key] = value;
  }
  return result;
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

  const apiKey = config.apiKey || c.req.header("x-api-key") || "no-key";
  const provider = getProvider(apiKey);
  const model = resolveModel(body.model);

  const toolNames = body.tools?.map((t) => t.name) ?? [];
  const summary: Record<string, unknown> = {
    model,
    stream: body.stream ?? false,
    messages: body.messages,
    tools: toolNames.length > 0 ? toolNames : undefined,
    tool_choice: body.tool_choice,
  };
  if (config.defaultModel && config.defaultModel !== body.model) {
    summary["model_requested"] = body.model;
  }
  console.log(highlightJson(JSON.stringify(summary, null, 2)));
  const system = body.system != null && !model.toLowerCase().includes("claude")
    ? filterSystemForNonClaudeModel(body.system, model)
    : body.system;
  const messages = toMessages(body.messages, system, {
    flattenToolHistory: isGoogleProvider(config.providerName),
  });
  const clientTools = isGoogleProvider(config.providerName)
    ? toGeminiTools(body.tools)
    : toChatCompletionsTools(body.tools);
  // WebSearch はクライアント定義を上書きしてサーバー側で実行する
  const tools: ToolSet = { ...clientTools, "google_search": googleSearchTool, "WebSearch": googleSearchTool };
  // サーバー側で内部処理するツール名: クライアントには公開しない
  const serverToolNames = new Set(["google_search", "WebSearch"]);
  // サーバー側ツールを指定した tool_choice は全ステップに伝播して無限ループになるため無視する
  const isServerToolChoice =
    body.tool_choice != null &&
    typeof body.tool_choice === "object" &&
    "name" in body.tool_choice &&
    serverToolNames.has((body.tool_choice as { name: string }).name);
  const toolChoice = isServerToolChoice ? undefined : toToolChoice(body.tool_choice);
  const msgId = makeMessageId();

  const commonParams = {
    model: provider(model) as LanguageModelV1,
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
                // args は tool-call イベントでフィルタリング後に一括送出するためここでは emit しない
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
                      partial_json: JSON.stringify(stripEmptyStringValues(part.args)),
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
          const enriched = config.defaultModel ? `[upstream model: ${model}] ${message}` : message;
          controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type, message: enriched } })}\n\n`));
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
        input: stripEmptyStringValues(call.args),
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
    const enriched = config.defaultModel ? `[upstream model: ${model}] ${message}` : message;
    return c.json({ type: "error", error: { type, message: enriched } }, statusCode as 400 | 401 | 403 | 404 | 429 | 500 | 502);
  }
}
