import { type CoreMessage, type ImagePart, type TextPart } from "ai";
import type {
  AnthropicMessage,
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

// ツール名に使えない文字を _ に置換する
export function sanitizeToolName(name: string): string {
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

// Gemini 思考モデルは functionCall パーツに thought_signature を要求するが、
// Anthropic フォーマットにその概念がないため、Google プロバイダー使用時は
// 履歴の tool_use / tool_result をテキストに変換して functionCall パーツを送らない。
function flattenToolHistory(messages: AnthropicMessage[]): AnthropicMessage[] {
  // tool_use_id → { name, input, result, isError } のマップを構築
  const toolUseById = new Map<string, { name: string; input: unknown }>();
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_use") {
          toolUseById.set(block.id, { name: block.name, input: block.input ?? {} });
        }
      }
    }
  }

  const result: AnthropicMessage[] = [];
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push(msg);
      continue;
    }

    if (msg.role === "assistant") {
      const textParts: string[] = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          textParts.push(`[Tool Use: ${block.name}]\n${JSON.stringify(block.input ?? {}, null, 2)}`);
        }
      }
      const text = textParts.join("\n").trim();
      result.push({ role: "assistant", content: text || " " });
      continue;
    }

    // user role: tool_result をテキスト化してまとめる
    const textParts: string[] = [];
    for (const block of msg.content) {
      if (block.type === "tool_result") {
        const tr = block as Extract<ContentBlock, { type: "tool_result" }>;
        const def = toolUseById.get(tr.tool_use_id);
        const name = def?.name ?? tr.tool_use_id;
        const resultText = toolResultContentToString(tr.content);
        textParts.push(`[Tool Result: ${name}]${tr.is_error ? " (error)" : ""}\n${resultText}`);
      } else if (block.type === "text") {
        textParts.push((block as ContentBlockText).text);
      }
    }
    const text = textParts.join("\n").trim();
    if (text) {
      result.push({ role: "user", content: text });
    }
  }
  return result;
}

export function toMessages(
  messages: AnthropicMessage[],
  system?: string | SystemBlock[],
  options?: { flattenToolHistory?: boolean }
): CoreMessage[] {
  const result: CoreMessage[] = [];

  if (system) {
    result.push({ role: "system", content: systemToString(system) });
  }

  const effectiveMessages = options?.flattenToolHistory
    ? flattenToolHistory(messages)
    : messages;

  // tool_use_id → toolName のマップを事前構築（Gemini は function_response.name が必須）
  const toolNameById = new Map<string, string>();
  for (const msg of effectiveMessages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_use") {
          toolNameById.set(block.id, sanitizeToolName(block.name));
        }
      }
    }
  }

  for (const msg of effectiveMessages) {
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
    // OpenAI は assistant の tool_calls 直後に tool メッセージを要求するため、
    // tool_result を先に push し、テキスト/画像はその後に user メッセージとして追加する
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
            toolName: toolNameById.get(tr.tool_use_id) ?? tr.tool_use_id,
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

export function toToolChoice(
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
