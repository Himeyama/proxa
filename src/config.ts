import { parseArgs } from "node:util";

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
    "gemini-relay-url": { type: "string" },
    help:        { type: "boolean", short: "h" },
  },
  strict: false,
});

if (values.help) {
  console.log(`\
ant2chat — Anthropic Messages API → OpenAI Chat Completions proxy

Usage:
  ant2chat [options]

Options:
      --provider <name>   Upstream provider: ollama | openai | responses | openrouter | google | gemini | azure (default: ollama)
  -u, --url <url>         Upstream base URL. Provider is auto-detected from the URL when --provider is omitted
  -p, --port <port>       Listen port (default: 3000)
  -k, --api-key <key>     Upstream API key
      --auth-type <type>  Auth header type: bearer | api-key | x-goog-api-key
                          (default: bearer; google/gemini: x-goog-api-key, azure: api-key)
  -m, --model <model>     Force model name (overrides client's model field)
  -g, --global            Listen on 0.0.0.0 (expose to network)
      --no-search         Disable built-in web search tool
      --gemini-relay-url <url>  For --provider google/gemini: POST every Gemini request verbatim to this exact URL
                                instead of letting the SDK build {baseURL}/models/{model}:generateContent
                                (the ?alt=sse query is preserved for streaming)
  -h, --help              Show this help

Environment variables (overridden by CLI options):
  CHAT_BASE_URL                  Upstream base URL
  PORT                           Listen port
  CHAT_API_KEY                   Upstream API key
  OPENAI_API_KEY                 API key fallback when --provider openai/responses is used
  OPENROUTER_API_KEY             API key fallback when --provider openrouter is used
  GOOGLE_GENERATIVE_AI_API_KEY   API key fallback when --provider google is used
  AZURE_OPENAI_API_KEY           API key fallback when --provider azure is used
  CHAT_AUTH_TYPE                 Auth header type
  CHAT_DEFAULT_MODEL             Default model name
  NO_SEARCH                      Disable built-in web search tool (set to "1" or "true")
  GEMINI_RELAY_URL               For --provider google/gemini: POST every Gemini request verbatim to this exact URL
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

// Gemini 専用: 設定された場合、SDK が組み立てる URL を無視してこの URL へ verbatim 転送する
const geminiRelayURL =
  values["gemini-relay-url"] != null
    ? String(values["gemini-relay-url"])
    : (process.env.GEMINI_RELAY_URL || undefined);

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
  geminiRelayURL,
};
