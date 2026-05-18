import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, streamText, type JSONValue, type LanguageModelV1, type ToolSet } from "ai";
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
  AnthropicThinkingConfig,
} from "../types/anthropic.js";

function isGoogleProvider(providerName: string): boolean {
  return providerName === "google" || providerName === "gemini";
}

function isResponsesProvider(providerName: string): boolean {
  return providerName === "responses";
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

// budget_tokens を OpenAI の reasoningEffort (low/medium/high) にマッピングする
function budgetToReasoningEffort(budget: number): "low" | "medium" | "high" {
  if (budget < 8192) return "low";
  if (budget < 24576) return "medium";
  return "high";
}

// Anthropic の thinking フィールドを各プロバイダーの providerOptions に変換する。
//  - Google/Gemini: thinkingConfig.thinkingBudget (トークン予算) + includeThoughts
//  - OpenAI/responses: reasoningEffort (budget_tokens から段階を導出)。responses は思考要約も有効化
function toProviderOptions(
  thinking: AnthropicThinkingConfig | undefined,
  providerName: string
): Record<string, Record<string, JSONValue>> | undefined {
  if (!thinking) return undefined;

  if (isGoogleProvider(providerName)) {
    return {
      google: {
        thinkingConfig:
          thinking.type === "enabled"
            ? { thinkingBudget: thinking.budget_tokens, includeThoughts: true }
            : { thinkingBudget: 0 },
      },
    };
  }

  if (thinking.type !== "enabled") return undefined;
  const openaiOptions: Record<string, JSONValue> = {
    reasoningEffort: budgetToReasoningEffort(thinking.budget_tokens),
  };
  if (isResponsesProvider(providerName)) {
    openaiOptions.reasoningSummary = "auto";
  }
  return { openai: openaiOptions };
}

function makeMessageId(): string {
  return `msg_${crypto.randomUUID().replace(/-/g, "")}`;
}

function makeToolUseId(): string {
  return `toolu_${crypto.randomUUID().replace(/-/g, "")}`;
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

  // サーバー側 API キーが設定済みの場合はクライアントの x-api-key を無視する
  const apiKey = config.apiKey !== "" ? config.apiKey : (c.req.header("x-api-key") ?? "");
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
  // サーバー側ツールは --no-search / NO_SEARCH=1 で無効化できる
  const serverToolNames = new Set<string>();
  const tools: ToolSet = { ...clientTools };
  if (!config.noSearch) {
    tools["google_search"] = googleSearchTool;
    tools["WebSearch"] = googleSearchTool;
    serverToolNames.add("google_search");
    serverToolNames.add("WebSearch");
  }
  // サーバー側ツールを指定した tool_choice は全ステップに伝播して無限ループになるため無視する
  const isServerToolChoice =
    body.tool_choice != null &&
    typeof body.tool_choice === "object" &&
    "name" in body.tool_choice &&
    serverToolNames.has((body.tool_choice as { name: string }).name);
  const toolChoice = isServerToolChoice ? undefined : toToolChoice(body.tool_choice);
  const msgId = makeMessageId();

  const languageModel = (
    isResponsesProvider(config.providerName)
      ? (provider as ReturnType<typeof createOpenAI>).responses(model)
      : provider(model)
  ) as LanguageModelV1;

  const providerOptions = toProviderOptions(body.thinking, config.providerName);

  const commonParams = {
    model: languageModel,
    messages,
    maxTokens: body.max_completion_tokens,
    temperature: body.temperature,
    topP: body.top_p,
    stopSequences: body.stop_sequences,
    tools,
    ...(toolChoice ? { toolChoice } : {}),
    ...(providerOptions ? { providerOptions } : {}),
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
        let thinkingBlockIndex: number | null = null;
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

        const openThinkingBlock = () => {
          if (thinkingBlockIndex !== null) return;
          thinkingBlockIndex = nextIndex++;
          openBlocks.add(thinkingBlockIndex);
          enqueue({
            type: "content_block_start",
            index: thinkingBlockIndex,
            content_block: { type: "thinking", thinking: "" },
          });
        };

        try {
          const result = streamText(commonParams);

          for await (const part of result.fullStream) {
            switch (part.type) {
              case "reasoning": {
                openThinkingBlock();
                enqueue({
                  type: "content_block_delta",
                  index: thinkingBlockIndex!,
                  delta: { type: "thinking_delta", thinking: part.textDelta },
                });
                break;
              }
              case "reasoning-signature": {
                openThinkingBlock();
                enqueue({
                  type: "content_block_delta",
                  index: thinkingBlockIndex!,
                  delta: { type: "signature_delta", signature: part.signature },
                });
                break;
              }
              case "redacted-reasoning": {
                const index = nextIndex++;
                enqueue({
                  type: "content_block_start",
                  index,
                  content_block: { type: "redacted_thinking", data: part.data },
                });
                enqueue({ type: "content_block_stop", index });
                break;
              }
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
    const reasoningDetails = (result as {
      reasoningDetails?: Array<
        | { type: "text"; text: string; signature?: string }
        | { type: "redacted"; data: string }
      >;
    }).reasoningDetails;
    if (reasoningDetails && reasoningDetails.length > 0) {
      for (const detail of reasoningDetails) {
        if (detail.type === "text") {
          content.push({
            type: "thinking",
            thinking: detail.text,
            ...(detail.signature ? { signature: detail.signature } : {}),
          });
        } else {
          content.push({ type: "redacted_thinking", data: detail.data });
        }
      }
    } else if (result.reasoning) {
      content.push({ type: "thinking", thinking: result.reasoning });
    }
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
