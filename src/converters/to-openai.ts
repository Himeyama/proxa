import { jsonSchema, type CoreMessage, type ImagePart, type TextPart, type ToolSet } from "ai";
import type {
  AnthropicMessage,
  AnthropicTool,
  AnthropicToolChoice,
  ContentBlock,
  ContentBlockImage,
  ContentBlockText,
  SystemBlock,
} from "../types/anthropic.js";

function imageBlockToPart(block: ContentBlockImage): ImagePart {
  const { source } = block;
  if (source.type === "base64") {
    return { type: "image", image: source.data, mimeType: source.media_type };
  }
  return { type: "image", image: new URL(source.url) };
}

function userBlocksToParts(blocks: ContentBlock[]): string | Array<TextPart | ImagePart> {
  const hasImage = blocks.some((b) => b.type === "image");
  if (!hasImage) {
    return blocks
      .filter((b): b is ContentBlockText => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
  const parts: Array<TextPart | ImagePart> = [];
  for (const block of blocks) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      parts.push(imageBlockToPart(block));
    }
  }
  return parts;
}

function systemToString(system: string | SystemBlock[]): string {
  if (typeof system === "string") return system;
  return system.map((b) => b.text).join("\n");
}

function toolResultContentToString(content: string | ContentBlockText[]): string {
  if (typeof content === "string") return content;
  return content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

// OpenAI は ^[a-zA-Z0-9_-]+$ のみ許可するため、それ以外の文字を _ に置換する
function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function filterSystemForNonClaudeModel(
  system: string | SystemBlock[],
  model: string
): string {
  const text = systemToString(system);
  const lines = text.split('\n');
  const filtered: string[] = [];
  let inEnvSection = false;
  let lastEnvBulletIdx = -1;

  for (const line of lines) {
    if (/^#\s*Environment\b/.test(line)) {
      inEnvSection = true;
    } else if (inEnvSection && /^#/.test(line)) {
      inEnvSection = false;
    }

    if (inEnvSection && /^\s*-\s/.test(line) && /claude/i.test(line)) {
      continue;
    }

    if (inEnvSection && /^\s*-\s/.test(line)) {
      lastEnvBulletIdx = filtered.length;
    }

    filtered.push(line);
  }

  if (lastEnvBulletIdx !== -1) {
    filtered.splice(lastEnvBulletIdx + 1, 0, ` - You are powered by the model named ${model}.`);
  }

  return filtered.join('\n');
}

export function toOpenAIMessages(
  messages: AnthropicMessage[],
  system?: string | SystemBlock[]
): CoreMessage[] {
  const result: CoreMessage[] = [];

  if (system) {
    result.push({ role: "system", content: systemToString(system) });
  }

  for (const msg of messages) {
    const content = msg.content;

    if (typeof content === "string") {
      result.push({ role: msg.role, content });
      continue;
    }

    if (msg.role === "assistant") {
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
      > = [];
      for (const block of content) {
        if (block.type === "text") {
          parts.push({ type: "text", text: block.text });
        } else if (block.type === "tool_use") {
          parts.push({
            type: "tool-call",
            toolCallId: block.id,
            toolName: sanitizeToolName(block.name),
            args: block.input ?? {},
          });
        }
        // thinking / redacted_thinking はスキップ（upstream に送らない）
      }
      if (parts.length === 0) {
        parts.push({ type: "text", text: "" });
      }
      result.push({ role: "assistant", content: parts });
      continue;
    }

    // user role
    const toolResults = content.filter((b) => b.type === "tool_result");
    const textBlocks = content.filter((b) => b.type === "text" || b.type === "image");

    if (toolResults.length > 0) {
      result.push({
        role: "tool",
        content: toolResults.map((b) => {
          const tr = b as Extract<ContentBlock, { type: "tool_result" }>;
          return {
            type: "tool-result",
            toolCallId: tr.tool_use_id,
            toolName: "",
            result: toolResultContentToString(tr.content),
            isError: tr.is_error,
          };
        }),
      });
    }

    if (textBlocks.length > 0) {
      result.push({ role: "user", content: userBlocksToParts(textBlocks as ContentBlock[]) });
    }
  }

  return result;
}

// OpenAI が許可しない JSON Schema キーワード
// OpenAI が許可しない JSON Schema キーワード（format は値によらず常に除去）
const DISALLOWED_KEYWORDS = new Set(["propertyNames", "if", "then", "else", "not", "contains", "patternProperties", "format"]);

// OpenAI strict モード: 全オブジェクトに additionalProperties:false と全キーの required を再帰的に付与する
function strictifySchema(node: Record<string, unknown>): Record<string, unknown> {
  const result = { ...node };
  for (const key of DISALLOWED_KEYWORDS) delete result[key];
  if (result.properties && typeof result.properties === "object") {
    const props = result.properties as Record<string, unknown>;
    const strictProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      strictProps[k] = strictifySchema(v as Record<string, unknown>);
    }
    result.properties = strictProps;
    // properties に存在するキーのみ required に含める（余分なキーは OpenAI が拒否する）
    result.required = Object.keys(props);
    result.additionalProperties = false;
  }
  // additionalProperties がスキーマオブジェクト（辞書/マップ型）の場合、
  // OpenAI strict モードは非対応なので空オブジェクトに変換する
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
  return result;
}

export function toOpenAITools(tools: AnthropicTool[] | undefined): ToolSet | undefined {
  if (!tools || tools.length === 0) return undefined;
  const out: ToolSet = {};
  for (const t of tools) {
    // $schema は多くの OpenAI 互換エンドポイントが拒否するため除去する
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

export function toOpenAIToolChoice(
  choice: AnthropicToolChoice | undefined
):
  | "auto"
  | "none"
  | "required"
  | { type: "tool"; toolName: string }
  | undefined {
  if (!choice) return undefined;
  switch (choice.type) {
    case "auto":
      return "auto";
    case "any":
      return "required";
    case "none":
      return "none";
    case "tool":
      return { type: "tool", toolName: sanitizeToolName(choice.name) };
  }
}
