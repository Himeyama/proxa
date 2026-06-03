# ant2chat

Anthropic Messages API (`/v1/messages`)、OpenAI Responses API (`/v1/responses`)、OpenAI Chat Completions API (`/v1/chat/completions`) を受け取り、上流の Chat Completions API / Google Gemini API へ変換して転送するプロキシサーバー。

## ドキュメント更新ルール

コードに変更を加えた場合は、**必ず `AGENTS.md` と `README.md` の両方を最新の状態に更新すること。** CLI オプション・環境変数・エンドポイント・変換ルール・アーキテクチャなど、変更内容に関連するすべてのセクションを見直すこと。

## アーキテクチャ

```
クライアント
  │  POST /v1/messages          (Anthropic 形式)
  │  POST /v1/responses         (HTTP)
  │  WS   /v1/responses         (WebSocket)
  │  POST /v1/chat/completions  (OpenAI Chat Completions 形式)
  ▼
[Hono サーバー]  src/server.ts
  │
  ├─ handleMessages  src/handlers/messages.ts
  │    │  リクエスト変換 (Anthropic → CoreMessage)
  │    ▼
  │  [toMessages / toChatCompletionsTools / toGeminiTools]  src/converters/
  │
  ├─ handleResponses  src/handlers/responses.ts  (HTTP POST)
  │    │
  ├─ handleResponsesWs  src/handlers/responses-ws.ts  (WebSocket upgrade)
  │    │  リクエスト変換 (Responses API → CoreMessage)  ← emitStreamingLoop を共有
  │    ▼
  │  [toMessagesFromResponses / toToolsFromResponses]  src/converters/from-responses.ts
  │
  └─ handleChatCompletions  src/handlers/chat-completions.ts
       │  ・Chat Completions 互換の上流 → そのままパススルー (fetch で生転送)
       │  ・Gemini → 変換 (CC → Anthropic → CoreMessage、出力を CC 形式に再構築)
       ▼
     [chatMessagesToAnthropic / chatToolsToAnthropic]  src/converters/from-chat-completions.ts
  │
  │  共通プロバイダー  src/handlers/provider.ts
  │  Vercel AI SDK (ai / @ai-sdk/openai / @ai-sdk/google)
  ▼
上流エンドポイント (Chat Completions / Google Gemini API)
  │  レスポンス変換
  ▼
クライアントへ返却 (Anthropic 形式 / Responses API 形式 / Chat Completions 形式 / SSE / WebSocket)
```

## ファイル構成

```
src/
├── index.ts                     # エントリポイント。@hono/node-server で Listen
├── server.ts                    # Hono アプリ定義。ルーティングのみ
├── config.ts                    # CLI オプション・環境変数の解決
├── usage-page.ts                # GET / で返す使用法ページ (HTML)
├── messages-test-page.ts        # GET /v1/messages で返すテストページ (HTML)
├── responses-test-page.ts       # GET /v1/responses で返すテストページ (HTML)
├── chat-completions-test-page.ts # GET /v1/chat/completions で返すテストページ (HTML)
├── handlers/
│   ├── messages.ts              # POST /v1/messages の処理。ストリーム・非ストリーム両対応
│   ├── responses.ts             # POST /v1/responses の処理 + buildResponsesParams / emitStreamingLoop をエクスポート
│   ├── responses-ws.ts          # WebSocket /v1/responses の処理。emitStreamingLoop を再利用
│   ├── chat-completions.ts      # POST /v1/chat/completions の処理。パススルー / Gemini 変換を分岐
│   └── provider.ts              # getProvider / resolveModel / extractUpstreamError など共通ユーティリティ
├── converters/
│   ├── shared.ts                # toMessages / toToolChoice / filterSystem など共通変換
│   ├── to-chat-completions.ts   # Anthropic ツール定義 → Chat Completions ToolSet
│   ├── to-gemini.ts             # Anthropic ツール定義 → Gemini ToolSet
│   ├── from-responses.ts        # Responses API 入力 → CoreMessage / ToolSet / ToolChoice
│   └── from-chat-completions.ts # Chat Completions 入力 → Anthropic メッセージ / Tool / ToolChoice (Gemini 変換用アダプタ)
├── tools/
│   └── google-search.ts         # 組み込み Web 検索ツール
└── types/
    ├── anthropic.ts             # Anthropic API の型定義 (Request / Response / SSE イベント / Tool)
    ├── openai-responses.ts      # OpenAI Responses API の型定義 (Request / Response / SSE イベント)
    └── openai-chat.ts           # OpenAI Chat Completions API の型定義 (Request / Response / Chunk)
```

## CLI オプション

```
ant2chat [options]

Options:
      --provider <name>   上流プロバイダー: ollama | openai | responses | openrouter | google | gemini | azure (デフォルト: ollama)
  -u, --url <url>         上流ベース URL。--provider 省略時は URL からプロバイダーを自動判定
  -p, --port <port>       Listen ポート (デフォルト: 3000)
  -k, --api-key <key>     上流 API キー
      --auth-type <type>  認証ヘッダー形式: bearer | api-key (デフォルト: bearer)
  -m, --model <model>     モデル名を強制指定 (クライアントの model フィールドを上書き)
  -g, --global            0.0.0.0 でリッスン (ネットワークに公開)
      --no-search         組み込み Web 検索ツールを無効化
  -h, --help              ヘルプを表示
```

優先順位: **CLI オプション → 環境変数 → クライアント指定**

## 環境変数

CLI オプションで上書き可能。`.env.example` をコピーして `.env` を作成すること。

| 変数名 | 必須 | 説明 |
|---|---|---|
| `CHAT_API_KEY` | 推奨 | 上流 API の認証キー |
| `CHAT_BASE_URL` | 任意 | 上流エンドポイント。デフォルト: `http://localhost:11434/v1` |
| `CHAT_DEFAULT_MODEL` | 任意 | デフォルトモデル名。`--model` CLI オプションで上書き可能 |
| `OPENAI_API_KEY` | 任意 | `--provider openai` / `--provider responses` 使用時の API キーフォールバック |
| `OPENROUTER_API_KEY` | 任意 | `--provider openrouter` 使用時の API キーフォールバック |
| `GOOGLE_GENERATIVE_AI_API_KEY` | 任意 | `--provider google` / `--provider gemini` 使用時の API キーフォールバック |
| `AZURE_OPENAI_API_KEY` | 任意 | `--provider azure` 使用時の API キーフォールバック |
| `CHAT_AUTH_TYPE` | 任意 | 認証ヘッダー形式: bearer \| api-key |
| `PORT` | 任意 | Listen ポート。デフォルト: `3000` |
| `NO_SEARCH` | 任意 | `1` または `true` で組み込み Web 検索ツールを無効化 |

## コマンド

```bash
pnpm dev        # 開発モード (tsx watch、ホットリロードあり)
pnpm build      # TypeScript コンパイル → dist/
pnpm start      # ビルド済みファイルで起動
```

`.env` ファイルは読み込まない。環境変数はシェルから直接渡すこと。

## エンドポイント

いずれの `GET` も、ブラウザ (`Accept: text/html`) にはテストページ (HTML) を返し、API クライアントには `{"status":"ok"}` を返す。

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/` | ブラウザからは使用法ページ (HTML) を返す。API クライアントからは `{"status":"ok"}` を返す |
| `GET` | `/v1/messages` | ブラウザからは Messages API テストページ (HTML) を返す。API クライアントからは `{"status":"ok"}` を返す |
| `POST` | `/v1/messages` | Anthropic Messages API 互換エンドポイント |
| `GET` | `/v1/responses` | ブラウザからは Responses API テストページ (HTML) を返す。API クライアントからは `{"status":"ok"}` を返す |
| `POST` | `/v1/responses` | OpenAI Responses API 互換エンドポイント (HTTP) |
| `WS` | `/v1/responses` | OpenAI Responses API 互換エンドポイント (WebSocket) |
| `GET` | `/v1/chat/completions` | ブラウザからは Chat Completions API テストページ (HTML) を返す。API クライアントからは `{"status":"ok"}` を返す |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions API 互換エンドポイント。互換上流へはパススルー、Gemini へは変換 |

### `/v1/messages` の動作

- `stream: false` (省略時) → `generateText` で同期レスポンスを返す
- `stream: true` → `streamText` で SSE ストリームを返す。イベント順は Anthropic 仕様に準拠:
  `message_start` → `ping` → `content_block_start` → `content_block_delta` (×N) → `content_block_stop` → `message_delta` → `message_stop`
  - `thinking` / テキスト / `tool_use` ブロックは index で管理。テキストと `thinking` は最初の delta 到来時に open する

### サポートしているリクエストフィールド

`model` / `messages` / `system` / `max_tokens` / `max_completion_tokens` / `stream` / `temperature` / `top_p` / `stop_sequences` / `tools` / `tool_choice` / `thinking`

`max_tokens` と `max_completion_tokens` はどちらも `maxTokens` へマッピングされる。両方指定した場合は `max_tokens` が優先される。

未サポート: `top_k`、画像コンテンツ (`image` ブロックはテキスト変換時に無視される)

### 思考 (thinking) の制御

リクエストの `thinking` フィールド (`{ type: "enabled", budget_tokens }` / `{ type: "disabled" }`) を `toProviderOptions()` で各プロバイダーの `providerOptions` に変換し、`generateText` / `streamText` に渡す。

- **Google / Gemini**: `providerOptions.google.thinkingConfig` に変換。`enabled` 時は `{ thinkingBudget: budget_tokens, includeThoughts: true }`、`disabled` 時は `{ thinkingBudget: 0 }`
- **OpenAI / responses**: `providerOptions.openai.reasoningEffort` に変換。`budget_tokens` を段階へマッピング (`< 8192` → `low`、`< 24576` → `medium`、それ以上 → `high`)。`responses` プロバイダーでは加えて `reasoningSummary: "auto"` を設定し思考要約を有効化。`disabled` 時は何も設定しない
- **ollama / その他**: `thinking` は無視 (reasoning モデルはモデル側で出力を制御するため)

### `/v1/responses` の動作

OpenAI Responses API 互換エンドポイント。クライアントから Responses API 形式でリクエストを受け取り、上流へは Chat Completions として転送し、レスポンスを Responses API 形式で返す。

**HTTP POST:**
- `stream: false` (省略時) → 同期レスポンス。`{ object: "response", output: [...] }` 形式
- `stream: true` → SSE ストリーム。イベント順は OpenAI Responses API 仕様に準拠:
  - テキスト: `response.created` → `response.output_item.added` → `response.content_part.added` → `response.output_text.delta` (×N) → `response.output_text.done` → `response.content_part.done` → `response.output_item.done` → `response.completed`
  - ツール呼び出し: `response.output_item.added` → `response.function_call_arguments.delta` (×N) → `response.function_call_arguments.done` → `response.output_item.done`

**WebSocket (`ws://host/v1/responses`):**
- Codex CLI など WebSocket トランスポートを使うクライアントに対応。`index.ts` で Node.js の `upgrade` イベントを `ws` パッケージで処理する
- クライアントは接続後、最初のメッセージとしてリクエスト JSON を送信する (`ResponsesRequest` と同形式)
- サーバーは常にストリーミングとして動作し、HTTP SSE と同じイベント列を WebSocket テキストフレーム (JSON 文字列) で送信する
- 完了後サーバー側からコネクションをクローズする
- ストリーミングループは `emitStreamingLoop` (`responses.ts`) を HTTP / WebSocket で共有している

#### サポートしているリクエストフィールド

`model` / `input` (文字列 or 配列) / `instructions` / `stream` / `temperature` / `top_p` / `max_output_tokens` / `stop` / `tools` / `tool_choice`

#### 入力形式 (`input`)

- 文字列: `user` メッセージとして扱う
- 配列: 以下の要素を含む
  - `{ role: "user"|"assistant"|"system", content: "..." | [...parts] }` — 通常メッセージ
  - `{ type: "function_call", id, call_id, name, arguments }` — 過去のツール呼び出し (連続する場合は assistant ツール呼び出しメッセージにまとめる)
  - `{ type: "function_call_output", call_id, output }` — ツール呼び出し結果 (tool メッセージに変換)

#### 出力形式 (`output`)

- `{ type: "message", id, role: "assistant", status, content: [{ type: "output_text", text, annotations: [] }] }` — テキスト出力
- `{ type: "function_call", id, call_id, name, arguments, status }` — ツール呼び出し

### `/v1/chat/completions` の動作

OpenAI Chat Completions API 互換エンドポイント。上流プロバイダーによって動作が 2 通りに分岐する (`handleChatCompletions`)。

**パススルー (ollama / openai / responses / openrouter / azure / custom):**
- 上流自身が Chat Completions 互換のため、リクエストボディを `${baseURL}/chat/completions` へ `fetch` でそのまま転送し、レスポンス (JSON / SSE) をそのまま返す
- 変換を挟まないため、SDK 非対応フィールド (`n` / `logprobs` / `frequency_penalty` / `system_fingerprint` など) も透過する
- `--model` / `CHAT_DEFAULT_MODEL` 指定時は、転送前にボディの `model` フィールドのみ書き換える (それ以外は無加工)
- OpenAI 系プロバイダー (`openai` / `responses` / `azure`) では、転送前に `max_tokens` を `max_completion_tokens` へ正規化する (`max_completion_tokens` 未指定時のみ)。OpenAI の新しいモデル (o1 / o3 / gpt-5 系など) が `max_tokens` を拒否するための例外措置。`ollama` / `openrouter` / `custom` では `max_tokens` をそのまま透過する
- 認証ヘッダーは `--auth-type` に従う (`bearer` → `Authorization: Bearer`、`api-key` → `api-key`)。`config.apiKey` が空ならクライアントの `Authorization` / `x-api-key` を引き継ぐ
- パススルーは生転送のため、組み込み Web 検索などのサーバー側ツールは動作しない

**変換 (google / gemini):**
- Gemini は Chat Completions 非互換のため、AI SDK (`generateText` / `streamText`) 経由で転送し、出力を Chat Completions 形式へ再構築する
- リクエスト変換は `from-chat-completions.ts` のアダプタで一度 Anthropic 形式へ写像し、既存の `toMessages` (`flattenToolHistory: true`) / `toGeminiTools` / `toToolChoice` を再利用する
- 組み込み Web 検索ツールの注入・`maxSteps: 5` のツールループ・サーバー側ツール除外は `/v1/responses` と同等
- `stream: false` → `{ object: "chat.completion", choices: [...] }` 形式
- `stream: true` → `chat.completion.chunk` の SSE。順序は OpenAI 仕様に準拠:
  - テキスト: 先頭 `delta.role: "assistant"` → `delta.content` (×N) → `finish_reason` 付き最終チャンク → usage チャンク → `data: [DONE]`
  - ツール呼び出し: `delta.tool_calls[].{id,function.name}` (開始) → `delta.tool_calls[].function.arguments` (引数一括) → `finish_reason: "tool_calls"`

#### サポートしているリクエストフィールド

`model` / `messages` / `stream` / `temperature` / `top_p` / `max_tokens` / `max_completion_tokens` / `stop` / `tools` / `tool_choice`

- パススルー時は上記以外の未知フィールドもすべて上流へ透過する
- 変換 (Gemini) 時、`messages` の `system` / `developer` ロールは system 文字列にまとめ、`tool` ロールは直前の tool_result メッセージへ合流させる。`image_url` は変換できるが、Gemini はツール履歴をテキスト平坦化するため画像は無視される

### OpenAI Responses API プロバイダー

`--provider responses` 使用時、`getLanguageModel()` が返す OpenAI プロバイダーの `.responses(model)` を使い、上流を Chat Completions ではなく Responses API (`/v1/responses`) に転送する (`isResponsesProvider()` で判定)。ベース URL は `https://api.openai.com/v1`。reasoning モデルの思考出力は `thinking` / `redacted_thinking` ブロックに変換する (下記「変換ルール」参照)。

### OpenRouter プロバイダー

`--provider openrouter` 使用時、上流を OpenRouter の Chat Completions 互換エンドポイント (`https://openrouter.ai/api/v1`) に転送する。認証は bearer 形式で、`createOpenAI` のデフォルト経路をそのまま使う。モデル名は `anthropic/claude-3.5-sonnet` のように `<provider>/<model>` 形式で指定する (クライアントの `model` フィールドまたは `--model` / `CHAT_DEFAULT_MODEL` で指定)。

### Google / Gemini プロバイダーの制約

`--provider google` / `--provider gemini` 使用時、マルチターン会話で過去の `tool_use` / `tool_result` を `functionCall` パーツではなくテキストに変換する (`flattenToolHistory`)。Gemini 思考モデルはツール呼び出し履歴に `thought_signature` を要求するが、Anthropic フォーマットにその概念がないため署名が失われる。テキスト形式で代替することで `INVALID_ARGUMENT` エラーを回避する。

### Gemini: モデル付き URL の自動分解

`-u` に `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` のような `models/{model}:generateContent` 形式の URL を渡すと、`config.ts` の `parseGeminiModelURL()` がベース URL (`/v1beta` まで) とモデル名を分解する。`createGoogleGenerativeAI` には分解後のベース URL を渡すため、SDK の URL 組み立て (`{baseURL}/models/{model}:generateContent`) が正常に動作する。`-m` / `CHAT_DEFAULT_MODEL` が未指定の場合は URL 内のモデル名を `defaultModel` に設定する。

## 変換ルール

### リクエスト (Anthropic → OpenAI)

- `system` → `role: "system"` のメッセージとして先頭に挿入
- `messages[].content` が配列の場合:
  - `user` ロール: `text` / `image` ブロックは文字列化、`tool_result` ブロックは `role: "tool"` メッセージに変換
  - `assistant` ロール: `text` ブロックと `tool_use` ブロックを混在させたパーツ配列に変換
- `max_tokens` → `maxTokens`
- `top_p` → `topP`
- `stop_sequences` → `stopSequences`
- `tools` → Vercel AI SDK の `ToolSet` (スキーマは `jsonSchema()` でラップ)
- `tool_choice`:
  - `"auto"` → `"auto"`
  - `"any"` → `"required"`
  - `"none"` → `"none"`
  - `{ type: "tool", name }` → `{ type: "tool", toolName: name }`
- `thinking` → `providerOptions` (上記「思考 (thinking) の制御」を参照)

### レスポンス (OpenAI → Anthropic)

- `finishReason === "length"` → `stop_reason: "max_tokens"`
- `finishReason === "tool-calls"` またはツールコールが存在 → `stop_reason: "tool_use"`
- それ以外 → `stop_reason: "end_turn"`
- `usage.promptTokens` → `usage.input_tokens`
- `usage.completionTokens` → `usage.output_tokens`
- ストリーミング時の `message_start` の `input_tokens` は `0` (上流が usage を返さないため)
- 非ストリーミング時のレスポンス `content` には `thinking` / `text` / `tool_use` ブロックが混在する場合がある
- reasoning (`--provider responses` などの思考モデル) の出力:
  - 非ストリーミング: `result.reasoningDetails` を `thinking` / `redacted_thinking` ブロックに変換 (`reasoningDetails` が無い場合は `result.reasoning` 文字列を `thinking` ブロックに)
  - ストリーミング: `reasoning` パート → `thinking` ブロック (`thinking_delta`)、`reasoning-signature` → `signature_delta`、`redacted-reasoning` → `redacted_thinking` ブロック

### Chat Completions の変換 (Gemini 変換パスのみ)

パススルー時は無変換。Gemini 変換時のみ以下を適用する (`from-chat-completions.ts`)。

リクエスト (Chat Completions → Anthropic → CoreMessage):
- `system` / `developer` メッセージ → system 文字列に連結し、非 Claude モデルでは `filterSystemForNonClaudeModel` を適用
- `user` メッセージ: 文字列はそのまま、配列は `text` / `image_url` パーツを変換 (`data:` URL は base64 ソース、それ以外は URL ソース)
- `assistant` メッセージ: `content` + `tool_calls[]` を `text` + `tool_use` ブロックへ
- `tool` メッセージ: `tool_call_id` / `content` を `tool_result` ブロックへ。直前が tool_result のみの user メッセージなら合流
- `tools` (`{ type: "function", function: {...} }`) → `chatToolsToAnthropic` で Anthropic ツール定義へ写像 → `toGeminiTools`
- `tool_choice`: `"auto"`/`"none"`/`"required"` → `auto`/`none`/`any`、`{ type: "function", function: { name } }` → `{ type: "tool", name }`

レスポンス (AI SDK → Chat Completions):
- `finishReason === "length"` → `finish_reason: "length"`
- ツールコールが存在 または `finishReason === "tool-calls"` → `finish_reason: "tool_calls"`
- それ以外 → `finish_reason: "stop"`
- `usage.promptTokens` → `prompt_tokens`、`usage.completionTokens` → `completion_tokens`
- ツールコールは `choices[].message.tool_calls[]` (`{ id, type: "function", function: { name, arguments } }`)

## 依存関係

| パッケージ | 用途 |
|---|---|
| `hono` | HTTP ルーティング |
| `@hono/node-server` | Node.js アダプター |
| `ai` | `generateText` / `streamText` / `jsonSchema` |
| `@ai-sdk/openai` | OpenAI 互換プロバイダー (`createOpenAI`) |
| `@ai-sdk/google` | Google Gemini プロバイダー (`createGoogleGenerativeAI`) |
| `tsx` | 開発時 TypeScript 実行 |

## パッケージ化とインストール

### GitHub から直接インストール（推奨）

```bash
npm install -g github:himeyama/ant2chat
```

インストール時に自動でビルドされる。アンインストール:

```bash
npm uninstall -g ant2chat
```

### グローバルインストール（ローカルから）

最も手軽な方法。リポジトリをクローンして直接グローバルにインストールする。

```bash
pnpm build
npm install -g .
```

インストール後、どのディレクトリからでも `ant2chat` コマンドで起動できる:

```bash
ant2chat
```

アンインストール:

```bash
npm uninstall -g ant2chat
```

### tarball として配布

```bash
pnpm build
npm pack
```

`ant2chat-0.1.0.tgz` が生成される。他のマシンへ配布してインストール:

```bash
npm install -g ./ant2chat-0.1.0.tgz
```

アンインストール:

```bash
npm uninstall -g ant2chat
```

### npm レジストリへ公開

`package.json` の `"private": true` を削除してから:

```bash
pnpm build
npm publish
```

公開後のインストール:

```bash
npm install -g ant2chat
```

アンインストール:

```bash
npm uninstall -g ant2chat
```

### pnpm 依存関係の追加時の注意

`pnpm add` を実行した際にネイティブビルドを含む依存関係があると、`[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts` が発生する場合があります。ビルドスクリプトを許可するには:

```bash
pnpm approve-builds
```

特定パッケージだけ許可する場合は:

```bash
pnpm approve-builds esbuild@0.27.7
```

その後、`pnpm add` を再実行してください。

### グローバルインストール時の環境変数

グローバルインストール後は `.env` ファイルが読み込まれないため、環境変数を直接渡すか、シェルの設定ファイルに書く:

```bash
# 直接渡す
CHAT_API_KEY=sk-xxx CHAT_BASE_URL=https://api.example.com/v1 ant2chat

# ~/.bashrc や ~/.zshrc に追記して永続化
export CHAT_API_KEY=sk-xxx
export CHAT_BASE_URL=https://api.example.com/v1
```

Windows の場合:

```powershell
# 直接渡す
$env:CHAT_API_KEY="sk-xxx"; $env:CHAT_BASE_URL="https://api.example.com/v1"; ant2chat

# 永続化 (ユーザー環境変数)
[System.Environment]::SetEnvironmentVariable("CHAT_API_KEY", "sk-xxx", "User")
[System.Environment]::SetEnvironmentVariable("CHAT_BASE_URL", "https://api.example.com/v1", "User")
```

## 拡張ポイント

- **別プロバイダーへの対応**: `src/handlers/provider.ts` の `getProvider()` を差し替える
- **`tool_result` 内の画像対応**: `toolResultContentToString` を拡張し、`tool_result` の `content` に含まれる画像ブロックを処理する
- **認証**: `src/server.ts` に Hono ミドルウェアを追加して `x-api-key` ヘッダーを検証する
- **ロギング**: `src/server.ts` の `createApp()` に `logger()` ミドルウェア (`hono/logger`) を追加する
- **画像コンテンツ対応**: `messages[].content` の `image` ブロックを現在は無視しているが、OpenAI / Gemini のマルチモーダル形式 (base64 / URL) に変換して転送できる。`src/converters/shared.ts` の `toMessages()` を修正する
- **`/v1/models` エンドポイント**: OpenAI 互換クライアントが送るモデル一覧リクエストへ対応する。`src/server.ts` に `GET /v1/models` ルートを追加し、上流の `/models` に中継するか固定レスポンスを返す
- **サーバー側認証 (`--proxy-key`)**: `--global` でネットワーク公開する際に、リクエストの `x-api-key` ヘッダーを検証するミドルウェアを `src/server.ts` に追加する。CLI オプション `--proxy-key` または環境変数 `PROXY_API_KEY` でキーを設定できるようにする
- **`top_k` 対応**: Google / Gemini プロバイダーに限り `topK` パラメーターを渡す。`toProviderOptions()` 内で `providerOptions.google.topK` に変換する
- **フォールバック/リトライ**: `--fallback-url` オプションを追加し、上流が 5xx / タイムアウトを返したときに別のエンドポイントへ再試行する。`src/handlers/messages.ts` の `getProvider()` をリスト対応に拡張する
