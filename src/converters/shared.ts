import { type CoreMessage, type ImagePart, type TextPart } from "ai";
import { config } from "../config.js";
import type {
  AnthropicMessage,
  AnthropicToolChoice,
  CacheControl,
  ContentBlock,
  ContentBlockImage,
  ContentBlockText,
  SystemBlock,
} from "../types/anthropic.js";

// Anthropic の cache_control を CoreMessage / パートの providerOptions へ写すための spread。
// OpenRouter プロバイダー (@openrouter/ai-sdk-provider) は providerOptions.openrouter.cacheControl を
// 上流リクエストの cache_control に変換する。OpenRouter 以外のプロバイダーはこの namespace を無視するため
// 常に付与して問題ない (プロキシは Anthropic へは送らない)。
function cacheOpts(
  cc: CacheControl | undefined
): { providerOptions: { openrouter: { cacheControl: CacheControl } } } | Record<string, never> {
  return cc ? { providerOptions: { openrouter: { cacheControl: cc } } } : {};
}

// ブロック配列のうち、末尾に最も近い cache_control を返す。
// プロンプトキャッシュのブレークポイントは「そこまでのプレフィックス」を指すため、
// 文字列へ潰れる (= 単一パートになる) ケースでは末尾の境界を採用する。
function lastCacheControl(blocks: Array<{ cache_control?: CacheControl }>): CacheControl | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].cache_control) return blocks[i].cache_control;
  }
  return undefined;
}

function imageBlockToPart(block: ContentBlockImage): ImagePart {
  const { source } = block;
  const base: ImagePart =
    source.type === "base64"
      ? { type: "image", image: source.data, mimeType: source.media_type }
      : { type: "image", image: new URL(source.url) };
  return { ...base, ...cacheOpts(block.cache_control) };
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
      parts.push({ type: "text", text: block.text, ...cacheOpts(block.cache_control) });
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

// --min 指定時に上流へ送らない (除外する) クライアントツール名の集合。
// エージェント実行・タスク管理・スケジューリングなど、最小構成では不要なツールを送信前に取り除く。
export const MIN_EXCLUDED_TOOLS = new Set<string>([
  "DesignSync",
  "NotebookEdit",
  "WaitForMcpServers",
  "Monitor",
  "PushNotification",
  "ScheduleWakeup",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskStop",
  "TaskUpdate",
  "Agent",
  "CronCreate",
  "CronDelete",
  "CronList",
  "EnterWorktree",
  "ExitWorktree",
  "EnterPlanMode",
  "ExitPlanMode",
  "Skill",
  "Workflow",
  "mcp__ide__executeCode",
  "mcp__ide__getDiagnostics",
]);

// config.minTools が有効なとき、MIN_EXCLUDED_TOOLS に含まれるツールを除外する。
// name フィールドを持つツール定義配列 (Anthropic / Responses 形式) に使える。
// config.minTools が無効なら配列はそのまま返す。
export function filterMinTools<T extends { name: string }>(
  tools: T[] | undefined
): T[] | undefined {
  if (!config.minTools || !tools) return tools;
  return tools.filter((t) => !MIN_EXCLUDED_TOOLS.has(t.name));
}

// config.stripSystemLine に指定された文字列のいずれかを含む行を system プロンプトから除去する。
// 大文字小文字を区別する部分一致。パターン未指定なら元の文字列をそのまま返す。
export function stripSystemLines(text: string): string {
  const patterns = config.stripSystemLine;
  if (!patterns || patterns.length === 0) return text;
  return text
    .split("\n")
    .filter((line) => !patterns.some((p) => line.includes(p)))
    .join("\n");
}

// 通信ログ用: system プロンプトを「実際に上流へ送られる文字列」(行除去適用後) へ正規化する。
// 全行が除去されて空になった場合は undefined を返す (上流へ system を送らないのと一致)。
export function finalSystemForLog(
  system: string | SystemBlock[] | undefined
): string | undefined {
  if (system == null) return undefined;
  const stripped = stripSystemLines(systemToString(system));
  return stripped.length > 0 ? stripped : undefined;
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
    const systemContent = stripSystemLines(systemToString(system));
    if (systemContent) {
      // system のキャッシュブレークポイント。Anthropic のキャッシュ順序は tools → system → messages
      // なので、system に付けた breakpoint は tools + system のプレフィックスをまとめてキャッシュする。
      const sysCache = Array.isArray(system) ? lastCacheControl(system) : undefined;
      result.push({ role: "system", content: systemContent, ...cacheOpts(sysCache) });
    }
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
      // Anthropic spec は user/assistant のみ。それ以外 (例: system が紛れ込んだ場合) は
      // Google SDK など一部プロバイダーがエラーにするためスキップする。
      if (msg.role === "user" || msg.role === "assistant") {
        result.push({ role: msg.role, content });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
      > = [];
      for (const block of content) {
        if (block.type === "text") {
          parts.push({ type: "text", text: block.text, ...cacheOpts(block.cache_control) });
        } else if (block.type === "tool_use") {
          parts.push({
            type: "tool-call",
            toolCallId: block.id,
            toolName: sanitizeToolName(block.name),
            args: block.input ?? {},
            ...cacheOpts(block.cache_control),
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
            ...cacheOpts(tr.cache_control),
          };
        }),
      });
    }

    if (textBlocks.length > 0) {
      const userContent = userBlocksToParts(textBlocks as ContentBlock[]);
      // 文字列に潰れた場合 (画像なし) はパート単位の providerOptions を持てないため、
      // 末尾ブロックの cache_control をメッセージレベルに付ける (provider が単一パートへ適用する)。
      const msgCache =
        typeof userContent === "string"
          ? lastCacheControl(textBlocks as Array<{ cache_control?: CacheControl }>)
          : undefined;
      result.push({ role: "user", content: userContent, ...cacheOpts(msgCache) });
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
