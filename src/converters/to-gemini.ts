import { jsonSchema, type ToolSet } from "ai";
import type { AnthropicTool } from "../types/anthropic.js";
import { sanitizeToolName } from "./shared.js";

// Gemini が非対応の JSON Schema キーワード
const DISALLOWED_KEYWORDS = new Set([
  "$schema", "propertyNames", "if", "then", "else", "not", "contains",
  "patternProperties", "format", "additionalProperties", "default", "examples",
]);

// type が省略されたスキーマから型を推論する。Gemini は全ノードで type が必須。
function inferType(node: Record<string, unknown>): string {
  if (node.properties || node.required) return "object";
  if (node.items) return "array";
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const v = (node.enum as unknown[])[0];
    if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
    if (typeof v === "boolean") return "boolean";
    return "string";
  }
  return "string";
}

// 型配列を Gemini の nullable 表現に変換する。
//   ["string", "null"]  → { type: "string", nullable: true }
//   ["string", "number"] → 先頭の非 null 型を採用 (Gemini は単一型のみサポート)
function normalizeTypeArray(node: Record<string, unknown>): void {
  if (!Array.isArray(node.type)) return;
  const types = (node.type as unknown[]).filter((t): t is string => typeof t === "string");
  if (types.includes("null")) node.nullable = true;
  const nonNull = types.filter((t) => t !== "null");
  if (nonNull.length > 0) {
    node.type = nonNull[0];
  } else {
    delete node.type;
  }
}

// required を properties に存在するキーのみに絞り、非対応キーワードを除去する
function sanitizeSchema(node: Record<string, unknown>): Record<string, unknown> {
  const result = { ...node };
  // additionalProperties が schema object (辞書/マップ型) の場合、Gemini は dict 型を
  // 表現できないため、空 properties の object として近似する (キーワード削除前に判定)
  const isDictSchema =
    !result.properties &&
    !!result.additionalProperties &&
    typeof result.additionalProperties === "object" &&
    !Array.isArray(result.additionalProperties);
  if (isDictSchema) {
    result.properties = {};
    result.type = "object";
  }
  for (const key of DISALLOWED_KEYWORDS) delete result[key];
  normalizeTypeArray(result);
  if (result.properties && typeof result.properties === "object") {
    const props = result.properties as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      out[k] = sanitizeSchema(v as Record<string, unknown>);
    }
    result.properties = out;
    if (Array.isArray(result.required)) {
      const defined = new Set(Object.keys(out));
      result.required = (result.required as string[]).filter((k) => defined.has(k));
      if ((result.required as string[]).length === 0) delete result.required;
    }
  } else if (Array.isArray(result.required)) {
    // properties がない場合は required は常に無効
    delete result.required;
  }
  if (result.items && typeof result.items === "object" && !Array.isArray(result.items)) {
    result.items = sanitizeSchema(result.items as Record<string, unknown>);
  }
  for (const key of ["allOf", "anyOf", "oneOf"] as const) {
    if (Array.isArray(result[key])) {
      result[key] = (result[key] as Record<string, unknown>[]).map(sanitizeSchema);
    }
  }
  // Gemini は全スキーマノードで type が必須なので、欠けている場合は推論して補完する
  if (typeof result.type !== "string") {
    result.type = inferType(result);
  }
  return result;
}

export function toGeminiTools(tools: AnthropicTool[] | undefined): ToolSet | undefined {
  if (!tools || tools.length === 0) return undefined;
  const out: ToolSet = {};
  for (const t of tools) {
    const raw = (t.input_schema ?? { type: "object", properties: {} }) as Record<string, unknown> & { $schema?: unknown };
    const { $schema, ...schema } = raw;
    void $schema;
    out[sanitizeToolName(t.name)] = {
      description: t.description,
      parameters: jsonSchema(sanitizeSchema(schema) as Parameters<typeof jsonSchema>[0]),
    };
  }
  return out;
}
