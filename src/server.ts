import { Hono, type Context } from "hono";
import { handleMessages } from "./handlers/messages.js";
import { handleResponses } from "./handlers/responses.js";
import { handleChatCompletions } from "./handlers/chat-completions.js";
import { handleGenerateContent } from "./handlers/gemini.js";
import { usagePage } from "./usage-page.js";
import { messagesTestPage } from "./messages-test-page.js";
import { responsesTestPage } from "./responses-test-page.js";
import { chatCompletionsTestPage } from "./chat-completions-test-page.js";
import { geminiTestPage } from "./gemini-test-page.js";
import { logsPage } from "./logs-page.js";
import { getLogs, clearLogs } from "./log-store.js";

// ANSI カラーコード
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
} as const;

export function highlightJson(json: string): string {
  return json.replace(
    /("(?:[^"\\]|\\.)*")(\s*:)?|(\btrue\b|\bfalse\b|\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match, str, colon, keyword, number) => {
      if (str && colon) return `${C.cyan}${str}${C.reset}${colon}`;  // キー
      if (str)          return `${C.green}${str}${C.reset}`;         // 文字列値
      if (keyword)      return `${C.yellow}${keyword}${C.reset}`;    // true/false/null
      if (number)       return `${C.blue}${number}${C.reset}`;       // 数値
      return match;
    }
  );
}

function colorMethod(method: string): string {
  switch (method) {
    case "GET":    return `${C.green}${C.bold}GET   ${C.reset}`;
    case "POST":   return `${C.cyan}${C.bold}POST  ${C.reset}`;
    case "PUT":    return `${C.yellow}${C.bold}PUT   ${C.reset}`;
    case "DELETE": return `${C.magenta}${C.bold}DELETE${C.reset}`;
    default:       return `${C.bold}${method.padEnd(6)}${C.reset}`;
  }
}

export function createApp() {
  const app = new Hono();

  const SENSITIVE_HEADERS = new Set(["authorization", "x-api-key", "api-key"]);

  // リクエストロガー
  app.use("*", async (c, next) => {
    const method = colorMethod(c.req.method);
    const url = `${C.cyan}${c.req.path}${C.reset}`;
    const headerLines = [...c.req.raw.headers.entries()]
      .map(([k, v]) => {
        const masked = SENSITIVE_HEADERS.has(k.toLowerCase())
          ? `${v.slice(0, 8)}***`
          : v;
        return `  ${C.dim}${k}:${C.reset} ${masked}`;
      })
      .join("\n");

    console.log(`${method} ${url}\n${headerLines}`);
    await next();
  });

  // ブラウザには使用法ページ、API クライアントにはヘルスチェック JSON を返す
  app.get("/", (c) => {
    const accept = c.req.header("accept") ?? "";
    if (accept.includes("text/html")) {
      return c.html(usagePage);
    }
    return c.json({ status: "ok" });
  });

  // GET /v1/messages → ブラウザにはテストページ
  app.get("/v1/messages", (c) => {
    const accept = c.req.header("accept") ?? "";
    if (accept.includes("text/html")) {
      return c.html(messagesTestPage);
    }
    return c.json({ status: "ok" });
  });

  // Anthropic Messages API エンドポイント
  app.post("/v1/messages", handleMessages);

  // GET /v1/responses → ブラウザにはテストページ
  app.get("/v1/responses", (c) => {
    const accept = c.req.header("accept") ?? "";
    if (accept.includes("text/html")) {
      return c.html(responsesTestPage);
    }
    return c.json({ status: "ok" });
  });

  // OpenAI Responses API エンドポイント
  app.post("/v1/responses", handleResponses);

  // GET /v1/chat/completions → ブラウザにはテストページ
  app.get("/v1/chat/completions", (c) => {
    const accept = c.req.header("accept") ?? "";
    if (accept.includes("text/html")) {
      return c.html(chatCompletionsTestPage);
    }
    return c.json({ status: "ok" });
  });

  // OpenAI Chat Completions API エンドポイント
  // Chat Completions 互換の上流へはパススルー、Gemini へは変換して転送する
  app.post("/v1/chat/completions", handleChatCompletions);

  // Google Gemini API 互換エンドポイント (/v1beta/models/{model}:generateContent 形式)。
  // クライアントから Gemini 形式を受け取り、上流 (Chat Completions / Gemini) へ変換して転送する。
  // GET → ブラウザにはテストページ、API クライアントには {"status":"ok"}
  const geminiGetHandler = (c: Context) => {
    const accept = c.req.header("accept") ?? "";
    if (accept.includes("text/html")) {
      return c.html(geminiTestPage);
    }
    return c.json({ status: "ok" });
  };
  app.get("/v1beta/models/:modelAction", geminiGetHandler);
  app.get("/v1/models/:modelAction", geminiGetHandler);
  app.post("/v1beta/models/:modelAction", handleGenerateContent);
  app.post("/v1/models/:modelAction", handleGenerateContent);

  // GET /logs → 通信ログ閲覧ページ (HTML)
  app.get("/logs", (c) => c.html(logsPage));

  // GET /logs/data → 通信ログを JSON で返す (閲覧ページが取得)
  app.get("/logs/data", (c) => c.json(getLogs()));

  // DELETE /logs/data → 通信ログをクリア
  app.delete("/logs/data", (c) => {
    clearLogs();
    return c.json({ status: "ok" });
  });

  // 未定義ルート
  app.notFound((c) => c.json({ type: "error", error: { type: "not_found_error", message: "Not found" } }, 404));

  return app;
}
