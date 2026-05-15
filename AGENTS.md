# ant2chat

Anthropic Messages API (`/v1/messages`) を受け取り、OpenAI 互換の Chat Completions API へ変換して転送するプロキシサーバー。

## アーキテクチャ

```
クライアント
  │  POST /v1/messages (Anthropic 形式)
  ▼
[Hono サーバー]  src/server.ts
  │
  ▼
[handleMessages]  src/handlers/messages.ts
  │  リクエスト変換
  ▼
[toOpenAIMessages / toOpenAITools / toOpenAIToolChoice]  src/converters/to-openai.ts
  │  Vercel AI SDK (ai / @ai-sdk/openai)
  ▼
上流 OpenAI 互換エンドポイント (CHAT_BASE_URL)
  │  レスポンス変換
  ▼
クライアントへ返却 (Anthropic 形式 / SSE)
```

## ファイル構成

```
src/
├── index.ts                  # エントリポイント。@hono/node-server で Listen
├── server.ts                 # Hono アプリ定義。ルーティングのみ
├── handlers/
│   └── messages.ts           # POST /v1/messages の処理。ストリーム・非ストリーム両対応
├── converters/
│   └── to-openai.ts          # Anthropic → CoreMessage / ToolSet / ToolChoice への変換
└── types/
    └── anthropic.ts          # Anthropic API の型定義 (Request / Response / SSE イベント / Tool)
```

## 環境変数

| 変数名 | 必須 | 説明 |
|---|---|---|
| `CHAT_API_KEY` | 推奨 | 上流 API の認証キー |
| `CHAT_BASE_URL` | 任意 | 上流エンドポイント。デフォルト: `http://localhost:11434/v1` |
| `CHAT_DEFAULT_MODEL` | 任意 | 空の場合はクライアントの `model` フィールドをそのまま使う |
| `PORT` | 任意 | Listen ポート。デフォルト: `3000` |

`.env.example` をコピーして `.env` を作成すること。

## コマンド

```bash
pnpm dev        # 開発モード (tsx watch、ホットリロードあり)
pnpm build      # TypeScript コンパイル → dist/
pnpm start      # ビルド済みファイルで起動
```

開発時は `tsx` が `.env` を自動で読み込む。本番時は `node --env-file=.env dist/index.js` を使うこと。

## エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/` | ヘルスチェック。`{"status":"ok"}` を返す |
| `POST` | `/v1/messages` | Anthropic Messages API 互換エンドポイント |

### `/v1/messages` の動作

- `stream: false` (省略時) → `generateText` で同期レスポンスを返す
- `stream: true` → `streamText` で SSE ストリームを返す。イベント順は Anthropic 仕様に準拠:
  `message_start` → `ping` → `content_block_start` → `content_block_delta` (×N) → `content_block_stop` → `message_delta` → `message_stop`
  - テキストブロックと `tool_use` ブロックは index で管理。テキストは最初の delta 到来時に open する

### サポートしているリクエストフィールド

`model` / `messages` / `system` / `max_completion_tokens` / `stream` / `temperature` / `top_p` / `stop_sequences` / `tools` / `tool_choice`

未サポート: `top_k`、画像コンテンツ (`image` ブロックはテキスト変換時に無視される)

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

### レスポンス (OpenAI → Anthropic)

- `finishReason === "length"` → `stop_reason: "max_tokens"`
- `finishReason === "tool-calls"` またはツールコールが存在 → `stop_reason: "tool_use"`
- それ以外 → `stop_reason: "end_turn"`
- `usage.promptTokens` → `usage.input_tokens`
- `usage.completionTokens` → `usage.output_tokens`
- ストリーミング時の `message_start` の `input_tokens` は `0` (上流が usage を返さないため)
- 非ストリーミング時のレスポンス `content` には `text` ブロックと `tool_use` ブロックが混在する場合がある

## 依存関係

| パッケージ | 用途 |
|---|---|
| `hono` | HTTP ルーティング |
| `@hono/node-server` | Node.js アダプター |
| `ai` | `generateText` / `streamText` / `jsonSchema` |
| `@ai-sdk/openai` | OpenAI 互換プロバイダー (`createOpenAI`) |
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

- **別プロバイダーへの対応**: `src/handlers/messages.ts` の `getProvider()` を差し替える
- **`tool_result` 内の画像対応**: `toolResultContentToString` を拡張し、`tool_result` の `content` に含まれる画像ブロックを処理する
- **認証**: `src/server.ts` に Hono ミドルウェアを追加して `x-api-key` ヘッダーを検証する
- **ロギング**: `src/server.ts` の `createApp()` に `logger()` ミドルウェア (`hono/logger`) を追加する
