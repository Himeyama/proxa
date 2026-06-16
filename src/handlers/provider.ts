import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV1 } from "ai";
import { config } from "../config.js";

export function isGoogleProvider(providerName: string): boolean {
  return providerName === "google" || providerName === "gemini";
}

export function isResponsesProvider(providerName: string): boolean {
  return providerName === "responses";
}

// Gemini 用の中継 fetch。SDK が組み立てた {baseURL}/models/{model}:generateContent を無視し、
// 設定された relayURL へ verbatim 転送する (ストリーミング判定の ?alt=sse などクエリは引き継ぐ)。
// フロー: gemini SDK → この fetch (中継) → relayURL
// Gemini のキャッシュトークン (usageMetadata.cachedContentTokenCount) を回収するための入れ物。
// @ai-sdk/google は cachedContentTokenCount を usage / providerMetadata のどちらにも載せない
// (zod スキーマが捨てる) ため、レスポンスを fetch 層で覗いて書き戻す。
// ツールループ (maxSteps) で複数回 fetch される場合は各ステップ分を加算する。
export interface CacheCapture {
  inputCacheTokens: number;
  // 進行中のレスポンス解析。値を読む前に await する。
  pending: Array<Promise<void>>;
}

export function createCacheCapture(): CacheCapture {
  return { inputCacheTokens: 0, pending: [] };
}

function extractCachedContentCount(json: string): number | null {
  try {
    const obj = JSON.parse(json) as { usageMetadata?: { cachedContentTokenCount?: number } };
    const n = obj.usageMetadata?.cachedContentTokenCount;
    return typeof n === "number" ? n : null;
  } catch {
    return null;
  }
}

// tee した片側を読み切り、SSE / JSON のどちらからでも cachedContentTokenCount を回収する。
async function readGeminiCacheTokens(stream: ReadableStream<Uint8Array>, capture: CacheCapture): Promise<void> {
  try {
    const text = await new Response(stream).text();
    let found = 0;
    if (text.includes("data:")) {
      // SSE: data: {json} 行ごとに見て、最後に現れた cachedContentTokenCount を採用する
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        const n = extractCachedContentCount(payload);
        if (n != null) found = n;
      }
    } else {
      const n = extractCachedContentCount(text);
      if (n != null) found = n;
    }
    capture.inputCacheTokens += found;
  } catch {
    // 解析できなければキャッシュ 0 のまま (本流には影響させない)
  }
}

// Gemini レスポンスを tee し、片側を背後で解析して capture に書き戻す fetch ラッパー。
// もう片側は SDK へそのまま渡すためストリーミング/非ストリーミングの挙動は変わらない。
function makeGeminiCacheCaptureFetch(
  baseFetch: typeof globalThis.fetch,
  capture: CacheCapture,
): typeof globalThis.fetch {
  return async (input, init) => {
    const res = await baseFetch(input, init);
    if (!res.ok || !res.body) return res;
    const [forSdk, forCapture] = res.body.tee();
    capture.pending.push(readGeminiCacheTokens(forCapture, capture));
    // fetch (undici) は本体を既に展開済みだがヘッダーには content-encoding/length が残るため除去する
    const headers = new Headers(res.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(forSdk, { status: res.status, statusText: res.statusText, headers });
  };
}

function makeGeminiRelayFetch(relayURL: string): typeof globalThis.fetch {
  const relayFetch: typeof globalThis.fetch = (input, init) => {
    const originalURL =
      typeof input === "string" ? input
      : input instanceof URL ? input.toString()
      : input.url;
    const target = new URL(relayURL);
    const qIndex = originalURL.indexOf("?");
    if (qIndex !== -1) {
      new URLSearchParams(originalURL.slice(qIndex + 1)).forEach((value, key) => {
        target.searchParams.set(key, value);
      });
    }
    if (typeof input === "string" || input instanceof URL) {
      return globalThis.fetch(target.toString(), init);
    }
    // Request オブジェクトの場合は URL を差し替えて再構築する
    return globalThis.fetch(new Request(target.toString(), input), init);
  };
  return relayFetch;
}

export function getProvider(apiKey: string, capture?: CacheCapture) {
  const { baseURL, customBaseURL, authType, providerName, geminiRelayURL } = config;
  if (isGoogleProvider(providerName)) {
    // relay 時は SDK の URL 組み立てを fetch で上書きするため baseURL は無視する。
    // capture 指定時はレスポンスを覗いて cachedContentTokenCount を回収する fetch でラップする。
    const baseFetch = geminiRelayURL ? makeGeminiRelayFetch(geminiRelayURL) : globalThis.fetch;
    const fetchImpl = capture
      ? makeGeminiCacheCaptureFetch(baseFetch, capture)
      : (geminiRelayURL ? baseFetch : undefined);
    const urlOpts: { fetch?: typeof globalThis.fetch; baseURL?: string } = {};
    if (fetchImpl) urlOpts.fetch = fetchImpl;
    if (!geminiRelayURL && customBaseURL) urlOpts.baseURL = customBaseURL;
    // 認証ヘッダー: 既定は SDK ネイティブの x-goog-api-key。--auth-type で上書き可能。
    if (authType === "bearer" || authType === "api-key") {
      // SDK が必ず付ける x-goog-api-key を undefined で抑制し (fetch 直前に removeUndefinedEntries で除去される)、
      // 選択したヘッダーに -k の値を載せる。apiKey は loadApiKey が落ちないよう string であれば何でもよい (値はヘッダー抑制で破棄)。
      const overrideHeader =
        authType === "bearer" ? { Authorization: `Bearer ${apiKey}` } : { "api-key": apiKey };
      return createGoogleGenerativeAI({
        apiKey: apiKey || "x-goog",
        headers: { "x-goog-api-key": undefined, ...overrideHeader },
        ...urlOpts,
      });
    }
    // 既定 (x-goog-api-key)。relay 時に中継先が Google 認証を要求しないケースでもキー欠如で SDK が落ちないようプレースホルダを補う。
    return createGoogleGenerativeAI({ apiKey: geminiRelayURL ? (apiKey || "relay") : apiKey, ...urlOpts });
  }
  if (authType === "api-key") {
    return createOpenAI({
      apiKey: "no-key",
      baseURL,
      headers: { "api-key": apiKey },
      compatibility: "compatible",
    });
  }
  return createOpenAI({ apiKey, baseURL, compatibility: "compatible" });
}

export function resolveModel(requestedModel: string): string {
  // CLI / 環境変数の強制指定 → クライアント指定。どちらも無ければ空文字
  // (undefined を返すと下流 SDK が modelId.includes などで落ちるため必ず string にする)
  return config.defaultModel || requestedModel || "";
}

export function getLanguageModel(provider: ReturnType<typeof getProvider>, model: string): LanguageModelV1 {
  return (
    isResponsesProvider(config.providerName)
      ? (provider as ReturnType<typeof createOpenAI>).responses(model)
      : provider(model)
  ) as LanguageModelV1;
}

export function stripEmptyStringValues(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return (args ?? {}) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (value !== "") result[key] = value;
  }
  return result;
}

export function extractUpstreamError(err: unknown): { type: string; message: string; statusCode: number } {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const statusCode = typeof e.statusCode === "number" ? e.statusCode : 502;
    const data = e.data as Record<string, unknown> | undefined;
    const upstreamError = data?.error as Record<string, unknown> | undefined;
    if (upstreamError) {
      return {
        type: typeof upstreamError.type === "string" ? upstreamError.type : "api_error",
        message: typeof upstreamError.message === "string" ? upstreamError.message : String(err),
        statusCode,
      };
    }
    const message = typeof e.message === "string" ? e.message : "Upstream error";
    return { type: "api_error", message, statusCode };
  }
  return { type: "api_error", message: "Upstream error", statusCode: 502 };
}

export function makeId(prefix: string): string {
  return `${prefix}${crypto.randomUUID().replace(/-/g, "")}`;
}

// AI SDK の providerMetadata からキャッシュトークン数を抽出する。
// OpenAI 系: providerMetadata.openai.cachedPromptTokens (prompt/input_tokens_details.cached_tokens 由来)。
// Gemini: providerMetadata に載らないため fetch 層で回収した capture をフォールバックに使う。
// 出力キャッシュを報告する上流は現状ないため 0。
export function extractCacheTokens(providerMetadata: unknown, capture?: CacheCapture): {
  inputCacheTokens: number;
  outputCacheTokens: number;
} {
  const meta = providerMetadata as Record<string, Record<string, unknown> | undefined> | undefined;
  const openai = meta?.openai;
  const cached = openai?.cachedPromptTokens;
  const fromMetadata = typeof cached === "number" ? cached : 0;
  return {
    inputCacheTokens: fromMetadata || (capture?.inputCacheTokens ?? 0),
    outputCacheTokens: 0,
  };
}

// 背後のレスポンス解析 (capture) の完了を待ってから extractCacheTokens を呼ぶ非同期版。
// Gemini のキャッシュトークンは fetch 層で回収されるため、値を読む前に解析完了を待つ必要がある。
export async function resolveCacheTokens(providerMetadata: unknown, capture?: CacheCapture): Promise<{
  inputCacheTokens: number;
  outputCacheTokens: number;
}> {
  if (capture) await Promise.all(capture.pending);
  return extractCacheTokens(providerMetadata, capture);
}
