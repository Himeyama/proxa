// OpenAI Responses API の型定義

// リクエスト
export type ResponseInputTextPart = { type: "input_text"; text: string };
export type ResponseOutputTextPart = { type: "output_text"; text: string; annotations: [] };

export interface ResponseInputMessage {
  type?: "message";
  role: "user" | "assistant" | "system" | "developer";
  content: string | ResponseInputTextPart[] | ResponseOutputTextPart[];
}

export interface ResponseFunctionCall {
  type: "function_call";
  id: string;
  call_id: string;
  name: string;
  arguments: string;
}

export interface ResponseFunctionCallOutput {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export type ResponseInputItem = ResponseInputMessage | ResponseFunctionCall | ResponseFunctionCallOutput;

export interface ResponseTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export type ResponseToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; name: string };

export interface ResponsesRequest {
  model: string;
  input: string | ResponseInputItem[];
  instructions?: string;
  tools?: ResponseTool[];
  tool_choice?: ResponseToolChoice;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  stop?: string | string[];
  metadata?: Record<string, string>;
  previous_response_id?: string;
}

// レスポンス
export interface ResponseOutputTextContent {
  type: "output_text";
  text: string;
  annotations: [];
}

export interface ResponseOutputMessage {
  type: "message";
  id: string;
  role: "assistant";
  status: "completed" | "in_progress" | "incomplete";
  content: ResponseOutputTextContent[];
}

export interface ResponseOutputFunctionCall {
  type: "function_call";
  id: string;
  call_id: string;
  name: string;
  arguments: string;
  status: "completed" | "in_progress";
}

export type ResponseOutputItem = ResponseOutputMessage | ResponseOutputFunctionCall;

export interface ResponsesUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface ResponsesResponse {
  id: string;
  object: "response";
  created_at: number;
  model: string;
  output: ResponseOutputItem[];
  usage: ResponsesUsage;
  status: "completed" | "incomplete" | "in_progress" | "failed";
  error: null | { code: string; message: string };
  incomplete_details: null | { reason: string };
}

// SSE イベント型
type ResponseInProgress = Omit<ResponsesResponse, "output"> & { output: [] };

export type ResponsesStreamEvent =
  | { type: "response.created"; response: ResponseInProgress }
  | { type: "response.output_item.added"; output_index: number; item: ResponseOutputItem }
  | { type: "response.content_part.added"; item_id: string; output_index: number; content_index: number; part: ResponseOutputTextContent }
  | { type: "response.output_text.delta"; item_id: string; output_index: number; content_index: number; delta: string }
  | { type: "response.output_text.done"; item_id: string; output_index: number; content_index: number; text: string }
  | { type: "response.content_part.done"; item_id: string; output_index: number; content_index: number; part: ResponseOutputTextContent }
  | { type: "response.output_item.done"; output_index: number; item: ResponseOutputItem }
  | { type: "response.function_call_arguments.delta"; item_id: string; output_index: number; delta: string }
  | { type: "response.function_call_arguments.done"; item_id: string; output_index: number; arguments: string }
  | { type: "response.completed"; response: ResponsesResponse }
  | { type: "error"; code: string; message: string };
