// OpenAI Chat Completions API の型定義

export type ChatRole = "system" | "developer" | "user" | "assistant" | "tool";

export interface ChatTextContentPart {
  type: "text";
  text: string;
}
export interface ChatImageContentPart {
  type: "image_url";
  image_url: { url: string; detail?: string };
}
export type ChatContentPart = ChatTextContentPart | ChatImageContentPart;

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: ChatRole;
  content?: string | ChatContentPart[] | null;
  name?: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

export type ChatToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

// リクエスト。未知フィールドは型に現れないが runtime オブジェクトには残るため、
// パススルー時は JSON.stringify(body) でそのまま上流へ転送される
export interface ChatCompletionsRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stop?: string | string[];
  tools?: ChatTool[];
  tool_choice?: ChatToolChoice;
}

export type ChatFinishReason = "stop" | "length" | "tool_calls" | "content_filter" | null;

// 非ストリーミングレスポンス (Gemini 変換パス用)
export interface ChatCompletionResponseMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ChatToolCall[];
}
export interface ChatCompletionChoice {
  index: number;
  message: ChatCompletionResponseMessage;
  finish_reason: ChatFinishReason;
}
export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
}

// ストリーミングチャンク (Gemini 変換パス用)
export interface ChatCompletionChunkToolCall {
  index: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
}
export interface ChatCompletionChunkDelta {
  role?: "assistant";
  content?: string;
  tool_calls?: ChatCompletionChunkToolCall[];
}
export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: ChatFinishReason;
}
export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  usage?: ChatCompletionUsage | null;
}
