import { jsonSchema, type ToolSet } from "ai";
import type { AnthropicTool } from "../types/anthropic.js";
import { sanitizeToolName } from "./shared.js";

// Chat Completions API が許可しない JSON Schema キーワード（format は値によらず常に除去）
const DISALLOWED_KEYWORDS = new Set([
  "propertyNames", "if", "then", "else", "not", "contains", "patternProperties", "format",
]);

// type が省略されたスキーマから型を推論する。strict モードでは全ノードで type が必須。
function inferType(node: Record<string, unknown>): string {
  if (node.properties || node.required || node.additionalProperties !== undefined) return "object";
  if (node.items) return "array";
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const v = (node.enum as unknown[])[0];
    if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
    if (typeof v === "boolean") return "boolean";
    return "string";
  }
  return "string";
}

// 型配列の正規化。OpenAI strict は ["string", "null"] のような union を nullable 表現として
// ネイティブにサポートするため、文字列以外を除去するだけにとどめる。
// 型配列が空 / 全要素が "null" のみの場合は推論にフォールバックする。
function normalizeTypeArray(node: Record<string, unknown>): void {
  if (!Array.isArray(node.type)) return;
  const types = (node.type as unknown[]).filter((t): t is string => typeof t === "string");
  const nonNull = types.filter((t) => t !== "null");
  if (nonNull.length === 0) {
    delete node.type;
    return;
  }
  // 一意化しつつ "null" は末尾に寄せる
  const unique = Array.from(new Set(types));
  if (unique.length === 1) {
    node.type = unique[0];
  } else {
    node.type = unique;
  }
}

// strict モード: 全オブジェクトに additionalProperties:false を付与し、元の required を尊重する
function strictifySchema(node: Record<string, unknown>): Record<string, unknown> {
  const result = { ...node };
  for (const key of DISALLOWED_KEYWORDS) delete result[key];
  normalizeTypeArray(result);
  if (result.properties && typeof result.properties === "object") {
    const props = result.properties as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      out[k] = strictifySchema(v as Record<string, unknown>);
    }
    result.properties = out;
    // additionalProperties:false のとき OpenAI strict モードは required に全キーを要求する
    result.required = Object.keys(out);
    result.additionalProperties = false;
  }
  // additionalProperties がスキーマオブジェクト（辞書/マップ型）の場合は空オブジェクトに変換する
  if (!result.properties && result.additionalProperties && typeof result.additionalProperties === "object") {
    result.properties = {};
    result.required = [];
    result.additionalProperties = false;
  }
  if (result.items && typeof result.items === "object" && !Array.isArray(result.items)) {
    result.items = strictifySchema(result.items as Record<string, unknown>);
  }
  for (const key of ["allOf", "anyOf", "oneOf"] as const) {
    if (Array.isArray(result[key])) {
      result[key] = (result[key] as Record<string, unknown>[]).map(strictifySchema);
    }
  }
  // strict モードでは全スキーマノードで type が必須なので、欠けている場合は推論して補完する
  // (型配列はそのまま許容するため Array.isArray もチェック)
  if (typeof result.type !== "string" && !Array.isArray(result.type)) {
    result.type = inferType(result);
  }
  return result;
}

export function toChatCompletionsTools(tools: AnthropicTool[] | undefined): ToolSet | undefined {
  if (!tools || tools.length === 0) return undefined;
  const out: ToolSet = {};
  for (const t of tools) {
    const raw = (t.input_schema ?? { type: "object", properties: {}, required: [] }) as Record<string, unknown> & { $schema?: unknown };
    const { $schema, ...schema } = raw;
    void $schema;
    out[sanitizeToolName(t.name)] = {
      description: t.description,
      parameters: jsonSchema(strictifySchema(schema) as Parameters<typeof jsonSchema>[0]),
    };
  }
  return out;
}
