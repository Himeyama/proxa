import type { WebSocket } from "ws";
import { config } from "../config.js";
import { highlightJson } from "../server.js";
import { extractUpstreamError } from "./provider.js";
import { startLog, finishLog } from "../log-store.js";
import { buildResponsesParams, emitStreamingLoop } from "./responses.js";
import type { ResponsesRequest, ResponsesStreamEvent } from "../types/openai-responses.js";

export async function handleResponsesWs(ws: WebSocket, rawApiKey: string): Promise<void> {
  return new Promise((resolve) => {
    ws.once("message", async (data) => {
      let body: ResponsesRequest;
      try {
        body = JSON.parse(data.toString());
      } catch {
        ws.close(1003, "Invalid JSON");
        resolve();
        return;
      }

      const apiKey = config.apiKey !== "" ? config.apiKey : rawApiKey;
      const params = buildResponsesParams(body, apiKey);
      const { model } = params;

      const toolNames = body.tools?.map(t => t.name) ?? [];
      const summary: Record<string, unknown> = {
        endpoint: "/v1/responses (ws)",
        model,
        input: typeof body.input === "string" ? body.input.slice(0, 200) : `[${body.input?.length ?? 0} items]`,
        tools: toolNames.length > 0 ? toolNames : undefined,
        tool_choice: body.tool_choice,
      };
      if (config.defaultModel && config.defaultModel !== body.model) {
        summary["model_requested"] = body.model;
      }
      console.log(highlightJson(JSON.stringify(summary, null, 2)));

      const logEntry = startLog({
        endpoint: "/v1/responses (ws)",
        provider: config.providerName,
        model,
        modelRequested: config.defaultModel && config.defaultModel !== body.model ? body.model : undefined,
        stream: true,
        request: { instructions: body.instructions, input: body.input, tools: toolNames.length > 0 ? toolNames : undefined, tool_choice: body.tool_choice },
      });

      const emit = (event: ResponsesStreamEvent) => ws.send(JSON.stringify(event));

      try {
        await emitStreamingLoop(params, emit, logEntry);
      } catch (err) {
        console.error("[ws] upstream error:", err);
        const { message } = extractUpstreamError(err);
        const enriched = config.defaultModel ? `[upstream model: ${model}] ${message}` : message;
        finishLog(logEntry, { error: enriched });
        ws.send(JSON.stringify({ type: "error", code: "server_error", message: enriched }));
      } finally {
        ws.close();
        resolve();
      }
    });
  });
}
