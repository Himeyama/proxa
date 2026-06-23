# proxa

Anthropic Messages API (`/v1/messages`)、OpenAI Responses API (`/v1/responses`)、OpenAI Chat Completions API (`/v1/chat/completions`)、Google Gemini API (`/v1beta/models/{model}:generateContent`) を受け取り、上流の Chat Completions API / Google Gemini API へ変換して転送するプロキシサーバー。

## ドキュメント更新ルール

コードに変更を加えた場合は、**必ず `AGENTS.md` と `README.md` の両方を最新の状態に更新すること。** CLI オプション・環境変数・エンドポイント・変換ルール・アーキテクチャなど、変更内容に関連するすべてのセクションを見直すこと。

## アーキテクチャ

```
クライアント
  │  POST /v1/messages                          (Anthropic 形式)
  │  POST /v1/responses                         (HTTP)
  │  WS   /v1/responses                         (WebSocket)
  │  POST /v1/chat/completions                  (OpenAI Chat Completions 形式)
  │  POST /v1beta/models/{model}:generateContent (Google Gemini 形式)
  ▼
[Hono サーバー]  src/server.ts
  │  各ハンドラーが startLog / finishLog で通信ログを記録 (src/log-store.ts)
  │  → GET /logs (src/logs-page.ts) で閲覧
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
  ├─ handleChatCompletions  src/handlers/chat-completions.ts
  │    │  ・Chat Completions 互換の上流 → そのままパススルー (fetch で生転送)
  │    │  ・Gemini → 変換 (CC → Anthropic → CoreMessage、出力を CC 形式に再構築)
  │    ▼
  │  [chatMessagesToAnthropic / chatToolsToAnthropic]  src/converters/from-chat-completions.ts
  │
  └─ handleGenerateContent  src/handlers/gemini.ts
       │  リクエスト変換 (Gemini → Anthropic → CoreMessage、出力を Gemini 形式に再構築)
       │  上流は全プロバイダー対応 (toProviderOptions を messages.ts と共有)
       ▼
     [geminiContentsToAnthropic / geminiToolsToAnthropic]  src/converters/from-gemini.ts
  │
  │  共通プロバイダー  src/handlers/provider.ts
  │  Vercel AI SDK (ai / @ai-sdk/openai / @ai-sdk/google / @openrouter/ai-sdk-provider)
  ▼
上流エンドポイント (Chat Completions / Google Gemini API)
  │  レスポンス変換
  ▼
クライアントへ返却 (Anthropic 形式 / Responses API 形式 / Chat Completions 形式 / Gemini 形式 / SSE / WebSocket)
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
├── gemini-test-page.ts          # GET /v1beta/models/{model}:… で返すテストページ (HTML)
├── logs-page.ts                 # GET /logs で返す通信ログ閲覧ページ (HTML)
├── log-store.ts                 # 通信ログのインメモリストア (startLog / finishLog / getLogs / clearLogs)
├── tui-log.ts                   # フルスクリーン TUI ログビューア。マウスクリックで会話ログを折りたたみ表示
├── gemini-cache.ts              # Gemini 明示キャッシュ (CachedContent) を fetch 層で透過処理 (makeGeminiCacheFetch)
├── prompt-cache-key.ts          # openai/azure/responses の上流ボディに prompt_cache_key を補う (promptCacheKeyFromParts / makePromptCacheKeyFetch)
├── handlers/
│   ├── messages.ts              # POST /v1/messages の処理。ストリーム・非ストリーム両対応。toProviderOptions をエクスポート
│   ├── responses.ts             # POST /v1/responses の処理 + buildResponsesParams / emitStreamingLoop をエクスポート
│   ├── responses-ws.ts          # WebSocket /v1/responses の処理。emitStreamingLoop を再利用
│   ├── chat-completions.ts      # POST /v1/chat/completions の処理。パススルー / Gemini 変換を分岐
│   ├── gemini.ts                # POST /v1beta/models/{model}:generateContent の処理。全プロバイダー対応
│   └── provider.ts              # getProvider / resolveModel / extractUpstreamError など共通ユーティリティ
├── converters/
│   ├── shared.ts                # toMessages / toToolChoice / filterSystem など共通変換
│   ├── to-chat-completions.ts   # Anthropic ツール定義 → Chat Completions ToolSet
│   ├── to-gemini.ts             # Anthropic ツール定義 → Gemini ToolSet
│   ├── from-responses.ts        # Responses API 入力 → CoreMessage / ToolSet / ToolChoice
│   ├── from-chat-completions.ts # Chat Completions 入力 → Anthropic メッセージ / Tool / ToolChoice (Gemini 変換用アダプタ)
│   ├── from-gemini.ts           # Gemini 入力 → Anthropic メッセージ / Tool / ToolChoice / thinking (受信用アダプタ)
│   └── salvage-tool-calls.ts    # Gemini がテキスト(JSON)で出力したツール呼び出しを復元 (サルベージ)
├── tools/
│   └── google-search.ts         # 組み込み Web 検索ツール
└── types/
    ├── anthropic.ts             # Anthropic API の型定義 (Request / Response / SSE イベント / Tool)
    ├── openai-responses.ts      # OpenAI Responses API の型定義 (Request / Response / SSE イベント)
    ├── openai-chat.ts           # OpenAI Chat Completions API の型定義 (Request / Response / Chunk)
    └── gemini.ts                # Google Gemini API の型定義 (Request / Content / Part / Tool / Response)
```

## CLI オプション

```
proxa [options]

Options:
      --provider <name>   上流プロバイダー: ollama | openai | responses | openrouter | google | gemini | azure (デフォルト: ollama)
  -u, --url <url>         上流ベース URL。--provider 省略時は URL からプロバイダーを自動判定
  -p, --port <port>       Listen ポート (デフォルト: 3000)
  -k, --api-key <key>     上流 API キー
      --auth-type <type>  認証ヘッダー形式: bearer | api-key | x-goog-api-key (デフォルト: bearer / google・gemini は x-goog-api-key / azure は api-key)
  -m, --model <model>     モデル名を強制指定 (クライアントの model フィールドを上書き)
  -g, --global            0.0.0.0 でリッスン (ネットワークに公開)
      --no-search         組み込み Web 検索ツールを無効化
      --min               最小構成のツールのみ転送する。エージェント実行・タスク管理・スケジューリング系のクライアントツール (Agent / Task* / Cron* / ScheduleWakeup / Monitor など) を上流へ送る前に除外する
      --tui               リクエスト・レスポンスのログをフルスクリーン TUI で表示する。マウスクリックで各エントリを折りたたみ表示
      --gemini-relay-url <url>  google/gemini 限定。SDK に URL を組み立てさせず、全 Gemini リクエストをこの URL へそのまま転送する
      --gemini-cache          google/gemini で明示キャッシュ (CachedContent) を使う (既定で有効)。安定プレフィックス (systemInstruction + tools + 先頭 contents) をキャッシュし cachedContent で参照することで毎回の再送を避ける。--gemini-relay-url 併用時も有効 (生成は relay 経由、作成/削除は Gemini の cachedContents へ直送)
      --no-gemini-cache       明示キャッシュを無効化する
      --gemini-cache-ttl <s>  明示キャッシュの TTL (秒)。デフォルト: 600
      --strip-system-line <text>  受信したシステムプロンプトのうち <text> を含む行を除去する (大文字小文字を区別する部分一致)。カンマ区切りで複数パターン指定可、繰り返し指定も可
      --prompt-cache-key      openai/azure/responses 限定。クライアントが prompt_cache_key を未指定のとき、system + tools のハッシュから安定したキーを補う。同一プレフィックスのリクエストを同じバックエンドへ寄せ、プロンプトキャッシュのヒット率を上げる。パススルーと AI SDK 経由 (/v1/messages 等) の両方に効く。キーは /logs に表示する
  -h, --help              ヘルプを表示
```

優先順位: **CLI オプション → 環境変数 → クライアント指定**

モデル名はこの優先順位のいずれかで必ず解決される必要がある。`--model` / `CHAT_DEFAULT_MODEL` が未設定で、かつクライアントが `model` フィールドを空欄/未指定で送った場合、各 POST ハンドラーは上流へ送る前に **HTTP 400 (`invalid_request_error` / `invalid_request`)** を返す (`No model specified. ...`)。これにより、モデル未解決時に下流 SDK が `modelId.includes` などで不明瞭なクラッシュを起こすのを防ぐ。

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
| `CHAT_AUTH_TYPE` | 任意 | 認証ヘッダー形式: bearer \| api-key \| x-goog-api-key |
| `PORT` | 任意 | Listen ポート。デフォルト: `3000` |
| `NO_SEARCH` | 任意 | `1` または `true` で組み込み Web 検索ツールを無効化 |
| `MIN_TOOLS` | 任意 | `--min` のフォールバック。`1` または `true` で最小構成のツールのみ転送 |
| `TUI_LOG` | 任意 | `--tui` のフォールバック。`1` または `true` でフルスクリーン TUI ログを有効化 |
| `GEMINI_RELAY_URL` | 任意 | `--gemini-relay-url` のフォールバック。`--provider google` / `gemini` 限定の中継先 URL |
| `GEMINI_CACHE` | 任意 | 明示キャッシュ (`--provider google` / `gemini` 限定)。**既定で有効**。`0` または `false` で無効化 (`--no-gemini-cache` と同等) |
| `GEMINI_CACHE_TTL` | 任意 | `--gemini-cache-ttl` のフォールバック。明示キャッシュの TTL (秒)。デフォルト: 600 |
| `GEMINI_CACHE_DEBUG` | 任意 | `1` / `true` で明示キャッシュの診断ログを stderr に出す (後述「明示キャッシュ: 診断」) |
| `STRIP_SYSTEM_LINE` | 任意 | `--strip-system-line` のフォールバック。カンマ区切りで複数パターン可。指定文字列を含むシステムプロンプト行を除去 |
| `PROMPT_CACHE_KEY` | 任意 | `--prompt-cache-key` のフォールバック。`1` または `true` で openai/azure/responses の全パス (パススルー + AI SDK 経由) に `prompt_cache_key` を補う |

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
| `GET` | `/v1beta/models/{model}:…` (`/v1` も可) | ブラウザからは Gemini API テストページ (HTML) を返す。API クライアントからは `{"status":"ok"}` を返す |
| `POST` | `/v1beta/models/{model}:generateContent` (`/v1` も可) | Google Gemini API 互換エンドポイント (非ストリーム) |
| `POST` | `/v1beta/models/{model}:streamGenerateContent` (`/v1` も可) | Google Gemini API 互換エンドポイント (ストリーミング、SSE) |
| `GET` | `/logs` | 通信ログ閲覧ページ (HTML) を返す |
| `GET` | `/logs/data` | 通信ログを JSON 配列で返す (閲覧ページが取得) |
| `DELETE` | `/logs/data` | 通信ログをクリアする |

### クライアント認証 (上流へのキー中継)

proxa 自身は受信リクエストを認証しない (将来の `--proxy-key` 拡張ポイント参照)。各 POST ハンドラーは上流へ渡す API キーを次の優先順位で決める。

1. サーバー側キー (`-k` / `CHAT_API_KEY` / 各プロバイダー fallback) が設定済みなら、それを使い**クライアントのヘッダーは無視する**
2. 未設定 (パススルー) ならクライアントのヘッダーから取り出す

クライアントヘッダーの読み取り順はエンドポイントの正規方式に合わせている。

| エンドポイント | 読み取り順 |
|---|---|
| `/v1/messages` (Anthropic) | `x-api-key` → `Authorization: Bearer` |
| `/v1/responses` / `/v1/chat/completions` (OpenAI) | `Authorization: Bearer` → `x-api-key` |
| `/v1beta/models/{model}:…` (Gemini) | `x-goog-api-key` → `Authorization: Bearer` → `x-api-key` → `?key=` クエリ |

`/v1/messages` は Anthropic Messages API の正規方式である `x-api-key` を優先し、Bearer トークン方式 (`ANTHROPIC_AUTH_TOKEN` など) にもフォールバック対応する。`/v1beta/models/...` は Gemini の正規方式である `x-goog-api-key` を優先する。取り出したキーは `getProvider()` 経由で上流の認証ヘッダー (OpenAI 系は `--auth-type`、Gemini は「Gemini: 認証ヘッダー」参照) に載る。

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

- **Google / Gemini**: `providerOptions.google.thinkingConfig` に変換。`enabled` 時は `{ thinkingBudget: budget_tokens, includeThoughts: true }`、`disabled` 時は `{ thinkingBudget: 0 }`。ただし **gemini-2.5-pro 系のモデルは思考をオフにできず `thinkingBudget: 0` を拒否する** (`The model does not support setting thinking_budget to 0` エラー) ため、モデル名に `pro` を含む場合 (`geminiSupportsDisablingThinking()` が `false`) は `disabled` でも `thinkingConfig` を送らず、モデル側のデフォルト (動的思考) に委ねる。`toProviderOptions()` は判定のため解決済みモデル名を引数に取る
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
- `stream: true` のときは、転送前に `stream_options.include_usage` を `true` に設定する (`ensureStreamUsage`、クライアントが明示済みなら尊重)。Azure / OpenAI / OpenRouter などは指定がないとストリーム応答に `usage` を含めず、`/logs` のトークン数が常に 0 になるため。これによりストリーム末尾の usage チャンク (`choices: []`) が送られ、`consumePassthroughSSE` がトークン数を記録できる
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

### `/v1beta/models/{model}:generateContent` の動作

Google Gemini API 互換の**受信**エンドポイント (`handleGenerateContent`)。クライアントから Gemini 形式でリクエストを受け取り、上流へは各プロバイダーの形式 (Chat Completions / Gemini) へ変換して転送し、レスポンスを Gemini 形式で返す。`/v1/messages` と同じく**全プロバイダー**に対応する (上流が Chat Completions なら `toChatCompletionsTools`、Gemini なら `toGeminiTools` + `flattenToolHistory` を使い分ける)。

- **ルーティング**: パスは `/v1beta/models/{model}:{action}` (`/v1` 版も可)。Hono の `:modelAction` パラメータで受け、`lastIndexOf(":")` でモデル名とアクションに分解する。`action` は `generateContent` (非ストリーム) / `streamGenerateContent` (ストリーミング) のみ対応。それ以外は **HTTP 400** を返す
- **モデル名**: URL パスのモデル名を `resolveModel()` に渡す (`--model` / `CHAT_DEFAULT_MODEL` 指定時はそれが優先)。解決できない場合は **HTTP 400** (Gemini エラー形式)
- **リクエスト変換**: `from-gemini.ts` のアダプタで一度 Anthropic 形式へ写像し、既存の `toMessages` / `toGeminiTools` / `toChatCompletionsTools` / `toToolChoice` を再利用する。`thinking` は `messages.ts` からエクスポートした `toProviderOptions()` で `providerOptions` に変換する
- **組み込みツール / ツールループ**: Web 検索ツールの注入・`maxSteps: 5` のツールループ・サーバー側ツール除外は `/v1/messages` と同等 (`--no-search` / `NO_SEARCH` で無効化)
- `generateContent` (非ストリーム) → `{ candidates: [{ content: { role: "model", parts: [...] }, finishReason, index }], usageMetadata, modelVersion }` 形式
- `streamGenerateContent` (ストリーミング) → SSE (`data: {...}\n\n`)。テキスト/思考/`functionCall` を `candidates[0].content.parts` に乗せて逐次送出し、最終チャンクで `finishReason` + `usageMetadata` を返す。`?alt=sse` を付けるのが標準 (公式 SDK の挙動)
- エラーは Gemini 形式 (`{ error: { code, message, status } }`) で返す

#### サポートしているリクエストフィールド

`contents` / `systemInstruction` (`system_instruction`) / `tools` / `toolConfig` (`tool_config`) / `generationConfig` (`generation_config`) — REST の camelCase と一部 SDK の snake_case の両方を受け付ける。

`generationConfig` 内では `temperature` / `topP` / `maxOutputTokens` / `stopSequences` / `thinkingConfig` を解釈する。

#### 入出力形式

- **入力 `contents[]`**: `role: "user" | "model"` と `parts[]` を持つ。`parts` の各要素を変換:
  - `{ text }` → テキスト (`model` ロールの `thought: true` パートは上流へ送らない)
  - `{ inlineData: { mimeType, data } }` → 画像 (base64 ソース)、`{ fileData: { fileUri } }` → 画像 (URL ソース)
  - `{ functionCall: { name, args, id } }` (model) → Anthropic `tool_use` (id は `id ?? name`)
  - `{ functionResponse: { name, response, id } }` (user) → Anthropic `tool_result` (`response` は JSON 文字列化)
- **`systemInstruction.parts[].text`** → system 文字列
- **`tools[].functionDeclarations[]`** → Anthropic ツール定義 (`parameters` / `parametersJsonSchema` を `input_schema` に)。`googleSearch` などの組み込みツールは無視
- **`toolConfig.functionCallingConfig.mode`** → tool_choice: `AUTO`→auto / `NONE`→none / `ANY`→any (`allowedFunctionNames` が 1 件なら特定ツール指定)
- **`generationConfig.thinkingConfig`** → thinking: `thinkingBudget === 0`→disabled / `> 0`→enabled(budget) / 動的(<0)・`includeThoughts` のみ→enabled(既定予算 8192)。`includeThoughts: true` のときのみレスポンスに `thought: true` パートを含める
- **出力 `parts[]`**: 思考 (`{ text, thought: true }`、includeThoughts 時のみ) → テキスト (`{ text }`) → `{ functionCall: { name, args } }` の順
- **`finishReason`**: `length` → `MAX_TOKENS`、それ以外 (ツール呼び出し含む) → `STOP`
- **`usageMetadata`**: `promptTokenCount` / `candidatesTokenCount` / `totalTokenCount`、キャッシュ入力があれば `cachedContentTokenCount`

### 通信ログ (`/logs`)

プロキシを通過した各リクエストを `src/log-store.ts` のインメモリストアに記録し、`GET /logs` のページで閲覧できる。

- **保存内容**: 1 リクエスト 1 エントリ。`timestamp` / `endpoint` / `provider` / `model` (`modelRequested`) / `stream` / `status` (`pending` → `ok` / `error`) / `inputTokens` / `inputCacheTokens` / `outputTokens` / `outputCacheTokens` / `durationMs` / `request` (プロンプト = system・messages・input・tools・tool_choice) / `headers` (受信 HTTP ヘッダー、認証系はマスク) / `cacheKey` (プロンプトキャッシュのルーティングキー、後述「プロンプトキャッシュキー」) / `response` (本文テキスト・ツール呼び出し) / `error`
- **ヘッダー記録**: 受信リクエストの HTTP ヘッダーを `redactHeaders()` (`log-store.ts`) で正規化して `headers` に保存する。`authorization` / `x-api-key` / `x-goog-api-key` / `api-key` / `proxy-authorization` / `cookie` / `set-cookie` は値をマスクする (`Bearer` / `Basic` のスキームは残し、トークンは先頭4・末尾4のみ表示。8文字以下は全マスク)。それ以外のヘッダー (`user-agent`・`anthropic-version` など) は素のまま。Hono パスは `c.req.header()`、WebSocket パスは `index.ts` の upgrade リクエストの `req.headers` を渡す。閲覧ページの詳細パネルに折りたたみ「ヘッダー」セクションとして表示する
- **キャッシュトークン**: `inputCacheTokens` は入力トークンのうちキャッシュから読み出した分。AI SDK 経由のパスは `extractCacheTokens()` / `resolveCacheTokens()` で `providerMetadata.openai.cachedPromptTokens` (OpenAI 系) または `providerMetadata.openrouter.usage.promptTokensDetails.cachedTokens` (OpenRouter、usage accounting 有効時) を、Chat Completions パススルーは `usage.prompt_tokens_details.cached_tokens` を読み取る。Gemini (google / gemini プロバイダー) は `cachedContentTokenCount` を `usage` にも `providerMetadata` にも載せない (`@ai-sdk/google` の zod スキーマが捨てる) ため、`getProvider()` がレスポンスを覗く fetch ラッパー (`makeGeminiCacheCaptureFetch`) を挟んで回収する。仕組み: レスポンスボディを `tee()` し、片側を背後で読んで `usageMetadata.cachedContentTokenCount` をリクエスト単位の `CacheCapture` に書き戻す (SSE / JSON 両対応、ツールループの複数ステップ分は加算)。もう片側は SDK へそのまま渡すためストリーミング挙動は変わらない。SSE / JSON の判定はまずレスポンスの `content-type` を見る (確実)。`content-type` が無い・不明な場合のみ本文の先頭 (`{` / `[` で JSON とみなす) で判定する。本文に `"data:"` が含まれるかでは判定しない — 非ストリーム JSON の出力テキストにデータ URI など `data:` が紛れると SSE と誤判定し、キャッシュ数を 0 と読み違えるため (chat completions + Gemini で input cache が 0 になる不具合の原因だった)。各ハンドラーは `getProvider(apiKey, capture)` で capture を渡し、値を読む前に `resolveCacheTokens()` が `Promise.all(capture.pending)` で背後の解析完了を待つ。出力キャッシュ (`outputCacheTokens`) を報告する上流は現状ないため常に 0 (フィールド・料金欄・合計のみ用意)
- **トークン数の取得**: 非ストリームは上流レスポンス本文の `usage` から取得する。**ストリーミング**では OpenAI 系上流が usage を返すよう、`getProvider()` が `openai` / `responses` / `azure` プロバイダーに対して `createOpenAI` を `compatibility: "strict"` で生成する (strict のときだけ SDK が `stream_options: { include_usage: true }` を送り、上流が最終チャンクで usage を返す)。`openrouter` も `createOpenRouter` を `compatibility: "strict"` + `usage: { include: true }` で生成して usage を回収する。`ollama` / `custom` は usage を自発的に返すため `compatible` のまま。上流が usage を返さないと AI SDK の `result.usage` は **NaN** になり、`JSON.stringify(NaN)` で `null` 化して `/logs` がトークン 0 (空欄) に見える。これを防ぐため各ハンドラーは `promptTokens` / `completionTokens` を `|| 0` で正規化してから SSE・レスポンス本文・`finishLog()` に渡す
- **ライフサイクル**: 各ハンドラーがリクエスト開始時に `startLog()` でエントリを作成 (配列に登録) し、完了時に `finishLog()` でトークン数・所要時間・レスポンスを書き込む。`startLog` の返り値の参照を直接書き換えるため、ストリーミング中は `pending` として一覧に出る
- **対象**: `/v1/messages`・`/v1/responses` (HTTP / WebSocket、`emitStreamingLoop` 内で記録)・`/v1/chat/completions`・`/v1beta/models/{model}:generateContent` の全パス。Chat Completions パススルーはレスポンスを解析しないため、SSE は `tee()` で 1 本を複製してバックグラウンドで `usage` / 本文を読み取り、非ストリーム JSON は本文をバッファしてから記録する (`consumePassthroughSSE` / `logPassthroughJson`)
- **パススルー (ストリーミング) のトークン数**: Azure / OpenAI / OpenRouter などは `stream_options.include_usage` が指定されないとストリーム応答に `usage` を含めないため、`handlePassthrough` が転送前に `ensureStreamUsage()` で `include_usage: true` を補う (AI SDK 経由のパスは SDK が自動付与する)。これがないとパススルーのストリーミングは入力・出力トークンが常に 0 になる。クライアントが `stream_options` を明示済みならその指定を尊重する
- **保持上限**: 直近 `MAX_LOGS` 件 (200) のリングバッファ。プロセス内のみで永続化しない。再起動でクリアされる
- **閲覧ページ**: 一覧に Date / Model / Provider / Input / In cache / Output / Cost / Speed (= `outputTokens ÷ durationMs`、tok/s) を表示。**Input 列は入力トークンから入力キャッシュ分を除いた値** (`inputTokens − inputCacheTokens`) を表示し、キャッシュ読み出し分は In cache 列に分離する (行・合計・詳細パネルすべて共通)。横に長い場合は一覧テーブルを縮めず横スクロールさせる (`.table-wrap` が `overflow-x: auto`)。行をクリックすると概要・ヘッダー (折りたたみ)・プロンプト (ロール別)・レスポンス・生 JSON を右ペインに表示する。「更新」「自動更新 (3秒)」「料金表」「クリア」操作あり。一覧の下に合計 (入力・入力キャッシュ・出力・出力キャッシュ・コスト) を表示する
- **料金表 / コスト**: 「料金表」ボタンでエディタを開き、行ごとに Provider・Model と単価 (Input / In cache / Output / Out cache、$ / 1M tokens) を入力する。設定はブラウザの `localStorage` (`proxa_pricing`) に保存しサーバーには送らない。各ログ行の Provider と Model が料金表行と一致 (大文字小文字を問わず) すれば、`(入力 − キャッシュ) × Input + キャッシュ × In cache + (出力 − 出力キャッシュ) × Output + 出力キャッシュ × Out cache` ÷ 1,000,000 でコストを算出する。一致する料金行がなければ `—`。コスト計算はすべてページ側 (クライアント) で行う
- **為替レート / 円換算**: 料金表エディタに「1 USD = N JPY」の為替レート欄があり、`localStorage` (`proxa_usdjpy`) に保存する。レートを設定すると、コストを `$X.XXXXXX (JPY NNN)` 形式で表示する (NNN = `コスト × レート` を四捨五入した整数)。未設定時は `$X.XXXXXX` のみ。一覧・合計・詳細パネルすべてに共通の `fmtCost` で反映される
- **エンドポイント**: ページ本体 `GET /logs`、データ取得 `GET /logs/data` (JSON 配列、新しい順)、クリア `DELETE /logs/data`

### OpenAI Responses API プロバイダー

`--provider responses` 使用時、`getLanguageModel()` が返す OpenAI プロバイダーの `.responses(model)` を使い、上流を Chat Completions ではなく Responses API (`/v1/responses`) に転送する (`isResponsesProvider()` で判定)。ベース URL は `https://api.openai.com/v1`。reasoning モデルの思考出力は `thinking` / `redacted_thinking` ブロックに変換する (下記「変換ルール」参照)。

### OpenRouter プロバイダー

`--provider openrouter` 使用時、上流を OpenRouter の Chat Completions 互換エンドポイント (`https://openrouter.ai/api/v1`) に転送する。認証は bearer 形式。モデル名は `anthropic/claude-3.5-sonnet` のように `<provider>/<model>` 形式で指定する (クライアントの `model` フィールドまたは `--model` / `CHAT_DEFAULT_MODEL` で指定)。

`getProvider()` は OpenRouter を `@ai-sdk/openai` ではなく**専用プロバイダー `@openrouter/ai-sdk-provider` (`createOpenRouter`)** で生成する (`isOpenRouterProvider()` で判定)。理由は **プロンプトキャッシュ**:

- **キャッシュブレークポイントの転送 (`cache_control`)**: OpenRouter のプロンプトキャッシュは上流モデルにより発動条件が異なる。OpenAI / Grok / DeepSeek は**自動**だが、**Anthropic Claude / Gemini は `cache_control: { type: "ephemeral" }` の明示ブレークポイントが無いとキャッシュが発動しない**。クライアント (Claude Code など) は `/v1/messages` の system・直近メッセージ・ツール結果に `cache_control` を付けて送ってくるが、`@ai-sdk/openai` 経由ではこれを上流へ送る口が無く、Claude/Gemini を OpenRouter で使うとキャッシュが一切効かなかった。`createOpenRouter` は message / パートの `providerOptions.openrouter.cacheControl` を上流リクエストの `cache_control` に変換できる。`toMessages()` (`shared.ts`) が Anthropic 各ブロックの `cache_control` を CoreMessage / パートの `providerOptions.openrouter.cacheControl` へ写す (system はメッセージレベル、テキスト/画像/tool_use/tool_result はパートレベル、画像なしで文字列に潰れる user メッセージはメッセージレベルに末尾ブロックの値を付与)。OpenRouter 以外のプロバイダーはこの namespace を無視するため、写像は常時行ってよい (プロキシは Anthropic へは送らない)
- **system ブレークポイントの効果**: Anthropic のキャッシュ順序は `tools → system → messages` なので、system に付けた breakpoint は tools + system のプレフィックスをまとめてキャッシュする。ツール定義は AI SDK v4 の ToolSet 抽象では `cache_control` を表現できないが、system の breakpoint がツール定義もキャッシュ対象に含めるため実害は小さい
- **usage accounting**: `getLanguageModel()` が OpenRouter モデルを `provider(model, { usage: { include: true } })` で生成し、キャッシュトークン数を `providerMetadata.openrouter.usage.promptTokensDetails.cachedTokens` に載せてもらう。`extractCacheTokens()` がこれを読み `/logs` の In cache に反映する
- **`compatibility: "strict"`**: 本物の OpenRouter API のため strict にし、ストリーミングで `stream_options: { include_usage: true }` を送らせて usage チャンクを回収する
- **パススルー (`/v1/chat/completions`)** は無関係: ボディ verbatim 転送のため `cache_control` はそのまま OpenRouter へ届く (専用プロバイダーは AI SDK 経由の `/v1/messages`・`/v1beta/models/{model}:…`・`/v1/chat/completions` の Gemini 変換パスに効く)

### Google / Gemini プロバイダーの制約

`--provider google` / `--provider gemini` 使用時、マルチターン会話で過去の `tool_use` / `tool_result` を `functionCall` パーツではなくテキストに変換する (`flattenToolHistory`)。Gemini 思考モデルはツール呼び出し履歴に `thought_signature` を要求するが、Anthropic フォーマットにその概念がないため署名が失われる。テキスト形式で代替することで `INVALID_ARGUMENT` エラーを回避する。

### Gemini: ツール呼び出しテキスト化のサルベージ

`flattenToolHistory` の副作用として、Gemini は履歴中の `[Tool Use: ...] { JSON }` というテキスト表現を模倣し、**新しいツール呼び出しをネイティブの `functionCall` ではなくテキスト (JSON) として出力**してしまうことがある (とくにツールを 1 往復した後のマルチターンで発生しやすい)。そのままだと AI SDK はツール呼び出しと認識せず `result.text` に入り、クライアントへ「JSON のようなものがそのまま」返ってしまう。

これを防ぐため、`src/converters/salvage-tool-calls.ts` が **出力テキストからツール呼び出しを復元 (サルベージ)** する。Google プロバイダー時 (`isGoogleProvider`)、かつネイティブのツール呼び出しが 1 件も無い場合のみ、出力テキストを解析して既知ツール名に一致するツール呼び出しへ組み直す。Chat Completions の Gemini 変換パスは常に有効 (変換パス = Gemini 専用)。

- **対象フォーマット**: `salvageToolCallsFromText(text, known)` が次を拾う。
  1. 平坦化フォーマットの echo `[Tool Use: NAME]\n{ ...JSON... }`
  2. 素の JSON / コードフェンス (```` ```json ````・```` ```tool_code ```` など) 内のツール呼び出し包み: `{name|tool|tool_name|toolName|function|recipient_name}` + `{args|arguments|parameters|input|tool_input}`、`{functionCall:{...}}` / `{function:{...}}` のネスト、`arguments` が JSON 文字列のケース、`default_api.` プレフィックス除去
- **誤検出防止**: `name` が**既知ツール集合に一致する場合のみ**復元する (`buildKnownToolNames` が宣言名とサニタイズ名の両方を登録)。一致しなければテキストのまま返す。ツール呼び出しを取り除いた残りのテキストは text パートとして保持する
- **ストリーミング**: テキストデルタの先頭が `classifyStreamStart()` でツール呼び出しの始まり (`{` / `[Tool Use:` / `json|tool` 言語のフェンス) と判定された場合のみバッファし、ストリーム終了時に salvage する。判定できない (`undecided`) 間は送出を保留して次のデルタを待つ。ツール呼び出しでない通常テキスト (先頭が `{` 等でない) はそのまま逐次 live 送出するため、ストリーミング体感は維持される
  - **live モード移行後のマーカー検出**: Gemini は説明文を先に出してから `[Tool Use: ...]` echo を吐くことがある。この場合先頭は通常テキストと判定され `live` モードに入るため、そのままだとツール呼び出し echo がテキストとして垂れ流され (ツールが呼ばれない不具合)、`classifyStreamStart` の先頭判定だけでは取りこぼす。これを防ぐため、`live` モード中も各デルタを `splitLiveToolMarker()` で監視し、`[Tool Use:` マーカー (またはその前置プレフィックス) が現れたらマーカー直前までを live 送出し、マーカー以降を `textBuffer` へ移して `buffer` モードへ戻す。これによりストリーム終了時の salvage が走り、ツール呼び出しとして復元される。マーカーがデルタ境界をまたぐケースに備え、`[Tool Use:` の途中で終わる末尾は `liveHold` に保留して次のデルタを待ち、ストリーム終了時に未完なら通常テキストとして送出する。`/v1/messages`・`/v1beta/models/{model}:…`・`/v1/chat/completions` (Gemini 変換) の各ストリーミングパスに適用する
- **適用範囲 / 出力形式**: `/v1/messages` (`tool_use` ブロック)・`/v1beta/models/{model}:…` (`functionCall` パート)・`/v1/chat/completions` の Gemini 変換パス (`tool_calls`)。各パスとも stream / non-stream 両対応。復元したツール呼び出しは `stop_reason` / `finishReason` / `finish_reason` のツール判定に反映され、`/logs` の `response.toolCalls` にも記録される

### Gemini: 認証ヘッダー

google / gemini プロバイダーの認証ヘッダーは `--auth-type` (環境変数 `CHAT_AUTH_TYPE`) で選べる。**デフォルトは `x-goog-api-key`** (`config.ts` の `defaultAuthType()` が google/gemini に対して返す)。`getProvider()` の Gemini ブランチが API キー (`-k` / `CHAT_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`) を選択ヘッダーに載せる。

| `--auth-type` | 送出されるヘッダー |
|---|---|
| 未指定 / `x-goog-api-key` | `x-goog-api-key: <key>` (SDK ネイティブ) |
| `bearer` | `Authorization: Bearer <key>` |
| `api-key` | `api-key: <key>` |

- `bearer` / `api-key` を選んだ場合は、SDK が常に付与する `x-goog-api-key` を `headers: { "x-goog-api-key": undefined }` で抑制する。`@ai-sdk/provider-utils` が fetch 直前に `removeUndefinedEntries()` でこのキーを除去するため、選択したヘッダーだけが送られる
- relay (`--gemini-relay-url`) と併用した場合も、解決済みのヘッダーがそのまま中継先へ転送される
- Gemini 以外のプロバイダーに `x-goog-api-key` を指定しても効果はない (OpenAI パスは bearer 扱い)

### Gemini: モデル付き URL の自動分解

`-u` に `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` のような `models/{model}:generateContent` 形式の URL を渡すと、`config.ts` の `parseGeminiModelURL()` がベース URL (`/v1beta` まで) とモデル名を分解する。`createGoogleGenerativeAI` には分解後のベース URL を渡すため、SDK の URL 組み立て (`{baseURL}/models/{model}:generateContent`) が正常に動作する。`-m` / `CHAT_DEFAULT_MODEL` が未指定の場合は URL 内のモデル名を `defaultModel` に設定する。

### Gemini: 任意 URL への中継 (`--gemini-relay-url`)

通常 `@ai-sdk/google` は baseURL から `{baseURL}/models/{model}:generateContent` (ストリーム時は `:streamGenerateContent?alt=sse`) を必ず組み立てるため、`/v1beta` 形式に当てはまらない任意のエンドポイントへは送れない。`--gemini-relay-url <url>` (または環境変数 `GEMINI_RELAY_URL`) を指定すると、この制約を回避して **設定した URL へ verbatim 転送** する。

- 仕組み: `getProvider()` (`provider.ts`) が `createGoogleGenerativeAI` に **カスタム `fetch`** (`makeGeminiRelayFetch`) を渡す。SDK が組み立てた URL は破棄し、relay URL へ書き換えて転送する。別ポートのサーバーは立てず、プロセス内の fetch インターセプターとして中継する。フロー: `クライアント → proxa → gemini SDK → 中継 fetch → relay URL`
- クエリは引き継ぐため、ストリーミング判定の `?alt=sse` は relay URL 側にも付与される (例: 非ストリーム → `<relayURL>`、ストリーム → `<relayURL>?alt=sse`)。relay 先は `alt=sse` の有無でストリーム/非ストリームを判別できる
- relay 時は SDK の URL 組み立てを無視するため `-u` / `customBaseURL` は使われない。モデル名も URL パスに乗らない (relay 先がモデルを決める前提)。リクエストボディ・ヘッダー (`--auth-type` で解決した認証ヘッダーなど) はそのまま転送される
- relay 先が Google 認証を必要としない場合に備え、API キー未指定でも SDK が落ちないようプレースホルダ (`"relay"`) を補う。relay 先が Google 互換認証を要求するなら `-k` / `CHAT_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` で実キーを渡す
- `/v1/messages` と `/v1/chat/completions` (Gemini 変換パス) の双方に効く (どちらも `getProvider()` 経由)
- 起動時バナー (`src/index.ts`) は relay 設定時、実際の転送先である relay URL を `Upstream:  <relayURL> (relay)` と表示する (使われない SDK のベース URL は表示しない)

### Gemini: 明示キャッシュ (`--gemini-cache`)

`--provider google` / `gemini` で、Gemini の**明示キャッシュ (explicit caching / CachedContent)** を使い、安定したプレフィックス (systemInstruction + tools + 先頭の contents) を上流の `cachedContents` に保存して `cachedContent` で参照する。これにより、毎リクエストで巨大な system プロンプト・ツール定義・会話履歴を再送せずに済み、入力トークンのコストを下げられる。**google/gemini では既定で有効**で、`--no-gemini-cache` または環境変数 `GEMINI_CACHE=0`/`false` で無効化する (`--gemini-cache` は明示的に有効化する no-op の別名)。TTL は `--gemini-cache-ttl` / `GEMINI_CACHE_TTL` (秒、デフォルト 600) で指定する。`config.geminiCache` は「無効化されていない限り true」に解決され、`getProvider()` の google ブランチで参照される (relay 併用時も有効)。

- **仕組み (fetch 層で透過)**: `getProvider()` が `createGoogleGenerativeAI` に渡す fetch を `makeGeminiCacheFetch` (`src/gemini-cache.ts`) でラップする。ハンドラー側のコードは一切変更しない。SDK が組み立てた `generateContent` / `streamGenerateContent` の**リクエスト本文をインターセプト**し、`systemInstruction` / `tools` / `contents` の安定プレフィックスをキャッシュに寄せ、本文からそれらを外して `cachedContent: "cachedContents/..."` を付ける。フロー: `gemini SDK → makeGeminiCaptureFetch → makeGeminiCacheFetch → (キャッシュ作成/参照) → 上流`
- **Gemini の制約への対応**: Gemini はキャッシュ参照時に `systemInstruction` / `tools` をリクエスト本文へ重複指定できない (エラーになる) ため、キャッシュに入れた要素はリクエストから外す。一方で **SDK には tools をそのまま渡し続ける** (本文書き換えは fetch 層のみ) ため、SDK はツール定義を保持したまま `maxSteps` のツールループ・サーバー側 Web 検索の実行を継続できる。サーバー側 Web 検索 (`--no-search` で無効化) も従来どおり動く
- **プレフィックス照合 (累積ハッシュ)**: `contents` 配列を 1 要素ずつ進めながら累積ハッシュ `keys[i]` (= systemInstruction + tools + contents[0..i-1]) を計算する。レジストリ (インメモリ Map) から「現在のリクエストのプレフィックスに一致する最長の有効キャッシュ」を再利用し、残りの contents だけを送る。append-only で伸びる会話 (Claude Code など) では、前ターンで作ったキャッシュが次ターンのプレフィックスとしてヒットする
- **キャッシュ作成**: 次ターン以降の再利用のため、末尾 1 件を除いたプレフィックス (`i = contents.length - 1`) を `POST {baseURL}/cachedContents` で作成し (`ttl: "<秒>s"`)、返ってきた `name` をレジストリへ登録する。作成・削除リクエストの認証ヘッダーは SDK が付けた送信ヘッダー (`x-goog-api-key` など) を流用する
- **コスト管理 (置き換え削除)**: 再利用していた小さいキャッシュは、より大きいキャッシュを作成した時点で `DELETE {baseURL}/cachedContents/{name}` で best-effort 削除する。これにより 1 会話あたり概ね 1 個の有効キャッシュに収束させ、保管課金の累積を抑える
- **フォールバック / 堅牢性**: (1) 作成に失敗した prefix (最小トークン未満など) は短時間 (60 秒) スキップして毎回叩かない。(2) キャッシュ参照リクエストが上流で `!ok` (キャッシュ失効の可能性) を返したら、レジストリから除いて**元のリクエストで一度だけ再試行**する。(3) 本文が JSON でない・contents が空・既に `cachedContent` 参照済みなどの場合はそのまま素通しする。いずれの失敗もキャッシュ無しの通常転送に縮退する
- **キャッシュトークンの記録**: 参照成功時のレスポンスには `usageMetadata.cachedContentTokenCount` が載るため、既存の `makeGeminiCacheCaptureFetch` がそれを回収し `/logs` の In cache に反映する (作成/削除リクエストは capture でラップしないため集計に混ざらない)
- **relay 併用**: `--gemini-relay-url` 設定時も明示キャッシュは有効。**生成リクエストは relay 経由**で送りつつ、**キャッシュの作成/削除は relay へ吸い込まれないよう直 fetch (`globalThis.fetch`) で Gemini の `cachedContents` エンドポイントへ直接送る** (`makeGeminiCacheFetch(baseFetch, ttl, globalThis.fetch)` の第 3 引数 `manageFetch`)。cachedContents の URL は SDK が組み立てた元 URL (`{baseURL}/models/{model}:…`) から `/models/` 以前を取って導出する。生成と作成が同じ Gemini プロジェクト (relay 先が同一バックエンドへ転送) を指す前提。relay 先が独自認証を要求し直 fetch での作成が失敗する場合は、キャッシュ無しの通常転送 (relay 経由) へ縮退する
- **適用範囲**: `getProvider()` 経由の Gemini パス全て — `/v1/messages`・`/v1beta/models/{model}:…`・`/v1/chat/completions` (Gemini 変換パス) の stream / non-stream
- **注意 (単発リクエスト)**: プロキシは将来の再利用を予測できないため、再送されない単発リクエストではキャッシュ作成分のわずかな保管課金が無駄になる。会話を繰り返すクライアント向けの最適化である
- **起動時バナー**: 有効時 (google/gemini) に `Cache:     explicit (CachedContent, ttl <秒>s)` を表示する。relay 併用時は `..., generate via relay` を付記する

#### 明示キャッシュ: 診断 (`GEMINI_CACHE_DEBUG`)

明示キャッシュは「`systemInstruction` + `tools` + 先頭 `contents`」の**安定したプレフィックス**に依存する。プレフィックスの途中 (= 末尾以外) の要素が 1 つでも変わると、累積ハッシュ `keys[i]` がそこから先すべて変化し、以降のキャッシュが全部ミスする。「キャッシュが効くはずなのに効かない」場合、原因のほとんどは**会話途中のメッセージが前ターンと一致していない** (クライアントが過去メッセージを書き換えて再送する・`systemInstruction` や `tools` が毎ターン微妙に変わる) ことにある。

`GEMINI_CACHE_DEBUG=1` (または `true`) を指定すると、`makeGeminiCacheFetch` (`src/gemini-cache.ts`) がリクエストごとに**前リクエストとプレフィックスを比較**し、結果を stderr (`[gemini-cache] ...`) に出す。`config.geminiCacheDebug` で参照する。

- `✓ 追記のみ`: 前リクエストの全 contents が今回の先頭と一致し、末尾に追加されただけ (append-only)。キャッシュがヒットする健全な状態
- `⚠ 途中の content[i] が前リクエストから変化`: 末尾より手前の `contents[i]` が前回と変わった。`i` 以降のキャッシュは無効になる。`before[i]` / `after[i]` に変化前後のスニペット (120 字) を出すので、どのメッセージがどう書き換わったかを特定できる
- `⚠ プレフィックス基点が変化 (systemInstruction / tools)`: `systemInstruction` か `tools` が前回と変わった。**全キャッシュが無効化**される (最も影響が大きい)
- `初回リクエスト`: 比較対象がまだ無い

比較は直近 1 リクエストとの差分 (`prevRequest` をプロセス内に保持) なので、複数クライアントが同時接続すると会話が交錯して誤検出しうる。**単一の会話 (Claude Code 1 セッションなど) でキャッシュ不発を切り分ける用途**を想定している。

### システムプロンプトの行除去 (`--strip-system-line`)

クライアントが送ってきたシステムプロンプトから、指定した文字列を含む**行単位**で除去してから上流へ転送する汎用フィルタ。社内テンプレートの除去・冗長な定型文の削減・特定の指示行の差し替え前処理など、中立的なプロンプト整形に使う。

- **指定方法**: CLI `--strip-system-line <text>` または環境変数 `STRIP_SYSTEM_LINE`。各値は**カンマ区切り**で複数パターンを書け (例: `"foo,bar"`)、CLI は**繰り返し指定**もできる。CLI・環境変数・カンマ区切りはすべて合算され、各トークンは前後の空白をトリムして `config.stripSystemLine` (`string[]`) に解決される
- **マッチング**: 各行に対する**大文字小文字を区別する部分一致** (`line.includes(pattern)`)。いずれかのパターンを含む行は丸ごと削除する。パターン未指定 (空配列) なら何もしない
- **実装**: `src/converters/shared.ts` の `stripSystemLines(text)` が `\n` 区切りで該当行を除去する。システムプロンプトが文字列化される唯一の合流点である `toMessages()` (Anthropic / Gemini 受信 / Chat Completions 変換パス) と `toMessagesFromResponses()` (Responses API、HTTP / WebSocket) で適用する。Chat Completions パススルーのみ `toMessages` を通らないため、`handlePassthrough` が `body.messages` の `system` / `developer` ロール (文字列・`text` パート両対応) に直接適用する
- **全行が除去された場合**: system メッセージ自体を出力しない (空の system を上流へ送らない)
- **適用範囲**: `/v1/messages`・`/v1/responses` (HTTP / WS)・`/v1/chat/completions` (パススルー / Gemini 変換)・`/v1beta/models/{model}:…` の全エンドポイント
- **ログ表示**: `/logs` に記録される `request.system` / `instructions` は**行除去後** (=実際に上流へ送られた内容) を表示する。各ハンドラーは `finalSystemForLog()` で正規化した値を `startLog()` に渡す。Chat Completions パススルーは `body.messages` の `system` / `developer` を直接書き換えてから記録する。これにより除去が効いているかを `/logs` で確認できる

### 最小ツール構成 (`--min`)

クライアントが送ってきたツール定義のうち、エージェント実行・タスク管理・スケジューリングなど最小構成では不要なツールを、上流へ転送する前に名前で除外するフィルタ。クライアント (例: Claude Code) が大量のツールを送ってくる場合に、軽量なモデル・上流へ余計なツールを送らずに済ませる用途を想定する。

- **指定方法**: CLI `--min` (boolean) または環境変数 `MIN_TOOLS` (`1` / `true`)。`config.minTools` に解決される。未指定時は何もしない
- **除外対象**: `src/converters/shared.ts` の `MIN_EXCLUDED_TOOLS` (Set) に列挙したツール名と**完全一致**するものを除外する。現在の対象: `DesignSync` / `NotebookEdit` / `WaitForMcpServers` / `Monitor` / `PushNotification` / `ScheduleWakeup` / `TaskCreate` / `TaskGet` / `TaskList` / `TaskOutput` / `TaskStop` / `TaskUpdate` / `Agent` / `CronCreate` / `CronDelete` / `CronList` / `EnterWorktree` / `ExitWorktree` / `EnterPlanMode` / `ExitPlanMode` / `Skill` / `Workflow` / `mcp__ide__executeCode` / `mcp__ide__getDiagnostics`
- **実装**: `filterMinTools<T extends { name: string }>(tools)` が `name` フィールドを持つツール定義配列 (Anthropic / Responses) から該当ツールを除去する。各ハンドラーは受信ボディをパース後、ツールを変換・ログ記録する前に `body.tools` を `filterMinTools()` で差し替える。Gemini 受信パスは `geminiToolsToAnthropic()` の結果に適用する。Chat Completions はツール名が `function.name` に入るため、`MIN_EXCLUDED_TOOLS` を使って `body.tools` をインライン除去する (パススルー・Gemini 変換の双方に効く)
- **サーバー側ツール**: 組み込み Web 検索 (`google_search` / `WebSearch`) はクライアントツールではなくサーバー側で注入されるため `--min` の影響を受けない (無効化は `--no-search` / `NO_SEARCH`)
- **適用範囲**: `/v1/messages`・`/v1/responses` (HTTP / WS)・`/v1/chat/completions` (パススルー / Gemini 変換)・`/v1beta/models/{model}:…` の全エンドポイント
- **ログ表示**: 各ハンドラーは除外後の `body.tools` から `toolNames` を算出するため、`/logs` の `request.tools` は**除外後** (=実際に上流へ送られたツール) を表示する

### プロンプトキャッシュキー (`--prompt-cache-key`)

OpenAI / Azure のプロンプトキャッシュは、JSON 整形ではなく **messages + tools の先頭トークン列の一致**で発動するが、実際のヒット率は「**同一プレフィックスのリクエストが同じバックエンドインスタンスへルーティングされるか**」に強く依存する。ルーティングは安定キー (`prompt_cache_key`、旧 `user`) が無いと負荷分散で散るため、同じプレフィックスでもヒットが確率的になる (体感で数割しか効かない症状の主因)。`--prompt-cache-key` (環境変数 `PROMPT_CACHE_KEY=1`/`true`) は、openai/azure/responses への全パス (パススルー + AI SDK 経由) で安定したキーを補ってルーティングを固定する。

- **対象**: プロバイダーが `openai` / `azure` / `responses` のとき。`/v1/chat/completions` パススルーに加え、**AI SDK 経由の `/v1/messages`・`/v1/responses`・`/v1beta/models/{model}:…` (上流が openai 系のとき)** にも効く。Gemini 変換パス・OpenRouter・ollama・custom には効かない (`prompt_cache_key` 非対応のため)
- **キーの導出 (共通)**: `promptCacheKeyFromParts()` (`prompt-cache-key.ts`) が **system テキスト + `tools` の JSON** の SHA-256 を取り `proxa-<hex16>` を返す。メッセージ本文 (毎ターン伸びる) を含めないため、**同一会話を通じて値が一定**になりルーティングが安定する。system テキストは Chat Completions 形式なら system/developer メッセージ、Responses 形式なら `instructions` から取る
- **2 つの注入経路**:
  - **パススルー** (`chat-completions.ts` の `applyPromptCacheKey`): 受信ボディの `body.prompt_cache_key` を直接補う。`normalizeMaxTokensForOpenAI` / `ensureStreamUsage` と並ぶ例外措置として `handlePassthrough` 内で適用
  - **AI SDK 経由** (`prompt-cache-key.ts` の `makePromptCacheKeyFetch`): `@ai-sdk/openai` は `prompt_cache_key` を素通ししない (`baseArgs` 固定) ため、`getProvider()` が `createOpenAI` に渡す **fetch ラッパーで上流ボディへ注入**する。解決したキーは `CacheCapture.promptCacheKey` に書き戻し、各ハンドラー (`messages.ts` / `responses.ts` / `gemini.ts`) が `resolveCacheTokens()` 後に `logEntry.cacheKey` へ写してログ記録する
- **クライアント指定の尊重**: いずれの経路も、リクエストが既に `prompt_cache_key` を持っていればそれを**尊重**し、上書きせずログにのみ記録する
- **ログ表示**: 解決したキー (クライアント指定 or proxa 導出) を `LogEntry.cacheKey` に記録し、`/logs` 詳細パネルに「Cache key」として表示する。連続リクエストでキーが一定かを見れば system / tools が毎ターン揺れていないか確認できる
- **無効時 (既定)**: 何もしない (`config.promptCacheKey` が false なら fetch ラッパーを挟まない)。ただしクライアントが `prompt_cache_key` を付けていればその値はログに記録する

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

### Gemini の変換 (受信パス `/v1beta/models/...`)

受信した Gemini 形式を Anthropic 形式へ写像してから既存の共通変換へ流す (`from-gemini.ts`)。上流の形式 (Chat Completions / Gemini) は `/v1/messages` と同じロジックで吸収する。

リクエスト (Gemini → Anthropic → CoreMessage):
- `contents[]` の `role: "model"` → assistant、`user` / `function` → user。`parts` の各要素:
  - `{ text }` → text ブロック (model の `thought: true` は除外)
  - `{ inlineData }` → 画像 (base64)、`{ fileData }` → 画像 (URL)
  - `{ functionCall }` → `tool_use` (id = `id ?? name`)、`{ functionResponse }` → `tool_result` (`response` を JSON 文字列化、tool_use_id = `id ?? name`)
- `systemInstruction.parts[].text` → system 文字列 (非 Claude モデルでは `filterSystemForNonClaudeModel` を適用)
- `tools[].functionDeclarations[]` → `geminiToolsToAnthropic` で Anthropic ツール定義へ写像 → `toGeminiTools` / `toChatCompletionsTools`
- `toolConfig.functionCallingConfig.mode`: `AUTO`→auto / `NONE`→none / `ANY`→any (`allowedFunctionNames` が 1 件なら特定ツール)
- `generationConfig.thinkingConfig` → Anthropic `thinking` → `toProviderOptions`

レスポンス (AI SDK → Gemini):
- `finishReason === "length"` → `MAX_TOKENS`、それ以外 (ツール呼び出し含む) → `STOP`
- `result.text` → `{ text }` パート、ツールコール → `{ functionCall: { name, args } }` パート、思考 (includeThoughts 時) → `{ text, thought: true }` パート
- `usage.promptTokens` → `promptTokenCount`、`usage.completionTokens` → `candidatesTokenCount`、キャッシュ入力があれば `cachedContentTokenCount`
- 出力は `candidates[0].content.parts[]` に格納し、`modelVersion` に解決済みモデル名を載せる

## 依存関係

| パッケージ | 用途 |
|---|---|
| `hono` | HTTP ルーティング |
| `@hono/node-server` | Node.js アダプター |
| `ai` | `generateText` / `streamText` / `jsonSchema` |
| `@ai-sdk/openai` | OpenAI 互換プロバイダー (`createOpenAI`) |
| `@ai-sdk/google` | Google Gemini プロバイダー (`createGoogleGenerativeAI`) |
| `@openrouter/ai-sdk-provider` | OpenRouter プロバイダー (`createOpenRouter`)。`cache_control` ブレークポイントと usage accounting を扱う |
| `tsx` | 開発時 TypeScript 実行 |

## パッケージ化とインストール

### GitHub から直接インストール（推奨）

```bash
npm install -g github:himeyama/proxa
```

インストール時に自動でビルドされる。アンインストール:

```bash
npm uninstall -g proxa
```

### グローバルインストール（ローカルから）

最も手軽な方法。リポジトリをクローンして直接グローバルにインストールする。

```bash
pnpm build
npm install -g .
```

インストール後、どのディレクトリからでも `proxa` コマンドで起動できる:

```bash
proxa
```

アンインストール:

```bash
npm uninstall -g proxa
```

### tarball として配布

```bash
pnpm build
npm pack
```

`proxa-0.1.0.tgz` が生成される。他のマシンへ配布してインストール:

```bash
npm install -g ./proxa-0.1.0.tgz
```

アンインストール:

```bash
npm uninstall -g proxa
```

### npm レジストリへ公開

`package.json` の `"private": true` を削除してから:

```bash
pnpm build
npm publish
```

公開後のインストール:

```bash
npm install -g proxa
```

アンインストール:

```bash
npm uninstall -g proxa
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
CHAT_API_KEY=sk-xxx CHAT_BASE_URL=https://api.example.com/v1 proxa

# ~/.bashrc や ~/.zshrc に追記して永続化
export CHAT_API_KEY=sk-xxx
export CHAT_BASE_URL=https://api.example.com/v1
```

Windows の場合:

```powershell
# 直接渡す
$env:CHAT_API_KEY="sk-xxx"; $env:CHAT_BASE_URL="https://api.example.com/v1"; proxa

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
