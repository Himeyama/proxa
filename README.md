# ant2chat

![](docs/system.drawio.png)

Anthropic Messages API (`/v1/messages`) および OpenAI Responses API (`/v1/responses`) を受け取り、上流の Chat Completions API へ変換して転送するプロキシサーバー。

Claude Code などの Anthropic クライアントや OpenAI Responses API クライアントを、Ollama・LM Studio・vLLM などの OpenAI 互換バックエンドに接続できる。

## インストール

### GitHub から直接インストール（推奨）

```bash
npm install -g github:himeyama/ant2chat
```

インストール時に自動でビルドされる。インストール後すぐに使える:

```bash
ant2chat
```

アンインストール:

```bash
npm uninstall -g ant2chat
```

### グローバルインストール（ローカルから）

```bash
git clone https://github.com/himeyama/ant2chat
cd ant2chat
pnpm install
pnpm build
npm install -g .
```

インストール後、どのディレクトリからでも起動できる:

```bash
ant2chat
```

アンインストール:

```bash
npm uninstall -g ant2chat
```

### tarball から

```bash
npm install -g ./ant2chat-0.1.0.tgz
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

優先順位: CLI オプション → 環境変数 → クライアント指定

## 環境変数

CLI オプションで上書き可能。

| 変数名 | 説明 |
|---|---|
| `CHAT_API_KEY` | 上流 API の認証キー |
| `CHAT_BASE_URL` | 上流エンドポイント。デフォルト: `http://localhost:11434/v1` |
| `CHAT_DEFAULT_MODEL` | デフォルトモデル名。空の場合はクライアントの `model` フィールドをそのまま使う |
| `OPENAI_API_KEY` | `--provider openai` / `--provider responses` 使用時の API キーフォールバック |
| `OPENROUTER_API_KEY` | `--provider openrouter` 使用時の API キーフォールバック |
| `GOOGLE_GENERATIVE_AI_API_KEY` | `--provider google` / `--provider gemini` 使用時の API キーフォールバック |
| `AZURE_OPENAI_API_KEY` | `--provider azure` 使用時の API キーフォールバック |
| `CHAT_AUTH_TYPE` | 認証ヘッダー形式 |
| `PORT` | Listen ポート。デフォルト: `3000` |
| `NO_SEARCH` | `1` または `true` で組み込み Web 検索ツールを無効化 |

### 設定方法

**Linux / macOS**

```bash
export CHAT_BASE_URL=http://localhost:11434/v1
export CHAT_API_KEY=sk-xxx
ant2chat
```

または `.env` ファイルを作成して開発モードで使う:

```bash
cp .env.example .env
# .env を編集してから
pnpm dev
```

**Windows (PowerShell)**

```powershell
$env:CHAT_BASE_URL="http://localhost:11434/v1"
$env:CHAT_API_KEY="sk-xxx"
ant2chat
```

### CLI オプションで指定する場合

```bash
ant2chat --provider openai --api-key sk-xxx --model gpt-4o
ant2chat --provider responses --api-key sk-xxx --model gpt-5
ant2chat --provider openrouter --api-key sk-or-xxx --model anthropic/claude-3.5-sonnet
ant2chat --provider gemini --api-key AIzaSy-xxx --model gemini-2.0-flash
ant2chat --provider google --api-key AIzaSy-xxx --model gemini-2.0-flash
ant2chat --provider azure --api-key <key> -u https://<resource>.openai.azure.com/openai/deployments/<deployment> -m gpt-4o
ant2chat -u http://localhost:11434/v1 -m llama3.2
# Azure は URL 指定のみでも自動判定
ant2chat -u https://<resource>.openai.azure.com/openai/deployments/<deployment> -k <key> -m gpt-4o
# Gemini は models/{model}:generateContent 形式の URL を直接指定可能 (ベース URL とモデル名を自動分解)
ant2chat -u https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent -k AIzaSy-xxx
```

## 使い方

### Ollama との接続例

```bash
CHAT_BASE_URL=http://localhost:11434/v1 ant2chat
```

Claude Code の設定でベース URL を `http://localhost:3000` に向ける。

### Claude Code との連携

`~/.claude/settings.json` などで API ベース URL を変更する。または環境変数で指定:

```bash
ANTHROPIC_BASE_URL=http://localhost:3000 claude
```

## エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/` | ヘルスチェック。`{"status":"ok"}` を返す |
| `POST` | `/v1/messages` | Anthropic Messages API 互換エンドポイント |
| `POST` | `/v1/responses` | OpenAI Responses API 互換エンドポイント (HTTP) |
| `WS` | `/v1/responses` | OpenAI Responses API 互換エンドポイント (WebSocket) |

### `/v1/responses` について

OpenAI Responses API 形式でリクエストを受け取り、上流へは Chat Completions として転送し、Responses API 形式でレスポンスを返す。

- `input` に文字列または入力アイテムの配列を指定する。アイテムには通常メッセージ・`function_call`・`function_call_output` を混在できる
- `instructions` がシステムプロンプトとして機能する
- `stream: true` で SSE ストリーミングに対応。`response.created` → `response.output_text.delta` → `response.completed` 等の標準イベントを送出する
- ツール呼び出し結果は `output` 配列内の `function_call` アイテムとして返される

**WebSocket 対応:** Codex CLI など WebSocket トランスポートを使うクライアントにも対応している。`ws://host:port/v1/responses` に接続後、最初のメッセージとしてリクエスト JSON を送信すると、HTTP SSE と同じイベント列が WebSocket テキストフレームとして返される。

### サポートしているリクエストフィールド

`model` / `messages` / `system` / `max_tokens` / `max_completion_tokens` / `stream` / `temperature` / `top_p` / `stop_sequences` / `tools` / `tool_choice` / `thinking`

`max_tokens` と `max_completion_tokens` はどちらも受け付ける。両方指定した場合は `max_tokens` が優先される。

未サポート: `top_k`、`image` コンテンツブロック

### 思考 (thinking) の制御

リクエストの `thinking` フィールドで reasoning モデルの思考を制御できる。プロバイダーごとに適切な形式へ変換される。

- **Google / Gemini**: `thinkingBudget` (トークン予算) と `includeThoughts` に変換
- **OpenAI / responses**: `budget_tokens` を `reasoningEffort` (`low` / `medium` / `high`) にマッピング。`responses` では思考要約も有効化
- **ollama / その他**: 無視される

```jsonc
"thinking": { "type": "enabled", "budget_tokens": 16000 }
// または
"thinking": { "type": "disabled" }
```

### OpenAI Responses API プロバイダー

`--provider responses` を指定すると、上流の転送先が OpenAI Chat Completions API ではなく Responses API (`/v1/responses`) になる。reasoning (思考) モデルに対応しており、上流が返す思考内容は Anthropic の `thinking` / `redacted_thinking` ブロックに変換してクライアントへ返す。`--provider openai` (Chat Completions) はそのまま利用できる。

### OpenRouter プロバイダー

`--provider openrouter` を指定すると、上流の転送先が OpenRouter の Chat Completions 互換エンドポイント (`https://openrouter.ai/api/v1`) になる。認証は bearer 形式。モデル名は `anthropic/claude-3.5-sonnet` のように `<provider>/<model>` 形式で指定する。

### Google / Gemini プロバイダーの制約

`--provider google` / `--provider gemini` 使用時、マルチターン会話で過去の `tool_use` / `tool_result` をテキスト形式に変換する。Gemini 思考モデルはツール呼び出し履歴に `thought_signature` を要求するが、Anthropic フォーマットにその概念がないため署名が失われる。テキスト形式で代替することで `INVALID_ARGUMENT (400)` エラーを回避する。

### Gemini: モデル付き URL の直接指定

`-u` に `models/{model}:generateContent` 形式の URL を渡すと、ベース URL とモデル名を自動分解する。`-m` や `CHAT_DEFAULT_MODEL` が未指定の場合は URL 内のモデル名をそのまま使用する。

```bash
ant2chat -u https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent -k AIzaSy-xxx
```

## 開発

```bash
pnpm dev      # ホットリロードあり
pnpm build    # TypeScript コンパイル → dist/
pnpm start    # ビルド済みで起動
```

## アーキテクチャ

```
クライアント
  │  POST /v1/messages (Anthropic 形式)
  │  POST /v1/responses (OpenAI Responses API 形式)
  ▼
[Hono サーバー]
  │  リクエスト変換 → CoreMessage
  ▼
[Vercel AI SDK]  generateText / streamText
  │
  ▼
上流 OpenAI 互換エンドポイント (CHAT_BASE_URL)
  │  レスポンス変換
  ▼
クライアントへ返却 (Anthropic 形式 / Responses API 形式 / SSE)
```

## エージェントコーディングツールでの使用例
```ps1
ant2chat --provider openai -k $env:OPENAI_API_KEY --model gpt-5.4-mini
```

### Claude Code
```ps1
$env:ANTHROPIC_API_KEY="sk-ant-dummy"
$env:ANTHROPIC_BASE_URL="http://localhost:3000";
claude --model gpt-5.4-mini
```

### codex
```ps1
$env:OPENAI_API_KEY="sk-dummy"
codex --model gpt-5.4-mini -c 'openai_base_url="http://localhost:3000/v1"'
```

※モデルオプションは任意です。ant2chat の `--model` オプションが優先されます。

## ライセンス

MIT
