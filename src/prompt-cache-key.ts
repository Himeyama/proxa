// プロンプトキャッシュのルーティングキー (prompt_cache_key) を導出・注入する。
//
// OpenAI / Azure のプロンプトキャッシュは messages + tools の先頭トークン列が一致したときに効くが、
// 実際のヒット率は「同一プレフィックスのリクエストが同じバックエンドへルーティングされるか」に依存する。
// 安定キー (prompt_cache_key) が無いと負荷分散でリクエストが散り、同じプレフィックスでもヒットが確率的になる。
// system + tools のハッシュから安定キーを補うことでルーティングを固定し、ヒット率を上げる。
//
// メッセージ本文 (毎ターン伸びる) ではなく system + tools のみを対象にすることで、会話を通じて値が一定になる。

import { createHash } from "node:crypto";

// system テキストと tools の JSON から安定キー (proxa-<hex16>) を導出する。
export function promptCacheKeyFromParts(systemText: string, toolsJson: string): string {
  const h = createHash("sha256");
  h.update(systemText);
  h.update(" ");
  h.update(toolsJson);
  return "proxa-" + h.digest("hex").slice(0, 16);
}

// 上流へ送る JSON ボディ (Chat Completions 形式 = messages / Responses 形式 = instructions) から
// 安定プレフィックスを取り出してキーを導出する。安定要素が無ければ null。
function deriveKeyFromBody(obj: Record<string, unknown>): string | null {
  let systemText = "";
  const messages = obj.messages;
  if (Array.isArray(messages)) {
    systemText = messages
      .filter((m): m is { role: string; content: unknown } =>
        !!m && typeof m === "object" && ((m as { role?: string }).role === "system" || (m as { role?: string }).role === "developer"))
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("\n");
  } else if (typeof obj.instructions === "string") {
    // Responses API は system 相当を instructions に持つ
    systemText = obj.instructions;
  }
  const toolsJson = obj.tools != null ? JSON.stringify(obj.tools) : "";
  if (!systemText && !toolsJson) return null;
  return promptCacheKeyFromParts(systemText, toolsJson);
}

// 解決したキー (クライアント指定 or 導出) を書き戻すための受け皿。
export interface PromptCacheKeySink {
  promptCacheKey?: string;
}

// AI SDK (openai / azure / responses) が組み立てた上流リクエストボディに prompt_cache_key を補う fetch ラッパー。
// @ai-sdk/openai は prompt_cache_key を素通ししない (baseArgs が固定) ため、fetch 層で注入する。
// クライアント (= SDK 経由のボディ) が既に prompt_cache_key を持っていればそれを尊重する。
// 解決したキーは sink.promptCacheKey に書き戻し、ハンドラーが /logs へ記録できるようにする。
export function makePromptCacheKeyFetch(
  baseFetch: typeof globalThis.fetch,
  sink?: PromptCacheKeySink,
): typeof globalThis.fetch {
  return async (input, init) => {
    try {
      let bodyText: string | undefined;
      if (typeof init?.body === "string") bodyText = init.body;
      else if (input instanceof Request) bodyText = await input.clone().text();

      if (bodyText) {
        const obj = JSON.parse(bodyText) as Record<string, unknown>;
        if (obj && typeof obj === "object") {
          const existing = obj.prompt_cache_key;
          if (typeof existing === "string" && existing !== "") {
            if (sink) sink.promptCacheKey = existing;
          } else {
            const key = deriveKeyFromBody(obj);
            if (key) {
              obj.prompt_cache_key = key;
              if (sink) sink.promptCacheKey = key;
              const newBody = JSON.stringify(obj);
              if (input instanceof Request) {
                return baseFetch(new Request(input, { body: newBody }));
              }
              return baseFetch(input, { ...init, body: newBody });
            }
          }
        }
      }
    } catch {
      // 解析・書き換えに失敗したら何もせず素通しする (キャッシュキー注入は best-effort)
    }
    return baseFetch(input, init);
  };
}
