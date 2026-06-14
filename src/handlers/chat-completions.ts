import { generateText, streamText, type ToolSet } from "ai";
import type { Context } from "hono";
import { config } from "../config.js";
import { highlightJson } from "../server.js";
import { filterSystemForNonClaudeModel, toMessages, toToolChoice } from "../converters/shared.js";
import { toGeminiTools } from "../converters/to-gemini.js";
import {
  chatMessagesToAnthropic,
  chatToolsToAnthropic,
  chatToolChoiceToAnthropic,
} from "../converters/from-chat-completions.js";
import { googleSearchTool } from "../tools/google-search.js";
import { startLog, finishLog, type LogEntry, type LogToolCall } from "../log-store.js";
import {
  isGoogleProvider,
  getProvider,
  resolveModel,
  getLanguageModel,
  stripEmptyStringValues,
  extractUpstreamError,
  makeId,
} from "./provider.js";
import type {
  ChatCompletionsRequest,
  ChatCompletionChunk,
  ChatCompletionChunkChoice,
  ChatCompletionResponse,
  ChatCompletionUsage,
  ChatFinishReason,
  ChatToolCall,
} from "../types/openai-chat.js";

// Vercel AI SDK の finishReason を Chat Completions の finish_reason へマップする
function mapChatFinish(finishReason: string, hasToolCalls: boolean): ChatFinishReason {
  if (hasToolCalls || finishReason === "tool-calls") return "tool_calls";
  if (finishReason === "length") return "length";
  return "stop";
}

export async function handleChatCompletions(c: Context): Promise<Response> {
  let body: ChatCompletionsRequest;
  try {
    body = await c.req.json<ChatCompletionsRequest>();
  } catch {
    return c.json({ error: { message: "Invalid JSON", type: "invalid_request_error" } }, 400);
  }

  const apiKey =
    config.apiKey !== ""
      ? config.apiKey
      : (c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? c.req.header("x-api-key") ?? "");

  const requestedModel = body.model;
  const model = resolveModel(body.model);
  // --model / CHAT_DEFAULT_MODEL の強制指定。パススルー時もボディの model を書き換える
  body.model = model;

  const passthrough = !isGoogleProvider(config.providerName);
  const toolNames = (body.tools ?? []).map((t) => t?.function?.name).filter(Boolean);
  const summary: Record<string, unknown> = {
    endpoint: "/v1/chat/completions",
    mode: passthrough ? "passthrough" : "convert",
    model,
    stream: body.stream ?? false,
    messages: body.messages?.length ?? 0,
    tools: toolNames.length > 0 ? toolNames : undefined,
    tool_choice: body.tool_choice,
  };
  if (config.defaultModel && config.defaultModel !== requestedModel) {
    summary["model_requested"] = requestedModel;
  }
  console.log(highlightJson(JSON.stringify(summary, null, 2)));

  const logEntry = startLog({
    endpoint: "/v1/chat/completions",
    provider: config.providerName,
    model,
    modelRequested: config.defaultModel && config.defaultModel !== requestedModel ? requestedModel : undefined,
    stream: body.stream ?? false,
    request: { messages: body.messages, tools: toolNames.length > 0 ? toolNames : undefined, tool_choice: body.tool_choice },
  });

  if (passthrough) {
    return handlePassthrough(body, apiKey, logEntry);
  }
  return handleViaConversion(c, body, apiKey, model, logEntry);
}

// パススルー応答 (SSE) をバックグラウンドで読み取り、トークン数・本文をログへ記録する。
async function consumePassthroughSSE(stream: ReadableStream<Uint8Array>, logEntry: LogEntry): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  const toolAcc = new Map<number, { name: string; args: string }>();
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "" || payload === "[DONE]") continue;
        let obj: Record<string, unknown>;
        try { obj = JSON.parse(payload); } catch { continue; }
        const u = obj.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
        if (u) usage = u;
        const choice = (obj.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = choice?.delta as { content?: string; tool_calls?: Array<Record<string, unknown>> } | undefined;
        if (typeof delta?.content === "string") text += delta.content;
        if (Array.isArray(delta?.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = typeof tc.index === "number" ? tc.index : 0;
            let entry = toolAcc.get(idx);
            if (!entry) { entry = { name: "", args: "" }; toolAcc.set(idx, entry); }
            const fn = tc.function as { name?: string; arguments?: string } | undefined;
            if (fn?.name) entry.name = fn.name;
            if (fn?.arguments) entry.args += fn.arguments;
          }
        }
      }
    }
  } catch {
    // ログ用途のため、ストリーム解析中のエラーは無視する
  }
  const toolCalls: LogToolCall[] = [...toolAcc.values()].filter((t) => t.name).map((t) => ({ name: t.name, arguments: t.args }));
  finishLog(logEntry, {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    response: { text: text || undefined, toolCalls: toolCalls.length > 0 ? toolCalls : undefined },
  });
}

// パススルー応答 (非ストリーム JSON) を解析してログへ記録する。
function logPassthroughJson(text: string, ok: boolean, logEntry: LogEntry): void {
  let parsed: Record<string, unknown> | undefined;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  if (!ok) {
    const err = parsed?.error as { message?: string } | undefined;
    finishLog(logEntry, { error: err?.message ?? text.slice(0, 500) });
    return;
  }
  if (!parsed) {
    finishLog(logEntry, {});
    return;
  }
  const usage = parsed.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  const choice = (parsed.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const msg = choice?.message as { content?: unknown; tool_calls?: Array<Record<string, unknown>> } | undefined;
  const toolCalls: LogToolCall[] = Array.isArray(msg?.tool_calls)
    ? msg!.tool_calls.map((tc) => {
        const fn = tc.function as { name?: string; arguments?: string } | undefined;
        return { name: fn?.name ?? "", arguments: fn?.arguments ?? "" };
      })
    : [];
  finishLog(logEntry, {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    response: {
      text: typeof msg?.content === "string" ? msg.content : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    },
  });
}

// OpenAI 系プロバイダー。新しいモデルは max_tokens を拒否し max_completion_tokens を要求する
const OPENAI_FAMILY_PROVIDERS = new Set(["openai", "responses", "azure"]);

// OpenAI 系の上流向けに max_tokens を max_completion_tokens へ正規化する。
// パススルーは原則無加工だが、OpenAI の新しいモデルが max_tokens を拒否するための例外。
function normalizeMaxTokensForOpenAI(body: ChatCompletionsRequest): void {
  if (!OPENAI_FAMILY_PROVIDERS.has(config.providerName)) return;
  if (body.max_tokens != null && body.max_completion_tokens == null) {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
  }
}

// Chat Completions 互換の上流へリクエストをそのまま転送する
async function handlePassthrough(body: ChatCompletionsRequest, apiKey: string, logEntry: LogEntry): Promise<Response> {
  normalizeMaxTokensForOpenAI(body);
  const url = `${config.baseURL.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    if (config.authType === "api-key") headers["api-key"] = apiKey;
    else headers["Authorization"] = `Bearer ${apiKey}`;
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (err) {
    console.error("[chat passthrough] upstream fetch error:", err);
    const message = `Upstream request failed: ${(err as Error).message}`;
    finishLog(logEntry, { error: message });
    return new Response(
      JSON.stringify({ error: { message, type: "api_error" } }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const respHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) respHeaders.set("Content-Type", contentType);

  // SSE ストリーム: tee で 1 本をクライアントへ返し、もう 1 本をログ用に読み取る
  if (body.stream && upstream.body) {
    respHeaders.set("Cache-Control", "no-cache");
    respHeaders.set("Connection", "keep-alive");
    const [toClient, toLog] = upstream.body.tee();
    void consumePassthroughSSE(toLog, logEntry);
    return new Response(toClient, { status: upstream.status, headers: respHeaders });
  }

  // 非ストリーム JSON: 本文をバッファしてログへ記録しつつ、そのままクライアントへ返す
  const text = await upstream.text();
  logPassthroughJson(text, upstream.ok, logEntry);
  return new Response(text, { status: upstream.status, headers: respHeaders });
}

function buildConversionParams(body: ChatCompletionsRequest, apiKey: string, model: string) {
  const provider = getProvider(apiKey);
  const { system, messages: anthropicMessages } = chatMessagesToAnthropic(body.messages ?? []);
  const filteredSystem =
    system && !model.toLowerCase().includes("claude")
      ? filterSystemForNonClaudeModel(system, model)
      : system;
  // 変換パスは Gemini 専用のためツール履歴をテキストへ平坦化する
  const messages = toMessages(anthropicMessages, filteredSystem, { flattenToolHistory: true });

  const clientTools = toGeminiTools(chatToolsToAnthropic(body.tools));
  const serverToolNames = new Set<string>();
  const tools: ToolSet = { ...(clientTools ?? {}) };
  if (!config.noSearch) {
    tools["google_search"] = googleSearchTool;
    tools["WebSearch"] = googleSearchTool;
    serverToolNames.add("google_search");
    serverToolNames.add("WebSearch");
  }

  const anthropicChoice = chatToolChoiceToAnthropic(body.tool_choice);
  const isServerToolChoice = anthropicChoice?.type === "tool" && serverToolNames.has(anthropicChoice.name);
  const toolChoice = isServerToolChoice ? undefined : toToolChoice(anthropicChoice);

  const languageModel = getLanguageModel(provider, model);
  const stopSequences = body.stop ? (typeof body.stop === "string" ? [body.stop] : body.stop) : undefined;

  return {
    serverToolNames,
    commonParams: {
      model: languageModel,
      messages,
      maxTokens: body.max_tokens ?? body.max_completion_tokens,
      temperature: body.temperature,
      topP: body.top_p,
      stopSequences,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      ...(toolChoice ? { toolChoice } : {}),
      maxSteps: 5,
    } satisfies Parameters<typeof streamText>[0],
  };
}

// Gemini など Chat Completions 非互換の上流へ AI SDK 経由で転送し、
// 出力を Chat Completions 形式へ再シリアライズする
async function handleViaConversion(
  c: Context,
  body: ChatCompletionsRequest,
  apiKey: string,
  model: string,
  logEntry: LogEntry
): Promise<Response> {
  const { serverToolNames, commonParams } = buildConversionParams(body, apiKey, model);
  const id = makeId("chatcmpl-");
  const created = Math.floor(Date.now() / 1000);

  // ストリーミング
  if (body.stream) {
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const chunk = (choices: ChatCompletionChunkChoice[], usage?: ChatCompletionUsage): ChatCompletionChunk => ({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices,
          ...(usage ? { usage } : {}),
        });
        const send = (ev: ChatCompletionChunk) => controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));

        let roleSent = false;
        let sawToolCall = false;
        let loggedText = "";
        const loggedToolCalls: LogToolCall[] = [];
        const ensureRole = () => {
          if (roleSent) return;
          send(chunk([{ index: 0, delta: { role: "assistant" }, finish_reason: null }]));
          roleSent = true;
        };

        // toolCallId -> { index, argsEmitted }。start チャンク (id + name) を一度だけ送る
        const toolEntries = new Map<string, { index: number; argsEmitted: boolean }>();
        let nextToolIndex = 0;
        const ensureToolStart = (toolCallId: string, toolName: string) => {
          let entry = toolEntries.get(toolCallId);
          if (!entry) {
            const index = nextToolIndex++;
            entry = { index, argsEmitted: false };
            toolEntries.set(toolCallId, entry);
            send(chunk([{
              index: 0,
              delta: { tool_calls: [{ index, id: toolCallId, type: "function", function: { name: toolName, arguments: "" } }] },
              finish_reason: null,
            }]));
          }
          return entry;
        };

        try {
          const result = streamText(commonParams);

          for await (const part of result.fullStream) {
            switch (part.type) {
              case "text-delta": {
                ensureRole();
                loggedText += part.textDelta;
                send(chunk([{ index: 0, delta: { content: part.textDelta }, finish_reason: null }]));
                break;
              }
              case "tool-call-streaming-start": {
                if (serverToolNames.has(part.toolName)) break;
                sawToolCall = true;
                ensureRole();
                ensureToolStart(part.toolCallId, part.toolName);
                break;
              }
              // 引数は tool-call イベントでフィルタ後に一括送出するため delta は送らない
              case "tool-call-delta": {
                if (serverToolNames.has(part.toolName)) break;
                sawToolCall = true;
                break;
              }
              case "tool-call": {
                if (serverToolNames.has(part.toolName)) break;
                sawToolCall = true;
                ensureRole();
                const entry = ensureToolStart(part.toolCallId, part.toolName);
                if (!entry.argsEmitted) {
                  const argsJson = JSON.stringify(stripEmptyStringValues(part.args));
                  loggedToolCalls.push({ name: part.toolName, arguments: argsJson });
                  send(chunk([{
                    index: 0,
                    delta: { tool_calls: [{ index: entry.index, function: { arguments: argsJson } }] },
                    finish_reason: null,
                  }]));
                  entry.argsEmitted = true;
                }
                break;
              }
              case "error":
                throw part.error;
              default:
                break;
            }
          }

          const usage = await result.usage;
          const finishReason = await result.finishReason;
          send(chunk([{ index: 0, delta: {}, finish_reason: mapChatFinish(finishReason, sawToolCall) }]));

          const promptTokens = usage?.promptTokens || 0;
          const completionTokens = usage?.completionTokens || 0;
          send(chunk([], {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          }));
          controller.enqueue(enc.encode("data: [DONE]\n\n"));

          finishLog(logEntry, {
            inputTokens: promptTokens,
            outputTokens: completionTokens,
            response: { text: loggedText || undefined, toolCalls: loggedToolCalls.length > 0 ? loggedToolCalls : undefined },
          });
        } catch (err) {
          console.error("[chat stream] upstream error:", err);
          const { message } = extractUpstreamError(err);
          const enriched = config.defaultModel ? `[upstream model: ${model}] ${message}` : message;
          finishLog(logEntry, { error: enriched });
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ error: { message: enriched, type: "api_error" } })}\n\n`));
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
    const toolCalls = (result.toolCalls ?? []).filter((tc) => !serverToolNames.has(tc.toolName));
    const hasToolCalls = toolCalls.length > 0;
    const ccToolCalls: ChatToolCall[] = toolCalls.map((tc) => ({
      id: tc.toolCallId || makeId("call_"),
      type: "function",
      function: { name: tc.toolName, arguments: JSON.stringify(stripEmptyStringValues(tc.args)) },
    }));

    const response: ChatCompletionResponse = {
      id,
      object: "chat.completion",
      created,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: result.text || null,
            ...(ccToolCalls.length > 0 ? { tool_calls: ccToolCalls } : {}),
          },
          finish_reason: mapChatFinish(result.finishReason, hasToolCalls),
        },
      ],
      usage: {
        prompt_tokens: result.usage.promptTokens,
        completion_tokens: result.usage.completionTokens,
        total_tokens: result.usage.promptTokens + result.usage.completionTokens,
      },
    };

    finishLog(logEntry, {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
      response: {
        text: result.text || undefined,
        toolCalls: ccToolCalls.length > 0 ? ccToolCalls.map((tc) => ({ name: tc.function.name, arguments: tc.function.arguments })) : undefined,
      },
    });

    return c.json(response);
  } catch (err) {
    console.error("[chat non-stream] upstream error:", err);
    const { message, statusCode } = extractUpstreamError(err);
    const enriched = config.defaultModel ? `[upstream model: ${model}] ${message}` : message;
    finishLog(logEntry, { error: enriched });
    return c.json(
      { error: { message: enriched, type: "api_error" } },
      statusCode as 400 | 401 | 403 | 404 | 429 | 500 | 502
    );
  }
}
