import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url:       { type: "string",  short: "u" },
    port:      { type: "string",  short: "p" },
    "api-key": { type: "string",  short: "k" },
    "auth-type": { type: "string" },           // "bearer" | "api-key"
  },
  strict: false,
});

export type AuthType = "bearer" | "api-key";

export const config = {
  baseURL:      String(values.url         ?? process.env.CHAT_BASE_URL      ?? "http://localhost:11434/v1"),
  port:         Number(values.port        ?? process.env.PORT               ?? 3000),
  apiKey:       values["api-key"] != null ? String(values["api-key"]) : (process.env.CHAT_API_KEY ?? ""),
  authType:     String(values["auth-type"] ?? process.env.CHAT_AUTH_TYPE    ?? "bearer") as AuthType,
  defaultModel: process.env.CHAT_DEFAULT_MODEL ?? "",
};
