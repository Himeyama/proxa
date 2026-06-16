import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText, type LanguageModelV1, type ToolSet } from "ai";
import type { Context } from "hono";
import { config } from "../config.js";
import { highlightJson } from "../server.js";
import { filterMinTools, filterSystemForNonClaudeModel, finalSystemForLog, toMessages, toToolChoice } from "../converters/shared.js";
import { toChatCompletionsTools } from "../converters/to-chat-completions.js";
import { toGeminiTools } from "../converters/to-gemini.js";
import {
  geminiContentsToAnthropic,
  geminiToolsToAnthropic,
  geminiToolConfigToToolChoice,
  geminiThinkingToAnthropic,
} from "../converters/from-gemini.js";
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
import { toProviderOptions } from "./messages.js";
import type {
  GeminiRequest,
  GeminiPart,
  GeminiCandidate,
  GeminiUsageMetadata,
  GeminiResponse,
  GeminiFinishReason,
} from "../types/gemini.js";

type HttpErrorStatus = 400 | 401 | 403 | 404 | 429 | 500 | 502;

// Vercel AI SDK の finishReason を Gemini の finishReason へマップする。
// Gemini はツール呼び出しでも STOP を使うため、length のみ MAX_TOKENS とする。
function mapGeminiFinish(finishReason: string): GeminiFinishReason {
  if (finishReason === "length") return "MAX_TOKENS";
  return "STOP";
}

// Gemini 形式のエラーレスポンスを返す
function geminiError(c: Context, code: HttpErrorStatus, message: string, status = "INVALID_ARGUMENT"): Response {
  return c.json({ error: { code, message, status } }, code);
}

// model:action 形式のパスパラメータを分解する (例: gemini-2.5-flash:streamGenerateContent)
function parseModelAction(modelAction: string): { model: string; action: string } {
  const idx = modelAction.lastIndexOf(":");
  if (idx === -1) return { model: modelAction, action: "generateContent" };
  return { model: modelAction.slice(0, idx), action: modelAction.slice(idx + 1) };
}

export async function handleGenerateContent(c: Context): Promise<Response> {
  const modelAction = c.req.param("modelAction") ?? "";
  const { model: modelFromPath, action } = parseModelAction(modelAction);
  if (action !== "generateContent" && action !== "streamGenerateContent") {
    return geminiError(c, 400, `Unsupported action: "${action}". Only generateContent / streamGenerateContent are supported.`, "INVALID_ARGUMENT");
  }
  const isStream = action === "streamGenerateContent";

  let body: GeminiRequest;
  try {
    body = await c.req.json<GeminiRequest>();
  } catch {
    return geminiError(c, 400, "Invalid JSON");
  }

  // サーバー側キーが設定済みならクライアントヘッダーを無視する。
  // Gemini の正規方式 x-goog-api-key を優先し、Bearer / x-api-key / ?key= にもフォールバックする
  const apiKey =
    config.apiKey !== ""
      ? config.apiKey
      : (c.req.header("x-goog-api-key")
        ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "")
        ?? c.req.header("x-api-key")
        ?? c.req.query("key")
        ?? "");

  const cacheCapture = createCacheCapture();
  const provider = getProvider(apiKey, cacheCapture);
  const model = resolveModel(modelFromPath);
  if (!model) {
    return geminiError(
      c,
      400,
      'No model specified. Provide a model in the URL path, or start ant2chat with --model / CHAT_DEFAULT_MODEL.'
    );
  }

  // リクエスト変換 (Gemini → Anthropic 中間形式)
  const systemInstruction = body.systemInstruction ?? body.system_instruction;
  const generationConfig = body.generationConfig ?? body.generation_config;
  const toolConfig = body.toolConfig ?? body.tool_config;
  const { system: rawSystem, messages: anthropicMessages } = geminiContentsToAnthropic(body.contents, systemInstruction);
  // --min 指定時は最小構成のツールのみ転送する (送信前にクライアントツールを除外)
  const anthropicTools = filterMinTools(geminiToolsToAnthropic(body.tools));
  const anthropicChoice = geminiToolConfigToToolChoice(toolConfig);
  const thinking = geminiThinkingToAnthropic(generationConfig);
  const includeThoughts = generationConfig?.thinkingConfig?.includeThoughts === true;

  const system = rawSystem != null && !model.toLowerCase().includes("claude")
    ? filterSystemForNonClaudeModel(rawSystem, model)
    : rawSystem;
  const messages = toMessages(anthropicMessages, system, {
    flattenToolHistory: isGoogleProvider(config.providerName),
  });

  const clientTools = isGoogleProvider(config.providerName)
    ? toGeminiTools(anthropicTools)
    : toChatCompletionsTools(anthropicTools);
  const serverToolNames = new Set<string>();
  const tools: ToolSet = { ...(clientTools ?? {}) };
  if (!config.noSearch) {
    tools["google_search"] = googleSearchTool;
    tools["WebSearch"] = googleSearchTool;
    serverToolNames.add("google_search");
    serverToolNames.add("WebSearch");
  }
  // サーバー側ツールを指定した tool_choice は無限ループになるため無視する
  const isServerToolChoice =
    anthropicChoice?.type === "tool" && serverToolNames.has(anthropicChoice.name);
  const toolChoice = isServerToolChoice ? undefined : toToolChoice(anthropicChoice);

  const toolNames = anthropicTools?.map((t) => t.name) ?? [];
  const summary: Record<string, unknown> = {
    endpoint: `/v1beta/models/:${action}`,
    model,
    stream: isStream,
    messages: anthropicMessages.length,
    tools: toolNames.length > 0 ? toolNames : undefined,
    tool_choice: anthropicChoice,
  };
  if (config.defaultModel && config.defaultModel !== modelFromPath) {
    summary["model_requested"] = modelFromPath;
  }
  console.log(highlightJson(JSON.stringify(summary, null, 2)));

  const logEntry = startLog({
    endpoint: `/v1beta/models/:${action}`,
    provider: config.providerName,
    model,
    modelRequested: config.defaultModel && config.defaultModel !== modelFromPath ? modelFromPath : undefined,
    stream: isStream,
    request: { system: finalSystemForLog(system), messages: anthropicMessages, tools: toolNames.length > 0 ? toolNames : undefined, tool_choice: anthropicChoice },
    headers: redactHeaders(c.req.header()),
  });

  const languageModel = (
    isResponsesProvider(config.providerName)
      ? (provider as ReturnType<typeof createOpenAI>).responses(model)
      : provider(model)
  ) as LanguageModelV1;

  const providerOptions = toProviderOptions(thinking, config.providerName);
  const stopSequences = generationConfig?.stopSequences;

  const commonParams = {
    model: languageModel,
    messages,
    maxTokens: generationConfig?.maxOutputTokens,
    temperature: generationConfig?.temperature,
    topP: generationConfig?.topP,
    stopSequences: stopSequences && stopSequences.length > 0 ? stopSequences : undefined,
    tools: Object.keys(tools).length > 0 ? tools : undefined,
    ...(toolChoice ? { toolChoice } : {}),
    ...(providerOptions ? { providerOptions } : {}),
    maxSteps: 5,
  } satisfies Parameters<typeof streamText>[0];

  // ストリーミング (streamGenerateContent)。SSE で Gemini チャンクを順次送出する
  if (isStream) {
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const sendParts = (parts: GeminiPart[]) => {
          const resp: GeminiResponse = { candidates: [{ content: { role: "model", parts }, index: 0 }] };
          controller.enqueue(enc.encode(`data: ${JSON.stringify(resp)}\n\n`));
        };

        let sawToolCall = false;
        let loggedText = "";
        const loggedToolCalls: LogToolCall[] = [];
        // toolCallId -> args 送出済みフラグ (フィルタ後に一括送出)
        const emittedTools = new Set<string>();

        try {
          const result = streamText(commonParams);

          for await (const part of result.fullStream) {
            switch (part.type) {
              case "reasoning": {
                if (includeThoughts && part.textDelta) sendParts([{ text: part.textDelta, thought: true }]);
                break;
              }
              case "text-delta": {
                loggedText += part.textDelta;
                sendParts([{ text: part.textDelta }]);
                break;
              }
              case "tool-call": {
                if (serverToolNames.has(part.toolName)) break;
                sawToolCall = true;
                if (emittedTools.has(part.toolCallId)) break;
                emittedTools.add(part.toolCallId);
                const args = stripEmptyStringValues(part.args);
                loggedToolCalls.push({ name: part.toolName, arguments: JSON.stringify(args) });
                sendParts([{ functionCall: { name: part.toolName, args } }]);
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
          const promptTokens = usage?.promptTokens ?? 0;
          const completionTokens = usage?.completionTokens ?? 0;
          const { inputCacheTokens, outputCacheTokens } = await resolveCacheTokens(await result.providerMetadata, cacheCapture);

          const usageMetadata: GeminiUsageMetadata = {
            promptTokenCount: promptTokens,
            candidatesTokenCount: completionTokens,
            totalTokenCount: promptTokens + completionTokens,
            ...(inputCacheTokens > 0 ? { cachedContentTokenCount: inputCacheTokens } : {}),
          };
          const finalCandidate: GeminiCandidate = {
            content: { role: "model", parts: [] },
            finishReason: mapGeminiFinish(finishReason),
            index: 0,
          };
          const finalResp: GeminiResponse = { candidates: [finalCandidate], usageMetadata, modelVersion: model };
          controller.enqueue(enc.encode(`data: ${JSON.stringify(finalResp)}\n\n`));

          finishLog(logEntry, {
            inputTokens: promptTokens,
            inputCacheTokens,
            outputCacheTokens,
            outputTokens: completionTokens,
            response: {
              text: loggedText || undefined,
              toolCalls: loggedToolCalls.length > 0 ? loggedToolCalls : undefined,
              stopReason: mapGeminiFinish(finishReason),
            },
          });
        } catch (err) {
          console.error("[gemini stream] upstream error:", err);
          const { message } = extractUpstreamError(err);
          const enriched = config.defaultModel ? `[upstream model: ${model}] ${message}` : message;
          finishLog(logEntry, { error: enriched });
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ error: { code: 500, message: enriched, status: "INTERNAL" } })}\n\n`));
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

  // 非ストリーミング (generateContent)
  try {
    const result = await generateText(commonParams);
    const toolCalls = (result.toolCalls ?? []).filter((tc) => !serverToolNames.has(tc.toolName));
    const stopReason = mapGeminiFinish(result.finishReason);

    const parts: GeminiPart[] = [];
    if (includeThoughts) {
      const reasoningDetails = (result as {
        reasoningDetails?: Array<{ type: "text"; text: string } | { type: "redacted"; data: string }>;
      }).reasoningDetails;
      if (reasoningDetails && reasoningDetails.length > 0) {
        for (const d of reasoningDetails) {
          if (d.type === "text" && d.text) parts.push({ text: d.text, thought: true });
        }
      } else if (result.reasoning) {
        parts.push({ text: result.reasoning, thought: true });
      }
    }
    if (result.text) parts.push({ text: result.text });
    for (const call of toolCalls) {
      parts.push({ functionCall: { name: call.toolName, args: stripEmptyStringValues(call.args) } });
    }

    const promptTokens = result.usage.promptTokens;
    const completionTokens = result.usage.completionTokens;
    const { inputCacheTokens, outputCacheTokens } = await resolveCacheTokens(result.providerMetadata, cacheCapture);

    const usageMetadata: GeminiUsageMetadata = {
      promptTokenCount: promptTokens,
      candidatesTokenCount: completionTokens,
      totalTokenCount: promptTokens + completionTokens,
      ...(inputCacheTokens > 0 ? { cachedContentTokenCount: inputCacheTokens } : {}),
    };
    const response: GeminiResponse = {
      candidates: [
        {
          content: { role: "model", parts },
          finishReason: stopReason,
          index: 0,
        },
      ],
      usageMetadata,
      modelVersion: model,
    };

    finishLog(logEntry, {
      inputTokens: promptTokens,
      inputCacheTokens,
      outputCacheTokens,
      outputTokens: completionTokens,
      response: {
        text: result.text || undefined,
        toolCalls: toolCalls.length > 0
          ? toolCalls.map((c) => ({ name: c.toolName, arguments: JSON.stringify(stripEmptyStringValues(c.args)) }))
          : undefined,
        stopReason,
      },
    });

    return c.json(response);
  } catch (err) {
    console.error("[gemini non-stream] upstream error:", err);
    const { message, statusCode } = extractUpstreamError(err);
    const enriched = config.defaultModel ? `[upstream model: ${model}] ${message}` : message;
    finishLog(logEntry, { error: enriched });
    return c.json({ error: { code: statusCode, message: enriched, status: "INTERNAL" } }, statusCode as HttpErrorStatus);
  }
}
