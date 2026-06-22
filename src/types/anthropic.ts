// Anthropic Messages API の型定義

// プロンプトキャッシュのブレークポイント。system / メッセージ内の各ブロック / ツール定義に付く。
export type CacheControl = { type: string };

export type ContentBlockText = { type: "text"; text: string; cache_control?: CacheControl };
export type ContentBlockImage = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string };
  cache_control?: CacheControl;
};
export type ContentBlockToolUse = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
  cache_control?: CacheControl;
};
export type ContentBlockToolResult = {
  type: "tool_result";
  tool_use_id: string;
  content: string | ContentBlockText[];
  is_error?: boolean;
  cache_control?: CacheControl;
};
export type ContentBlockThinking = { type: "thinking"; thinking: string; signature?: string };
export type ContentBlockRedactedThinking = { type: "redacted_thinking"; data: string };
export type ContentBlock =
  | ContentBlockText
  | ContentBlockImage
  | ContentBlockToolUse
  | ContentBlockToolResult
  | ContentBlockThinking
  | ContentBlockRedactedThinking;

export type MessageRole = "user" | "assistant";

export interface AnthropicMessage {
  role: MessageRole;
  content: string | ContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export type AnthropicToolChoice =
  | { type: "auto" }
  | { type: "any" }
  | { type: "tool"; name: string }
  | { type: "none" };

export type SystemBlock = { type: "text"; text: string; cache_control?: CacheControl };

export type AnthropicThinkingConfig =
  | { type: "enabled"; budget_tokens: number }
  | { type: "disabled" };

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | SystemBlock[];
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  metadata?: { user_id?: string };
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  thinking?: AnthropicThinkingConfig;
}

export type AnthropicStopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use";

export type AnthropicResponseContent =
  | ContentBlockText
  | ContentBlockToolUse
  | ContentBlockThinking
  | ContentBlockRedactedThinking;

export interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicResponseContent[];
  model: string;
  stop_reason: AnthropicStopReason;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

// SSE イベント型
export type ContentBlockStartBlock =
  | ContentBlockText
  | ContentBlockThinking
  | ContentBlockRedactedThinking
  | { type: "tool_use"; id: string; name: string; input: Record<string, never> };

export type ContentBlockDeltaPayload =
  | { type: "text_delta"; text: string }
  | { type: "input_json_delta"; partial_json: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "signature_delta"; signature: string };

export type AnthropicStreamEvent =
  | { type: "message_start"; message: Omit<AnthropicResponse, "content"> & { content: [] } }
  | { type: "content_block_start"; index: number; content_block: ContentBlockStartBlock }
  | { type: "content_block_delta"; index: number; delta: ContentBlockDeltaPayload }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: { stop_reason: AnthropicStopReason; stop_sequence: string | null }; usage: { output_tokens: number } }
  | { type: "message_stop" }
  | { type: "ping" };
