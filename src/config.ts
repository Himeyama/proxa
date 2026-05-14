import { parseArgs } from "node:util";

const PROVIDER_URLS: Record<string, string> = {
  ollama: "http://localhost:11434/v1",
  openai: "https://api.openai.com/v1",
};

const { values } = parseArgs({
  options: {
    url:         { type: "string",  short: "u" },
    provider:    { type: "string" },
    port:        { type: "string",  short: "p" },
    "api-key":   { type: "string",  short: "k" },
    "auth-type": { type: "string" },
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
      --provider <name>   Upstream provider: ollama | openai (default: ollama)
  -u, --url <url>         Upstream base URL (overrides --provider)
  -p, --port <port>       Listen port (default: 3000)
  -k, --api-key <key>     Upstream API key
      --auth-type <type>  Auth header type: bearer | api-key (default: bearer)
  -h, --help              Show this help

Environment variables (overridden by CLI options):
  CHAT_BASE_URL           Upstream base URL
  PORT                    Listen port
  CHAT_API_KEY            Upstream API key
  CHAT_AUTH_TYPE          Auth header type
  CHAT_DEFAULT_MODEL      Default model name
`);
  process.exit(0);
}

function resolveBaseURL(): string {
  if (values.url && values.provider) {
    console.warn(`\x1b[33mWarning: --url and --provider are both specified. --url takes precedence.\x1b[0m`);
  }
  if (values.url) return String(values.url);
  if (process.env.CHAT_BASE_URL) return process.env.CHAT_BASE_URL;
  const provider = values.provider ?? "ollama";
  const url = PROVIDER_URLS[String(provider)];
  if (!url) {
    console.error(`Unknown provider: "${provider}". Available: ${Object.keys(PROVIDER_URLS).join(", ")}`);
    process.exit(1);
  }
  return url;
}

export type AuthType = "bearer" | "api-key";

export const config = {
  baseURL:      resolveBaseURL(),
  port:         Number(values.port        ?? process.env.PORT               ?? 3000),
  apiKey:       values["api-key"] != null ? String(values["api-key"]) : (process.env.CHAT_API_KEY ?? ""),
  authType:     String(values["auth-type"] ?? process.env.CHAT_AUTH_TYPE    ?? "bearer") as AuthType,
  defaultModel: process.env.CHAT_DEFAULT_MODEL ?? "",
};
