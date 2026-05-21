import { jsonSchema, type CoreMessage, type ToolSet } from "ai";
import type {
  ResponseInputItem,
  ResponseInputMessage,
  ResponseFunctionCall,
  ResponseFunctionCallOutput,
  ResponseTool,
  ResponseToolChoice,
} from "../types/openai-responses.js";
import { sanitizeToolName } from "./shared.js";

function parseArgs(args: string): unknown {
  try { return JSON.parse(args || "{}"); } catch { return {}; }
}

function inputMessageToCore(msg: ResponseInputMessage): CoreMessage {
  const rawRole = msg.role === "developer" ? "system" : msg.role;
  const { content } = msg;
  if (typeof content === "string") {
    return { role: rawRole as "user" | "assistant" | "system", content };
  }
  const text = (content as Array<{ type: string; text?: string }>)
    .map(p => p.text ?? "")
    .join("");
  return { role: rawRole as "user" | "assistant" | "system", content: text };
}

export function toMessagesFromResponses(
  input: string | ResponseInputItem[],
  instructions?: string
): CoreMessage[] {
  const result: CoreMessage[] = [];

  if (instructions) {
    result.push({ role: "system", content: instructions });
  }

  if (typeof input === "string") {
    result.push({ role: "user", content: input });
    return result;
  }

  // call_id → name のマップを事前構築（function_call_output の toolName 解決用）
  const callIdToName = new Map<string, string>();
  for (const item of input) {
    if ("type" in item && (item as ResponseFunctionCall).type === "function_call") {
      const fc = item as ResponseFunctionCall;
      callIdToName.set(fc.call_id, fc.name);
    }
  }

  let i = 0;
  while (i < input.length) {
    const item = input[i];

    // role を持つ通常メッセージ (type が "message" または未指定)
    if ("role" in item) {
      result.push(inputMessageToCore(item as ResponseInputMessage));
      i++;
      continue;
    }

    // function_call: 連続する呼び出しをまとめて assistant ツール呼び出しメッセージにする
    if ((item as ResponseFunctionCall).type === "function_call") {
      const calls: ResponseFunctionCall[] = [];
      while (
        i < input.length &&
        "type" in input[i] &&
        (input[i] as ResponseFunctionCall).type === "function_call"
      ) {
        calls.push(input[i] as ResponseFunctionCall);
        i++;
      }
      result.push({
        role: "assistant",
        content: calls.map(call => ({
          type: "tool-call" as const,
          toolCallId: call.call_id,
          toolName: sanitizeToolName(call.name),
          args: parseArgs(call.arguments),
        })),
      });
      continue;
    }

    // function_call_output: 連続する結果をまとめて tool メッセージにする
    if ((item as ResponseFunctionCallOutput).type === "function_call_output") {
      const outputs: ResponseFunctionCallOutput[] = [];
      while (
        i < input.length &&
        "type" in input[i] &&
        (input[i] as ResponseFunctionCallOutput).type === "function_call_output"
      ) {
        outputs.push(input[i] as ResponseFunctionCallOutput);
        i++;
      }
      result.push({
        role: "tool",
        content: outputs.map(out => ({
          type: "tool-result" as const,
          toolCallId: out.call_id,
          toolName: sanitizeToolName(callIdToName.get(out.call_id) ?? out.call_id),
          result: out.output,
        })),
      });
      continue;
    }

    i++;
  }

  return result;
}

// OpenAI の strict スキーマ要件に合わせ、全 object に additionalProperties:false を付与し
// required に全キーを補完する（再帰）
function normalizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.type === "array" && schema.items && typeof schema.items === "object") {
    return { ...schema, items: normalizeSchema(schema.items as Record<string, unknown>) };
  }
  if (schema.type !== "object" && !schema.properties) return schema;
  const props = (schema.properties ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const allKeys = Object.keys(props);
  const required = [...new Set([...existing, ...allKeys])];
  const normalizedProps: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    normalizedProps[k] = typeof v === "object" && v !== null
      ? normalizeSchema(v as Record<string, unknown>)
      : v;
  }
  return { ...schema, properties: normalizedProps, required, additionalProperties: false };
}

export function toToolsFromResponses(tools: ResponseTool[] | undefined): ToolSet | undefined {
  if (!tools || tools.length === 0) return undefined;
  const out: ToolSet = {};
  for (const t of tools) {
    // null / undefined 要素をスキップ
    if (t == null) continue;
    // Chat Completions 形式 { type: "function", function: { name, description, parameters } } にも対応
    const fn = (t as unknown as { function?: { name?: string; description?: string; parameters?: Record<string, unknown> } }).function;
    const name = t.name ?? fn?.name;
    const description = t.description ?? fn?.description;
    const parameters = t.parameters ?? fn?.parameters;
    if (!name) continue;
    const raw = (parameters ?? { type: "object", properties: {}, required: [] }) as Record<string, unknown> & { $schema?: unknown };
    const { $schema, ...schema } = raw;
    void $schema;
    out[sanitizeToolName(name)] = {
      description,
      parameters: jsonSchema(normalizeSchema(schema) as Parameters<typeof jsonSchema>[0]),
    };
  }
  return out;
}

export function toToolChoiceFromResponses(
  choice: ResponseToolChoice | undefined
):
  | "auto"
  | "none"
  | "required"
  | { type: "tool"; toolName: string }
  | undefined {
  if (choice === undefined) return undefined;
  if (choice === "auto") return "auto";
  if (choice === "none") return "none";
  if (choice === "required") return "required";
  return { type: "tool", toolName: sanitizeToolName(choice.name) };
}
