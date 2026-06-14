import { generateText, streamText, type ToolSet } from "ai";
import type { Context } from "hono";
import { config } from "../config.js";
import { highlightJson } from "../server.js";
import { filterSystemForNonClaudeModel } from "../converters/shared.js";
import { toMessagesFromResponses, toToolsFromResponses, toToolChoiceFromResponses } from "../converters/from-responses.js";
import { googleSearchTool } from "../tools/google-search.js";
import { startLog, finishLog, type LogEntry } from "../log-store.js";
import {
  getProvider,
  resolveModel,
  getLanguageModel,
  stripEmptyStringValues,
  extractUpstreamError,
  makeId,
} from "./provider.js";
import type {
  ResponsesRequest,
  ResponsesResponse,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseOutputFunctionCall,
  ResponseOutputTextContent,
  ResponsesStreamEvent,
} from "../types/openai-responses.js";

function sseEvent(event: ResponsesStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function makeRespId(): string { return makeId("resp_"); }
function makeMsgItemId(): string { return makeId("msg_"); }
function makeFcItemId(): string { return makeId("fc_"); }

function mapStatus(finishReason: string): ResponsesResponse["status"] {
  return finishReason === "length" ? "incomplete" : "completed";
}

export interface ResponsesParams {
  model: string;
  commonParams: Parameters<typeof streamText>[0];
  serverToolNames: Set<string>;
  respId: string;
  createdAt: number;
}

export function buildResponsesParams(body: ResponsesRequest, apiKey: string): ResponsesParams {
  const provider = getProvider(apiKey);
  const model = resolveModel(body.model);

  let instructions = body.instructions;
  if (instructions && !model.toLowerCase().includes("claude")) {
    instructions = filterSystemForNonClaudeModel(instructions, model);
  }

  const messages = toMessagesFromResponses(body.input, instructions);
  const clientTools = toToolsFromResponses(body.tools);

  const serverToolNames = new Set<string>();
  const tools: ToolSet = { ...(clientTools ?? {}) };
  if (!config.noSearch) {
    tools["google_search"] = googleSearchTool;
    tools["WebSearch"] = googleSearchTool;
    serverToolNames.add("google_search");
    serverToolNames.add("WebSearch");
  }

  const isServerToolChoice =
    body.tool_choice != null &&
    typeof body.tool_choice === "object" &&
    "name" in body.tool_choice &&
    serverToolNames.has((body.tool_choice as { name: string }).name);
  const toolChoice = isServerToolChoice ? undefined : toToolChoiceFromResponses(body.tool_choice);

  const languageModel = getLanguageModel(provider, model);
  const stopSequences = body.stop
    ? (typeof body.stop === "string" ? [body.stop] : body.stop)
    : undefined;

  return {
    model,
    serverToolNames,
    respId: makeRespId(),
    createdAt: Math.floor(Date.now() / 1000),
    commonParams: {
      model: languageModel,
      messages,
      maxTokens: body.max_output_tokens,
      temperature: body.temperature,
      topP: body.top_p,
      stopSequences,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      ...(toolChoice ? { toolChoice } : {}),
      maxSteps: 5,
    },
  };
}

export async function emitStreamingLoop(
  { model, commonParams, serverToolNames, respId, createdAt }: ResponsesParams,
  emit: (event: ResponsesStreamEvent) => void,
  logEntry?: LogEntry,
): Promise<void> {
  emit({
    type: "response.created",
    response: {
      id: respId,
      object: "response",
      created_at: createdAt,
      model,
      output: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      status: "in_progress",
      error: null,
      incomplete_details: null,
    },
  });

  let nextOutputIndex = 0;
  let textItemId: string | null = null;
  let textOutputIndex: number | null = null;
  let textAccumulated = "";

  const toolItems = new Map<string, {
    id: string;
    callId: string;
    name: string;
    outputIndex: number;
    argsText: string;
    finalArgs: string | undefined;
  }>();
  const outputItems = new Map<number, ResponseOutputItem>();

  const result = streamText(commonParams);

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta": {
        if (textItemId === null) {
          textItemId = makeMsgItemId();
          textOutputIndex = nextOutputIndex++;
          const msgItem: ResponseOutputMessage = {
            type: "message",
            id: textItemId,
            role: "assistant",
            status: "in_progress",
            content: [],
          };
          emit({ type: "response.output_item.added", output_index: textOutputIndex, item: msgItem });
          emit({
            type: "response.content_part.added",
            item_id: textItemId,
            output_index: textOutputIndex,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          });
        }
        textAccumulated += part.textDelta;
        emit({
          type: "response.output_text.delta",
          item_id: textItemId!,
          output_index: textOutputIndex!,
          content_index: 0,
          delta: part.textDelta,
        });
        break;
      }
      case "tool-call-streaming-start": {
        if (serverToolNames.has(part.toolName)) break;
        if (!toolItems.has(part.toolCallId)) {
          const fcId = makeFcItemId();
          const outputIndex = nextOutputIndex++;
          toolItems.set(part.toolCallId, { id: fcId, callId: part.toolCallId, name: part.toolName, outputIndex, argsText: "", finalArgs: undefined });
          emit({
            type: "response.output_item.added",
            output_index: outputIndex,
            item: { type: "function_call", id: fcId, call_id: part.toolCallId, name: part.toolName, arguments: "", status: "in_progress" },
          });
        }
        break;
      }
      case "tool-call-delta": {
        if (serverToolNames.has(part.toolName)) break;
        const entry = toolItems.get(part.toolCallId);
        if (!entry) break;
        entry.argsText += part.argsTextDelta;
        emit({
          type: "response.function_call_arguments.delta",
          item_id: entry.id,
          output_index: entry.outputIndex,
          delta: part.argsTextDelta,
        });
        break;
      }
      case "tool-call": {
        if (serverToolNames.has(part.toolName)) break;
        let entry = toolItems.get(part.toolCallId);
        if (!entry) {
          const fcId = makeFcItemId();
          const outputIndex = nextOutputIndex++;
          entry = { id: fcId, callId: part.toolCallId, name: part.toolName, outputIndex, argsText: "", finalArgs: undefined };
          toolItems.set(part.toolCallId, entry);
          emit({
            type: "response.output_item.added",
            output_index: outputIndex,
            item: { type: "function_call", id: fcId, call_id: part.toolCallId, name: part.toolName, arguments: "", status: "in_progress" },
          });
        }
        const finalArgsStr = JSON.stringify(stripEmptyStringValues(part.args));
        entry.finalArgs = finalArgsStr;
        if (entry.argsText === "") {
          emit({
            type: "response.function_call_arguments.delta",
            item_id: entry.id,
            output_index: entry.outputIndex,
            delta: finalArgsStr,
          });
        }
        break;
      }
      case "error":
        throw part.error;
      default:
        break;
    }
  }

  if (textItemId !== null && textOutputIndex !== null) {
    const doneContent: ResponseOutputTextContent = { type: "output_text", text: textAccumulated, annotations: [] };
    emit({ type: "response.output_text.done", item_id: textItemId, output_index: textOutputIndex, content_index: 0, text: textAccumulated });
    emit({ type: "response.content_part.done", item_id: textItemId, output_index: textOutputIndex, content_index: 0, part: doneContent });
    const doneMsg: ResponseOutputMessage = { type: "message", id: textItemId, role: "assistant", status: "completed", content: [doneContent] };
    emit({ type: "response.output_item.done", output_index: textOutputIndex, item: doneMsg });
    outputItems.set(textOutputIndex, doneMsg);
  }

  const sortedTools = [...toolItems.values()].sort((a, b) => a.outputIndex - b.outputIndex);
  for (const entry of sortedTools) {
    const argsStr = entry.finalArgs ?? entry.argsText;
    emit({ type: "response.function_call_arguments.done", item_id: entry.id, output_index: entry.outputIndex, arguments: argsStr });
    const doneFc: ResponseOutputFunctionCall = { type: "function_call", id: entry.id, call_id: entry.callId, name: entry.name, arguments: argsStr, status: "completed" };
    emit({ type: "response.output_item.done", output_index: entry.outputIndex, item: doneFc });
    outputItems.set(entry.outputIndex, doneFc);
  }

  const usage = await result.usage;
  const finishReason = await result.finishReason;
  const sortedOutput = [...outputItems.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);

  // NaN は JSON.stringify で null になるため || 0 でガード
  const inputTokens = usage?.promptTokens || 0;
  const outputTokens = usage?.completionTokens || 0;

  if (logEntry) {
    const toolCalls = sortedTools.map((t) => ({ name: t.name, arguments: t.finalArgs ?? t.argsText }));
    finishLog(logEntry, {
      inputTokens,
      outputTokens,
      response: { text: textAccumulated || undefined, toolCalls: toolCalls.length > 0 ? toolCalls : undefined },
    });
  }

  emit({
    type: "response.completed",
    response: {
      id: respId,
      object: "response",
      created_at: createdAt,
      model,
      output: sortedOutput,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
      status: mapStatus(finishReason),
      error: null,
      incomplete_details: finishReason === "length" ? { reason: "max_tokens" } : null,
    },
  });
}

export async function handleResponses(c: Context): Promise<Response> {
  let body: ResponsesRequest;
  try {
    body = await c.req.json<ResponsesRequest>();
  } catch {
    return c.json({ error: { code: "invalid_request", message: "Invalid JSON" } }, 400);
  }

  const apiKey = config.apiKey !== ""
    ? config.apiKey
    : (c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? c.req.header("x-api-key") ?? "");

  const params = buildResponsesParams(body, apiKey);
  const { model, commonParams, serverToolNames } = params;

  const toolNames = body.tools?.map(t => t.name) ?? [];
  const summary: Record<string, unknown> = {
    endpoint: "/v1/responses",
    model,
    stream: body.stream ?? false,
    input: typeof body.input === "string" ? body.input.slice(0, 200) : `[${body.input?.length ?? 0} items]`,
    tools: toolNames.length > 0 ? toolNames : undefined,
    tool_choice: body.tool_choice,
  };
  if (config.defaultModel && config.defaultModel !== body.model) {
    summary["model_requested"] = body.model;
  }
  console.log(highlightJson(JSON.stringify(summary, null, 2)));

  const logEntry = startLog({
    endpoint: "/v1/responses",
    provider: config.providerName,
    model,
    modelRequested: config.defaultModel && config.defaultModel !== body.model ? body.model : undefined,
    stream: body.stream ?? false,
    request: { instructions: body.instructions, input: body.input, tools: toolNames.length > 0 ? toolNames : undefined, tool_choice: body.tool_choice },
  });

  // ストリーミング
  if (body.stream) {
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const emit = (event: ResponsesStreamEvent) =>
          controller.enqueue(enc.encode(sseEvent(event)));
        try {
          await emitStreamingLoop(params, emit, logEntry);
        } catch (err) {
          console.error("[stream] upstream error:", err);
          const { message } = extractUpstreamError(err);
          const enriched = config.defaultModel ? `[upstream model: ${model}] ${message}` : message;
          finishLog(logEntry, { error: enriched });
          controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify({ type: "error", code: "server_error", message: enriched })}\n\n`));
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
    const toolCalls = (result.toolCalls ?? []).filter(c => !serverToolNames.has(c.toolName));
    const finishReason = result.finishReason;
    const output: ResponseOutputItem[] = [];

    for (const call of toolCalls) {
      output.push({
        type: "function_call",
        id: makeId("fc_"),
        call_id: call.toolCallId,
        name: call.toolName,
        arguments: JSON.stringify(stripEmptyStringValues(call.args)),
        status: "completed",
      });
    }

    if (result.text) {
      output.push({
        type: "message",
        id: makeId("msg_"),
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: result.text, annotations: [] }],
      });
    }

    const response: ResponsesResponse = {
      id: params.respId,
      object: "response",
      created_at: params.createdAt,
      model,
      output,
      usage: {
        input_tokens: result.usage.promptTokens,
        output_tokens: result.usage.completionTokens,
        total_tokens: result.usage.promptTokens + result.usage.completionTokens,
      },
      status: finishReason === "length" ? "incomplete" : "completed",
      error: null,
      incomplete_details: finishReason === "length" ? { reason: "max_tokens" } : null,
    };

    finishLog(logEntry, {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
      response: {
        text: result.text || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls.map((call) => ({ name: call.toolName, arguments: JSON.stringify(stripEmptyStringValues(call.args)) })) : undefined,
      },
    });

    return c.json(response);
  } catch (err) {
    console.error("[non-stream] upstream error:", err);
    const { message, statusCode } = extractUpstreamError(err);
    const enriched = config.defaultModel ? `[upstream model: ${model}] ${message}` : message;
    finishLog(logEntry, { error: enriched });
    return c.json({ error: { code: "server_error", message: enriched } }, statusCode as 400 | 401 | 403 | 404 | 429 | 500 | 502);
  }
}
