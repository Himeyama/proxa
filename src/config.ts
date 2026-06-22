import { parseArgs } from "node:util";

const supportsColor = process.stdout.isTTY && !process.env.NO_COLOR;

const C = supportsColor ? {
  RED: '\x1b[0;31m',
  YELLOW: '\x1b[0;33m',
  GREEN: '\x1b[1;32m',
  CYAN: '\x1b[0;36m',
  CYAN_DIM: '\x1b[2;36m',
  GRAY: '\x1b[0;90m',
  BOLD: '\x1b[1m',
  NC: '\x1b[0m',
} : {
  RED: '',
  YELLOW: '',
  GREEN: '',
  CYAN: '',
  CYAN_DIM: '',
  GRAY: '',
  BOLD: '',
  NC: '',
};

const PROVIDER_URLS: Record<string, string> = {
  ollama: "http://localhost:11434/v1",
  openai: "https://api.openai.com/v1",
  responses: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

const { values } = parseArgs({
  options: {
    url:         { type: "string",  short: "u" },
    provider:    { type: "string" },
    port:        { type: "string",  short: "p" },
    "api-key":   { type: "string",  short: "k" },
    "auth-type": { type: "string" },
    model:       { type: "string",  short: "m" },
    global:      { type: "boolean", short: "g" },
    "no-search": { type: "boolean" },
    min:         { type: "boolean" },
    tui:         { type: "boolean" },
    "gemini-relay-url": { type: "string" },
    "gemini-cache": { type: "boolean" },
    "no-gemini-cache": { type: "boolean" },
    "gemini-cache-ttl": { type: "string" },
    "strip-system-line": { type: "string", multiple: true },
    help:        { type: "boolean", short: "h" },
  },
  strict: false,
});

if (values.help) {
  console.log(`${C.BOLD}proxa${C.NC} — Anthropic / OpenAI / Gemini API 受信 → 上流プロバイダーへ変換・転送するプロキシ

${C.GREEN}Usage:${C.NC}
  proxa [options]

${C.GREEN}Options:${C.NC}
      ${C.CYAN}--provider${C.NC} ${C.CYAN_DIM}<name>${C.NC}   Upstream provider: ollama | openai | responses | openrouter | google | gemini | azure (default: ollama)
  ${C.CYAN}-u${C.NC}, ${C.CYAN}--url${C.NC} ${C.CYAN_DIM}<url>${C.NC}         Upstream base URL. Provider is auto-detected from the URL when --provider is omitted
  ${C.CYAN}-p${C.NC}, ${C.CYAN}--port${C.NC} ${C.CYAN_DIM}<port>${C.NC}       Listen port (default: 3000)
  ${C.CYAN}-k${C.NC}, ${C.CYAN}--api-key${C.NC} ${C.CYAN_DIM}<key>${C.NC}     Upstream API key
      ${C.CYAN}--auth-type${C.NC} ${C.CYAN_DIM}<type>${C.NC}  Auth header type: bearer | api-key | x-goog-api-key
                          (default: bearer; google/gemini: x-goog-api-key, azure: api-key)
  ${C.CYAN}-m${C.NC}, ${C.CYAN}--model${C.NC} ${C.CYAN_DIM}<model>${C.NC}     Force model name (overrides client's model field)
  ${C.CYAN}-g${C.NC}, ${C.CYAN}--global${C.NC}            Listen on 0.0.0.0 (expose to network)
      ${C.CYAN}--no-search${C.NC}         Disable built-in web search tool
      ${C.CYAN}--min${C.NC}               Forward a minimal tool set: strip agent / task / scheduling
                          client tools (Agent, Task*, Cron*, ScheduleWakeup, Monitor, etc.)
                          before sending the request upstream
      ${C.CYAN}--tui${C.NC}               Show request/response logs in a full-screen terminal UI with mouse support
      ${C.CYAN}--gemini-relay-url${C.NC} ${C.CYAN_DIM}<url>${C.NC}  For --provider google/gemini: POST every Gemini request verbatim to this exact URL
                                instead of letting the SDK build {baseURL}/models/{model}:generateContent
                                (the ?alt=sse query is preserved for streaming)
      ${C.CYAN}--gemini-cache${C.NC}          For --provider google/gemini: use explicit caching (CachedContent). Enabled by
                              default. The stable prefix (systemInstruction + tools + leading contents) is
                              cached and referenced via cachedContent, so it is not re-sent each request.
                              Works with --gemini-relay-url too (generate goes via relay; cache create/delete
                              go directly to the Gemini cachedContents endpoint)
      ${C.CYAN}--no-gemini-cache${C.NC}       Disable explicit caching
      ${C.CYAN}--gemini-cache-ttl${C.NC} ${C.CYAN_DIM}<s>${C.NC}  Explicit cache TTL in seconds (default: 600)
      ${C.CYAN}--strip-system-line${C.NC} ${C.CYAN_DIM}<text>${C.NC}  Remove any line of the incoming system prompt that contains <text>
                                  (case-sensitive substring match). Comma-separated for multiple patterns;
                                  also repeatable
  ${C.CYAN}-h${C.NC}, ${C.CYAN}--help${C.NC}              Show this help

${C.GREEN}Environment variables${C.NC} (overridden by CLI options):
  ${C.CYAN}CHAT_BASE_URL${C.NC}                  Upstream base URL
  ${C.CYAN}PORT${C.NC}                           Listen port
  ${C.CYAN}CHAT_API_KEY${C.NC}                   Upstream API key
  ${C.CYAN}OPENAI_API_KEY${C.NC}                 API key fallback when --provider openai/responses is used
  ${C.CYAN}OPENROUTER_API_KEY${C.NC}             API key fallback when --provider openrouter is used
  ${C.CYAN}GOOGLE_GENERATIVE_AI_API_KEY${C.NC}   API key fallback when --provider google is used
  ${C.CYAN}AZURE_OPENAI_API_KEY${C.NC}           API key fallback when --provider azure is used
  ${C.CYAN}CHAT_AUTH_TYPE${C.NC}                 Auth header type
  ${C.CYAN}CHAT_DEFAULT_MODEL${C.NC}             Default model name
  ${C.CYAN}NO_SEARCH${C.NC}                      Disable built-in web search tool (set to "1" or "true")
  ${C.CYAN}MIN_TOOLS${C.NC}                      Forward a minimal tool set (set to "1" or "true")
  ${C.CYAN}TUI_LOG${C.NC}                        Show logs in a full-screen terminal UI (set to "1" or "true")
  ${C.CYAN}GEMINI_RELAY_URL${C.NC}               For --provider google/gemini: POST every Gemini request verbatim to this exact URL
  ${C.CYAN}GEMINI_CACHE${C.NC}                   For --provider google/gemini: explicit caching (enabled by default; set to "0" or "false" to disable)
  ${C.CYAN}GEMINI_CACHE_TTL${C.NC}               Explicit cache TTL in seconds (default: 600)
  ${C.CYAN}STRIP_SYSTEM_LINE${C.NC}              Remove any system-prompt line containing this text (comma-separated for multiple patterns)
`);
  process.exit(0);
}

const URL_PROVIDER_PATTERNS: Array<[RegExp, string]> = [
  [/\.openai\.azure\.com/, "azure"],
  [/api\.openai\.com/, "openai"],
  [/openrouter\.ai/, "openrouter"],
  [/generativelanguage\.googleapis\.com/, "google"],
  [/localhost:11434/, "ollama"],
];

function detectProviderFromURL(url: string): string {
  for (const [pattern, name] of URL_PROVIDER_PATTERNS) {
    if (pattern.test(url)) return name;
  }
  return "custom";
}

function resolveProvider(): string {
  if (values.provider) return String(values.provider);
  if (values.url) return detectProviderFromURL(String(values.url));
  return "ollama";
}

function resolveBaseURL(provider: string): string {
  if (values.url) return String(values.url);
  if (values.provider) {
    // --provider を明示した場合はそのプロバイダーの URL を優先 (CHAT_BASE_URL より上)
    if (!(provider in PROVIDER_URLS)) {
      throw new Error(`Unknown provider: "${provider}". Available: ${Object.keys(PROVIDER_URLS).join(", ")}`);
    }
    return PROVIDER_URLS[provider];
  }
  // --url のみ指定された場合: values.url は先頭の分岐で返済済み。ここには到達しない
  if (process.env.CHAT_BASE_URL) return process.env.CHAT_BASE_URL;
  return PROVIDER_URLS[provider]; // ollama デフォルト
}

export type AuthType = "bearer" | "api-key" | "x-goog-api-key";

// --auth-type / CHAT_AUTH_TYPE が未指定のときのプロバイダー別デフォルト認証ヘッダー形式
function defaultAuthType(provider: string): AuthType {
  if (provider === "azure") return "api-key";
  if (provider === "google" || provider === "gemini") return "x-goog-api-key";
  return "bearer";
}

function resolveApiKey(provider: string): string {
  if (values["api-key"] != null) return String(values["api-key"]);
  if (process.env.CHAT_API_KEY) return process.env.CHAT_API_KEY;
  if ((provider === "openai" || provider === "responses") && process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  if (provider === "openrouter" && process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  if ((provider === "google" || provider === "gemini") && process.env.GOOGLE_GENERATIVE_AI_API_KEY) return process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (provider === "azure" && process.env.AZURE_OPENAI_API_KEY) return process.env.AZURE_OPENAI_API_KEY;
  if (provider !== "ollama" && provider !== "custom" && provider !== "azure") {
    console.warn(`\x1b[33mWarning: No API key specified. Set --api-key, CHAT_API_KEY, or (for --provider openai) OPENAI_API_KEY, (for --provider openrouter) OPENROUTER_API_KEY, (for --provider google/gemini) GOOGLE_GENERATIVE_AI_API_KEY, (for --provider azure) AZURE_OPENAI_API_KEY.\x1b[0m`);
  }
  return "";
}

// models/gemini-xxx:generateContent 形式の URL からベース URL とモデル名を分解する
function parseGeminiModelURL(url: string): { baseURL: string; model: string } | null {
  const match = url.match(/^(https?:\/\/.+?)\/models\/([^/:]+)(?::[a-zA-Z]+)?$/);
  if (!match) return null;
  return { baseURL: match[1], model: match[2] };
}

const providerName = resolveProvider();
// --url で明示指定した URL のみ。CHAT_BASE_URL は他プロバイダー向けのため Google/Gemini には適用しない
const rawCustomURL = values.url ? String(values.url) : undefined;

// Google/Gemini かつ URL に /models/{model}: が含まれる場合は分解する
const geminiParsed =
  rawCustomURL && (providerName === "google" || providerName === "gemini")
    ? parseGeminiModelURL(rawCustomURL)
    : null;

const customBaseURL = geminiParsed ? geminiParsed.baseURL : rawCustomURL;
if (geminiParsed) {
  // values.url を分解後の baseURL に差し替えて resolveBaseURL が正しい値を返すようにする
  (values as Record<string, unknown>).url = geminiParsed.baseURL;
}

let resolvedBaseURL: string;
try {
  resolvedBaseURL = resolveBaseURL(providerName);
} catch (err) {
  console.error(`\x1b[31mError: ${(err as Error).message}\x1b[0m`);
  process.exit(1);
}

const noSearchEnv = process.env.NO_SEARCH === "1" || process.env.NO_SEARCH === "true";
const minToolsEnv = process.env.MIN_TOOLS === "1" || process.env.MIN_TOOLS === "true";
const tuiLogEnv = process.env.TUI_LOG === "1" || process.env.TUI_LOG === "true";
// 明示キャッシュは google/gemini で既定 ON。--no-gemini-cache / GEMINI_CACHE=0|false で無効化する。
const geminiCacheDisabled =
  Boolean(values["no-gemini-cache"]) ||
  process.env.GEMINI_CACHE === "0" ||
  process.env.GEMINI_CACHE === "false";

// 明示キャッシュの TTL (秒)。--gemini-cache-ttl → GEMINI_CACHE_TTL → 既定 600。
function resolveGeminiCacheTtl(): number {
  const raw = values["gemini-cache-ttl"] != null ? String(values["gemini-cache-ttl"]) : process.env.GEMINI_CACHE_TTL;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 600;
}

// Gemini 専用: 設定された場合、SDK が組み立てる URL を無視してこの URL へ verbatim 転送する
const geminiRelayURL =
  values["gemini-relay-url"] != null
    ? String(values["gemini-relay-url"])
    : (process.env.GEMINI_RELAY_URL || undefined);

// system プロンプトから「この文字列を含む行」を除去するパターン群を解決する。
// --strip-system-line は繰り返し指定可能 (multiple)。各値・環境変数 STRIP_SYSTEM_LINE は
// カンマ区切りで複数パターンを指定できる (各トークンは前後の空白をトリム)。
function resolveStripSystemLine(): string[] {
  const cli = values["strip-system-line"];
  const raw: string[] = Array.isArray(cli)
    ? cli.map(String)
    : cli != null
      ? [String(cli)]
      : [];
  if (process.env.STRIP_SYSTEM_LINE) raw.push(process.env.STRIP_SYSTEM_LINE);
  return raw
    .flatMap((entry) => entry.split(","))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export const config = {
  providerName,
  baseURL:       resolvedBaseURL,
  customBaseURL,
  port:          Number(values.port        ?? process.env.PORT               ?? 3000),
  global:        Boolean(values.global),
  apiKey:        resolveApiKey(providerName),
  authType:      (values["auth-type"] != null ? String(values["auth-type"]) : (process.env.CHAT_AUTH_TYPE ?? defaultAuthType(providerName))) as AuthType,
  defaultModel:  values.model != null ? String(values.model) : (process.env.CHAT_DEFAULT_MODEL ?? geminiParsed?.model ?? ""),
  noSearch:      Boolean(values["no-search"]) || noSearchEnv,
  minTools:      Boolean(values.min) || minToolsEnv,
  tuiLog:        values.tui ?? (process.env.TUI_LOG !== undefined ? tuiLogEnv : true),
  geminiRelayURL,
  geminiCache:    !geminiCacheDisabled,
  geminiCacheTtl: resolveGeminiCacheTtl(),
  stripSystemLine: resolveStripSystemLine(),
};
