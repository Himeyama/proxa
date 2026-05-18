import { Hono } from "hono";
import { handleMessages } from "./handlers/messages.js";

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

  // ヘルスチェック
  app.get("/", (c) => c.json({ status: "ok" }));

  // Anthropic Messages API エンドポイント
  app.post("/v1/messages", handleMessages);

  // 未定義ルート
  app.notFound((c) => c.json({ type: "error", error: { type: "not_found_error", message: "Not found" } }, 404));

  return app;
}
