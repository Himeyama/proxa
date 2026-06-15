// Google Gemini API (generateContent / streamGenerateContent) の型定義
// 参考: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent

// --- リクエスト ---

export interface GeminiPartText {
  text: string;
  /** Gemini 思考モデルの「思考」パート (includeThoughts 有効時) */
  thought?: boolean;
  thoughtSignature?: string;
}
export interface GeminiPartInlineData {
  inlineData: { mimeType: string; data: string };
}
export interface GeminiPartFileData {
  fileData: { mimeType?: string; fileUri: string };
}
export interface GeminiPartFunctionCall {
  functionCall: { name: string; args?: Record<string, unknown>; id?: string };
  thoughtSignature?: string;
}
export interface GeminiPartFunctionResponse {
  functionResponse: { name: string; response?: unknown; id?: string };
}
export type GeminiPart =
  | GeminiPartText
  | GeminiPartInlineData
  | GeminiPartFileData
  | GeminiPartFunctionCall
  | GeminiPartFunctionResponse;

export interface GeminiContent {
  role?: "user" | "model" | "function";
  parts: GeminiPart[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  parametersJsonSchema?: Record<string, unknown>;
}
export interface GeminiTool {
  functionDeclarations?: GeminiFunctionDeclaration[];
  // 組み込みツール (googleSearch / codeExecution / urlContext) は受け取っても無視する
  googleSearch?: unknown;
  codeExecution?: unknown;
  urlContext?: unknown;
}

export type GeminiFunctionCallingMode = "AUTO" | "ANY" | "NONE" | "MODE_UNSPECIFIED";
export interface GeminiFunctionCallingConfig {
  mode?: GeminiFunctionCallingMode;
  allowedFunctionNames?: string[];
}
export interface GeminiToolConfig {
  functionCallingConfig?: GeminiFunctionCallingConfig;
}

export interface GeminiThinkingConfig {
  thinkingBudget?: number;
  includeThoughts?: boolean;
}

export interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  candidateCount?: number;
  responseMimeType?: string;
  responseSchema?: unknown;
  thinkingConfig?: GeminiThinkingConfig;
}

// REST API は camelCase だが、一部 SDK は snake_case を送るため両方を任意で受ける
export interface GeminiRequest {
  contents?: GeminiContent[];
  systemInstruction?: GeminiContent;
  system_instruction?: GeminiContent;
  tools?: GeminiTool[];
  toolConfig?: GeminiToolConfig;
  tool_config?: GeminiToolConfig;
  generationConfig?: GeminiGenerationConfig;
  generation_config?: GeminiGenerationConfig;
  safetySettings?: unknown;
}

// --- レスポンス ---

export type GeminiFinishReason =
  | "STOP"
  | "MAX_TOKENS"
  | "SAFETY"
  | "RECITATION"
  | "OTHER"
  | "FINISH_REASON_UNSPECIFIED";

export interface GeminiCandidate {
  content: { role: "model"; parts: GeminiPart[] };
  finishReason?: GeminiFinishReason;
  index?: number;
  safetyRatings?: unknown[];
}

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
}

export interface GeminiResponse {
  candidates: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
}

export interface GeminiErrorResponse {
  error: { code: number; message: string; status: string };
}
