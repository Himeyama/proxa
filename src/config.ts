import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url:         { type: "string",  short: "u" },
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
  -u, --url <url>         Upstream base URL (default: http://localhost:11434/v1)
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

export type AuthType = "bearer" | "api-key";

export const config = {
  baseURL:      String(values.url         ?? process.env.CHAT_BASE_URL      ?? "http://localhost:11434/v1"),
  port:         Number(values.port        ?? process.env.PORT               ?? 3000),
  apiKey:       values["api-key"] != null ? String(values["api-key"]) : (process.env.CHAT_API_KEY ?? ""),
  authType:     String(values["auth-type"] ?? process.env.CHAT_AUTH_TYPE    ?? "bearer") as AuthType,
  defaultModel: process.env.CHAT_DEFAULT_MODEL ?? "",
};
