import type {
  AnthropicMessage,
  AnthropicTool,
  AnthropicToolChoice,
  AnthropicThinkingConfig,
  ContentBlock,
} from "../types/anthropic.js";
import type {
  GeminiContent,
  GeminiPart,
  GeminiTool,
  GeminiToolConfig,
  GeminiGenerationConfig,
} from "../types/gemini.js";

// functionResponse.response (任意の構造体) を tool_result 用の文字列へ変換する
function functionResponseToString(response: unknown): string {
  if (response == null) return "";
  if (typeof response === "string") return response;
  // Gemini の慣習で { name, content } / { result } 等に包まれることが多いが、
  // 欠落なく上流へ渡すため全体を JSON 文字列化する
  try {
    return JSON.stringify(response);
  } catch {
    return String(response);
  }
}

// functionCall / functionResponse を Anthropic の tool_use_id にひも付ける際の ID を決める。
// Gemini は name で対応付ける (新しい API では id も付く) ため id を優先し、無ければ name を使う。
function toolUseId(id: string | undefined, name: string): string {
  return id ?? name;
}

// Gemini の contents + systemInstruction を Anthropic メッセージ + system 文字列へ変換する。
export function geminiContentsToAnthropic(
  contents: GeminiContent[] | undefined,
  systemInstruction: GeminiContent | undefined
): { system?: string; messages: AnthropicMessage[] } {
  const systemParts: string[] = [];
  for (const p of systemInstruction?.parts ?? []) {
    if ("text" in p && p.text) systemParts.push(p.text);
  }

  const messages: AnthropicMessage[] = [];
  for (const content of contents ?? []) {
    const parts = content.parts ?? [];

    if (content.role === "model") {
      // assistant: text + functionCall → tool_use。思考パートは上流へ送らない
      const blocks: ContentBlock[] = [];
      for (const p of parts) {
        if ("text" in p) {
          if (p.text && !p.thought) blocks.push({ type: "text", text: p.text });
        } else if ("functionCall" in p) {
          const fc = p.functionCall;
          blocks.push({
            type: "tool_use",
            id: toolUseId(fc.id, fc.name),
            name: fc.name,
            input: fc.args ?? {},
          });
        }
      }
      messages.push({ role: "assistant", content: blocks.length > 0 ? blocks : "" });
      continue;
    }

    // user / function ロール: text / inlineData(画像) / fileData / functionResponse(tool_result)
    const blocks: ContentBlock[] = [];
    for (const p of parts) {
      if ("text" in p) {
        if (p.text) blocks.push({ type: "text", text: p.text });
      } else if ("inlineData" in p) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: p.inlineData.mimeType, data: p.inlineData.data },
        });
      } else if ("fileData" in p) {
        blocks.push({ type: "image", source: { type: "url", url: p.fileData.fileUri } });
      } else if ("functionResponse" in p) {
        const fr = p.functionResponse;
        blocks.push({
          type: "tool_result",
          tool_use_id: toolUseId(fr.id, fr.name),
          content: functionResponseToString(fr.response),
        });
      }
    }
    messages.push({ role: "user", content: blocks.length > 0 ? blocks : "" });
  }

  return { system: systemParts.join("\n") || undefined, messages };
}

// Gemini tools[].functionDeclarations[] を Anthropic ツール定義へ変換する。
// 組み込みツール (googleSearch など) は無視する。
export function geminiToolsToAnthropic(tools: GeminiTool[] | undefined): AnthropicTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const out: AnthropicTool[] = [];
  for (const t of tools) {
    for (const fn of t?.functionDeclarations ?? []) {
      if (!fn?.name) continue;
      out.push({
        name: fn.name,
        description: fn.description,
        input_schema: (fn.parameters ??
          fn.parametersJsonSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

// Gemini toolConfig.functionCallingConfig を Anthropic tool_choice へ変換する。
//   AUTO → auto / NONE → none / ANY → any (allowedFunctionNames が 1 件なら特定ツール指定)
export function geminiToolConfigToToolChoice(
  toolConfig: GeminiToolConfig | undefined
): AnthropicToolChoice | undefined {
  const cfg = toolConfig?.functionCallingConfig;
  if (!cfg?.mode) return undefined;
  switch (cfg.mode.toUpperCase()) {
    case "AUTO":
      return { type: "auto" };
    case "NONE":
      return { type: "none" };
    case "ANY":
      if (cfg.allowedFunctionNames?.length === 1) {
        return { type: "tool", name: cfg.allowedFunctionNames[0] };
      }
      return { type: "any" };
    default:
      return undefined;
  }
}

// Gemini generationConfig.thinkingConfig を Anthropic thinking 設定へ変換する。
//   thinkingBudget === 0 → disabled / > 0 → enabled(budget) / 動的(<0) や includeThoughts のみ → enabled(既定予算)
export function geminiThinkingToAnthropic(
  gc: GeminiGenerationConfig | undefined
): AnthropicThinkingConfig | undefined {
  const tc = gc?.thinkingConfig;
  if (!tc) return undefined;
  if (tc.thinkingBudget === 0) return { type: "disabled" };
  if (typeof tc.thinkingBudget === "number" && tc.thinkingBudget > 0) {
    return { type: "enabled", budget_tokens: tc.thinkingBudget };
  }
  // 動的 (thinkingBudget < 0) または budget 未指定で includeThoughts 有効 → 既定予算で enabled
  if (tc.includeThoughts || (typeof tc.thinkingBudget === "number" && tc.thinkingBudget < 0)) {
    return { type: "enabled", budget_tokens: 8192 };
  }
  return undefined;
}
