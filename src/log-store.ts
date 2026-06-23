// 通信ログのインメモリストア。
// リクエストごとに 1 エントリを保持し、GET /logs の閲覧ページから参照する。
// プロセス内のみ・上限 MAX_LOGS 件のリングバッファ (永続化なし)。

export interface LogToolCall {
  name: string;
  arguments: string;
}

export interface LogResponse {
  text?: string;
  toolCalls?: LogToolCall[];
  stopReason?: string;
}

export interface LogEntry {
  id: string;
  /** リクエスト開始時刻 (ms epoch) */
  timestamp: number;
  /** "/v1/messages" | "/v1/responses" | "/v1/responses (ws)" | "/v1/chat/completions" */
  endpoint: string;
  /** 上流プロバイダー名 (config.providerName) */
  provider: string;
  /** 上流へ送ったモデル名 */
  model: string;
  /** クライアントが要求したモデル (--model 等で上書きされた場合のみ) */
  modelRequested?: string;
  stream: boolean;
  status: "pending" | "ok" | "error";
  inputTokens: number;
  /** キャッシュ入力トークン数 (input の内、キャッシュから読み出した分。上流が報告した場合のみ) */
  inputCacheTokens: number;
  outputTokens: number;
  /** キャッシュ出力トークン数 (上流が報告した場合のみ。現状ほぼ 0) */
  outputCacheTokens: number;
  /** 所要時間 (ms)。pending 中は 0 */
  durationMs: number;
  /** 元のリクエストボディ (プロンプト情報) */
  request: unknown;
  /** 受信リクエストの HTTP ヘッダー (認証系はマスク済み) */
  headers?: Record<string, string>;
  /** プロンプトキャッシュのルーティングキー (prompt_cache_key)。クライアント指定 or proxa が導出した値 */
  cacheKey?: string;
  response?: LogResponse;
  error?: string;
}

// 値をマスクすべき認証・機密系ヘッダー (小文字で比較)
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "x-goog-api-key",
  "api-key",
  "proxy-authorization",
  "cookie",
  "set-cookie",
]);

// 機密ヘッダー値をマスクする。"Bearer xxx" などのスキームは残し、トークンの先頭4・末尾4のみ見せる。
function maskHeaderValue(value: string): string {
  const m = value.match(/^(Bearer|Basic)\s+(.*)$/i);
  const scheme = m ? m[1] + " " : "";
  const token = m ? m[2] : value;
  if (token.length <= 8) return scheme + "••••";
  return scheme + token.slice(0, 4) + "…" + token.slice(-4);
}

// 受信ヘッダーをログ用に正規化する。Hono (Record<string,string>) と
// Node IncomingMessage (string | string[]) の両方を受け付け、機密系の値はマスクする。
export function redactHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v == null) continue;
    const value = Array.isArray(v) ? v.join(", ") : String(v);
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? maskHeaderValue(value) : value;
  }
  return out;
}

const MAX_LOGS = 200;
// 新しいものが先頭 (index 0)
const logs: LogEntry[] = [];

function newId(): string {
  return `log_${crypto.randomUUID().replace(/-/g, "")}`;
}

export interface StartLogInit {
  endpoint: string;
  provider: string;
  model: string;
  modelRequested?: string;
  stream: boolean;
  request: unknown;
  headers?: Record<string, string>;
}

// リクエスト開始時にエントリを作成して登録する。
// 返り値のエントリを finishLog で更新する (配列内の参照を直接書き換える)。
export function startLog(init: StartLogInit): LogEntry {
  const entry: LogEntry = {
    id: newId(),
    timestamp: Date.now(),
    status: "pending",
    inputTokens: 0,
    inputCacheTokens: 0,
    outputTokens: 0,
    outputCacheTokens: 0,
    durationMs: 0,
    ...init,
  };
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
  return entry;
}

export interface FinishLogData {
  inputTokens?: number;
  inputCacheTokens?: number;
  outputTokens?: number;
  outputCacheTokens?: number;
  response?: LogResponse;
  error?: string;
}

type FinishLogHook = (entry: LogEntry) => void;
const finishLogHooks: FinishLogHook[] = [];

export function onFinishLog(fn: FinishLogHook): void {
  finishLogHooks.push(fn);
}

// 完了時にトークン数・所要時間・レスポンス (またはエラー) を記録する。
export function finishLog(entry: LogEntry, data: FinishLogData): void {
  entry.durationMs = Date.now() - entry.timestamp;
  if (data.inputTokens != null) entry.inputTokens = data.inputTokens;
  if (data.inputCacheTokens != null) entry.inputCacheTokens = data.inputCacheTokens;
  if (data.outputTokens != null) entry.outputTokens = data.outputTokens;
  if (data.outputCacheTokens != null) entry.outputCacheTokens = data.outputCacheTokens;
  if (data.response) entry.response = data.response;
  if (data.error != null) {
    entry.error = data.error;
    entry.status = "error";
  } else {
    entry.status = "ok";
  }
  for (const hook of finishLogHooks) hook(entry);
}

export function getLogs(): LogEntry[] {
  return logs;
}

export function clearLogs(): void {
  logs.length = 0;
}
