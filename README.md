# ant2chat

Anthropic Messages API (`/v1/messages`) を受け取り、OpenAI 互換の Chat Completions API へ変換して転送するプロキシサーバー。

Claude Code などの Anthropic クライアントを、Ollama・LM Studio・vLLM などの OpenAI 互換バックエンドに接続できる。

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
      --provider <name>   上流プロバイダー: ollama | openai (デフォルト: ollama)
  -u, --url <url>         上流ベース URL (--provider より優先)
  -p, --port <port>       Listen ポート (デフォルト: 3000)
  -k, --api-key <key>     上流 API キー
      --auth-type <type>  認証ヘッダー形式: bearer | api-key (デフォルト: bearer)
  -m, --model <model>     モデル名を強制指定 (クライアントの model フィールドを上書き)
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
| `OPENAI_API_KEY` | `--provider openai` 使用時の API キーフォールバック |
| `CHAT_AUTH_TYPE` | 認証ヘッダー形式 |
| `PORT` | Listen ポート。デフォルト: `3000` |

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
ant2chat -u http://localhost:11434/v1 -m llama3.2
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

### サポートしているリクエストフィールド

`model` / `messages` / `system` / `max_completion_tokens` / `stream` / `temperature` / `top_p` / `stop_sequences` / `tools` / `tool_choice`

未サポート: `top_k`、`image` コンテンツブロック

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
  ▼
[Hono サーバー]
  │  リクエスト変換 (Anthropic → OpenAI)
  ▼
[Vercel AI SDK]  generateText / streamText
  │
  ▼
上流 OpenAI 互換エンドポイント (CHAT_BASE_URL)
  │  レスポンス変換 (OpenAI → Anthropic)
  ▼
クライアントへ返却 (Anthropic 形式 / SSE)
```

## ライセンス

MIT
