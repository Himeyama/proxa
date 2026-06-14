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
  outputTokens: number;
  /** 所要時間 (ms)。pending 中は 0 */
  durationMs: number;
  /** 元のリクエストボディ (プロンプト情報) */
  request: unknown;
  response?: LogResponse;
  error?: string;
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
}

// リクエスト開始時にエントリを作成して登録する。
// 返り値のエントリを finishLog で更新する (配列内の参照を直接書き換える)。
export function startLog(init: StartLogInit): LogEntry {
  const entry: LogEntry = {
    id: newId(),
    timestamp: Date.now(),
    status: "pending",
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    ...init,
  };
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
  return entry;
}

export interface FinishLogData {
  inputTokens?: number;
  outputTokens?: number;
  response?: LogResponse;
  error?: string;
}

// 完了時にトークン数・所要時間・レスポンス (またはエラー) を記録する。
export function finishLog(entry: LogEntry, data: FinishLogData): void {
  entry.durationMs = Date.now() - entry.timestamp;
  if (data.inputTokens != null) entry.inputTokens = data.inputTokens;
  if (data.outputTokens != null) entry.outputTokens = data.outputTokens;
  if (data.response) entry.response = data.response;
  if (data.error != null) {
    entry.error = data.error;
    entry.status = "error";
  } else {
    entry.status = "ok";
  }
}

export function getLogs(): LogEntry[] {
  return logs;
}

export function clearLogs(): void {
  logs.length = 0;
}
