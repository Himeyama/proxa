import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText, type JSONValue, type LanguageModelV1, type ToolSet } from "ai";
import type { Context } from "hono";
import { config } from "../config.js";
import { tuiLog } from "../tui-log.js";
import { filterMinTools, filterSystemForNonClaudeModel, finalSystemForLog, toMessages, toToolChoice } from "../converters/shared.js";
import { toChatCompletionsTools } from "../converters/to-chat-completions.js";
import { toGeminiTools } from "../converters/to-gemini.js";
import { buildKnownToolNames, salvageToolCallsFromText, classifyStreamStart, splitLiveToolMarker } from "../converters/salvage-tool-calls.js";
import { googleSearchTool } from "../tools/google-search.js";
import { startLog, finishLog, redactHeaders, type LogToolCall } from "../log-store.js";
import {
  isGoogleProvider,
  isResponsesProvider,
  getProvider,
  resolveModel,
  stripEmptyStringValues,
  extractUpstreamError,
  resolveCacheTokens,
  createCacheCapture,
} from "./provider.js";
import type {
  AnthropicRequest,
  AnthropicResponse,
  AnthropicResponseContent,
  AnthropicStopReason,
  AnthropicStreamEvent,
  AnthropicThinkingConfig,
} from "../types/anthropic.js";

// budget_tokens を OpenAI の reasoningEffort (low/medium/high) にマッピングする
function budgetToReasoningEffort(budget: number): "low" | "medium" | "high" {
  if (budget < 8192) return "low";
  if (budget < 24576) return "medium";
  return "high";
}

// gemini-2.5-pro 系の thinking モデルは思考をオフにできない (thinkingBudget: 0 を拒否し
// "The model does not support setting thinking_budget to 0" エラーになる)。
// flash / flash-lite 系のみ 0 を受け付ける。
function geminiSupportsDisablingThinking(model: string): boolean {
  return !/pro/i.test(model);
}

// Anthropic の thinking フィールドを各プロバイダーの providerOptions に変換する。
//  - Google/Gemini: thinkingConfig.thinkingBudget (トークン予算) + includeThoughts
//  - OpenAI/responses: reasoningEffort (budget_tokens から段階を導出)。responses は思考要約も有効化
export function toProviderOptions(
  thinking: AnthropicThinkingConfig | undefined,
  providerName: string,
  model: string
): Record<string, Record<string, JSONValue>> | undefined {
  if (!thinking) return undefined;

  if (isGoogleProvider(providerName)) {
    if (thinking.type === "enabled") {
      return {
        google: {
          thinkingConfig: { thinkingBudget: thinking.budget_tokens, includeThoughts: true },
        },
      };
    }
    // disabled: thinkingBudget 0 で思考を無効化する。ただし gemini-2.5-pro 系は 0 を
    // 受け付けないため、thinkingConfig を送らずモデル側のデフォルト (動的思考) に任せる。
    if (!geminiSupportsDisablingThinking(model)) return undefined;
    return {
      google: {
        thinkingConfig: { thinkingBudget: 0 },
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

  // サーバー側 API キーが設定済みの場合はクライアントのヘッダーを無視する。
  // Anthropic Messages API の正規方式 x-api-key を優先し、Bearer トークン方式 (ANTHROPIC_AUTH_TOKEN) にもフォールバック対応する
  const apiKey = config.apiKey !== ""
    ? config.apiKey
    : (c.req.header("x-api-key") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const cacheCapture = createCacheCapture();
  const provider = getProvider(apiKey, cacheCapture);
  const model = resolveModel(body.model);
  if (!model) {
    return c.json(
      {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: 'No model specified. Provide a "model" field in the request, or start proxa with --model / CHAT_DEFAULT_MODEL.',
        },
      },
      400
    );
  }

  // --min 指定時は最小構成のツールのみ転送する (送信前にクライアントツールを除外)
  body.tools = filterMinTools(body.tools);
  const toolNames = body.tools?.map((t) => t.name) ?? [];
  const summary: Record<string, unknown> = {
    endpoint: "/v1/messages",
    model,
    stream: body.stream ?? false,
    messages: body.messages,
    tools: toolNames.length > 0 ? toolNames : undefined,
    tool_choice: body.tool_choice,
  };
  if (config.defaultModel && config.defaultModel !== body.model) {
    summary["model_requested"] = body.model;
  }
  tuiLog.addRequest(summary);

  const system = body.system != null && !model.toLowerCase().includes("claude")
    ? filterSystemForNonClaudeModel(body.system, model)
    : body.system;

  const logEntry = startLog({
    endpoint: "/v1/messages",
    provider: config.providerName,
    model,
    modelRequested: config.defaultModel && config.defaultModel !== body.model ? body.model : undefined,
    stream: body.stream ?? false,
    // ログには行除去後 (実際に上流へ送る) の system を記録する
    request: { system: finalSystemForLog(system), messages: body.messages, tools: toolNames.length > 0 ? toolNames : undefined, tool_choice: body.tool_choice },
    headers: redactHeaders(c.req.header()),
  });

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

  // Gemini はツール呼び出しをテキスト(JSON)で出力してしまうことがあるため、
  // Google プロバイダー時のみ出力テキストからツール呼び出しを復元する
  const salvageEnabled = isGoogleProvider(config.providerName);
  const knownToolNames = buildKnownToolNames(toolNames);

  const languageModel = (
    isResponsesProvider(config.providerName)
      ? (provider as ReturnType<typeof createOpenAI>).responses(model)
      : provider(model)
  ) as LanguageModelV1;

  const providerOptions = toProviderOptions(body.thinking, config.providerName, model);

  const commonParams = {
    model: languageModel,
    messages,
    maxTokens: body.max_tokens ?? body.max_completion_tokens,
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
        let loggedText = "";
        const loggedToolCalls: LogToolCall[] = [];
        // Gemini のツール呼び出しテキスト化対策: 先頭がツール呼び出しの可能性があるテキストは
        // バッファして、ストリーム終了時に salvage で復元できるか判定する。
        // salvage 無効時 (Google 以外) は常に live でそのまま送出する。
        let textBuffer = "";
        let textMode: "undecided" | "live" | "buffer" = salvageEnabled ? "undecided" : "live";
        // live モード中、ツールマーカーの前置プレフィックスかもしれない末尾を保留するバッファ
        let liveHold = "";

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
                if (textMode === "live") {
                  // salvage 有効時は live 中でも [Tool Use:] echo の出現を監視し、
                  // 見つかったら残りを buffer へ回して salvage する
                  if (!salvageEnabled) {
                    openTextBlock();
                    loggedText += part.textDelta;
                    enqueue({
                      type: "content_block_delta",
                      index: textBlockIndex!,
                      delta: { type: "text_delta", text: part.textDelta },
                    });
                    break;
                  }
                  liveHold += part.textDelta;
                  const { emit, hold, holdIsTool } = splitLiveToolMarker(liveHold);
                  if (emit) {
                    openTextBlock();
                    loggedText += emit;
                    enqueue({
                      type: "content_block_delta",
                      index: textBlockIndex!,
                      delta: { type: "text_delta", text: emit },
                    });
                  }
                  if (holdIsTool) {
                    textMode = "buffer";
                    textBuffer = hold;
                    liveHold = "";
                  } else {
                    liveHold = hold;
                  }
                  break;
                }
                // undecided / buffer: 蓄積し、先頭の形で送出方式を決める
                textBuffer += part.textDelta;
                if (textMode === "undecided") {
                  const cls = classifyStreamStart(textBuffer);
                  if (cls === "text") {
                    textMode = "live";
                    openTextBlock();
                    loggedText += textBuffer;
                    enqueue({
                      type: "content_block_delta",
                      index: textBlockIndex!,
                      delta: { type: "text_delta", text: textBuffer },
                    });
                  } else if (cls === "tool") {
                    textMode = "buffer";
                  }
                }
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
                  const argsJson = JSON.stringify(stripEmptyStringValues(part.args));
                  loggedToolCalls.push({ name: part.toolName, arguments: argsJson });
                  enqueue({
                    type: "content_block_delta",
                    index: entry.index,
                    delta: {
                      type: "input_json_delta",
                      partial_json: argsJson,
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

          // live モードで保留した末尾 (未完のマーカープレフィックス) が残っていれば通常テキストとして送出する
          if (textMode === "live" && liveHold) {
            openTextBlock();
            loggedText += liveHold;
            enqueue({ type: "content_block_delta", index: textBlockIndex!, delta: { type: "text_delta", text: liveHold } });
            liveHold = "";
          }
          // バッファ済みテキストを確定処理する (ツール呼び出しを復元 or 通常テキストとして送出)
          if (textBuffer && textMode !== "live") {
            const salv =
              salvageEnabled && !sawToolCall
                ? salvageToolCallsFromText(textBuffer, knownToolNames)
                : { toolCalls: [], text: textBuffer };
            if (salv.toolCalls.length > 0) {
              if (salv.text) {
                openTextBlock();
                loggedText += salv.text;
                enqueue({ type: "content_block_delta", index: textBlockIndex!, delta: { type: "text_delta", text: salv.text } });
              }
              for (const call of salv.toolCalls) {
                const id = makeToolUseId();
                const index = nextIndex++;
                openBlocks.add(index);
                enqueue({ type: "content_block_start", index, content_block: { type: "tool_use", id, name: call.name, input: {} } });
                const argsJson = JSON.stringify(stripEmptyStringValues(call.args));
                loggedToolCalls.push({ name: call.name, arguments: argsJson });
                enqueue({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: argsJson } });
                sawToolCall = true;
              }
            } else {
              // ツール呼び出しではなかった: 通常テキストとして送出する
              openTextBlock();
              loggedText += textBuffer;
              enqueue({ type: "content_block_delta", index: textBlockIndex!, delta: { type: "text_delta", text: textBuffer } });
            }
          }

          for (const index of openBlocks) {
            enqueue({ type: "content_block_stop", index });
          }

          const usage = await result.usage;
          // 上流が usage を返さないと NaN になる。NaN は JSON 化で null になるため || 0 でガード
          const inputTokens = usage?.promptTokens || 0;
          const outputTokens = usage?.completionTokens || 0;
          const finishReason = await result.finishReason;
          const stopReason = mapFinishReason(finishReason, sawToolCall);
          const { inputCacheTokens, outputCacheTokens } = await resolveCacheTokens(await result.providerMetadata, cacheCapture);

          enqueue({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } });
          enqueue({ type: "message_stop" });

          finishLog(logEntry, {
            inputTokens,
            inputCacheTokens,
            outputCacheTokens,
            outputTokens,
            response: { text: loggedText || undefined, toolCalls: loggedToolCalls.length > 0 ? loggedToolCalls : undefined, stopReason },
          });
        } catch (err) {
          console.error("[stream] upstream error:", err);
          const { type, message } = extractUpstreamError(err);
          const enriched = config.defaultModel ? `[upstream model: ${model}] ${message}` : message;
          finishLog(logEntry, { error: enriched });
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

    // ネイティブのツール呼び出しが無く、テキストにツール呼び出しが紛れている場合は復元する
    let responseText = result.text;
    const salvagedCalls =
      salvageEnabled && toolCalls.length === 0 && responseText
        ? (() => {
            const s = salvageToolCallsFromText(responseText, knownToolNames);
            if (s.toolCalls.length > 0) responseText = s.text;
            return s.toolCalls;
          })()
        : [];

    const hasToolCalls = toolCalls.length > 0 || salvagedCalls.length > 0;
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
    if (responseText) {
      content.push({ type: "text", text: responseText });
    }
    for (const call of toolCalls) {
      content.push({
        type: "tool_use",
        id: call.toolCallId || makeToolUseId(),
        name: call.toolName,
        input: stripEmptyStringValues(call.args),
      });
    }
    for (const call of salvagedCalls) {
      content.push({
        type: "tool_use",
        id: makeToolUseId(),
        name: call.name,
        input: stripEmptyStringValues(call.args),
      });
    }

    // 上流が usage を返さないと NaN になる。NaN は JSON 化で null になるため || 0 でガード
    const inputTokens = result.usage.promptTokens || 0;
    const outputTokens = result.usage.completionTokens || 0;
    const response: AnthropicResponse = {
      id: msgId,
      type: "message",
      role: "assistant",
      content,
      model,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      },
    };

    const { inputCacheTokens, outputCacheTokens } = await resolveCacheTokens(result.providerMetadata, cacheCapture);
    finishLog(logEntry, {
      inputTokens,
      inputCacheTokens,
      outputCacheTokens,
      outputTokens,
      response: {
        text: responseText || undefined,
        toolCalls: hasToolCalls
          ? [
              ...toolCalls.map((c) => ({ name: c.toolName, arguments: JSON.stringify(stripEmptyStringValues(c.args)) })),
              ...salvagedCalls.map((c) => ({ name: c.name, arguments: JSON.stringify(stripEmptyStringValues(c.args)) })),
            ]
          : undefined,
        stopReason,
      },
    });

    return c.json(response);
  } catch (err) {
    console.error("[non-stream] upstream error:", err);
    const { type, message, statusCode } = extractUpstreamError(err);
    const enriched = config.defaultModel ? `[upstream model: ${model}] ${message}` : message;
    finishLog(logEntry, { error: enriched });
    return c.json({ type: "error", error: { type, message: enriched } }, statusCode as 400 | 401 | 403 | 404 | 429 | 500 | 502);
  }
}
