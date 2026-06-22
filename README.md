# proxa

Anthropic Messages API (`/v1/messages`)、OpenAI Responses API (`/v1/responses`)、OpenAI Chat Completions API (`/v1/chat/completions`)、Google Gemini API (`/v1beta/models/{model}:generateContent`) を受け取り、上流の Chat Completions API / Google Gemini API へ変換して転送するプロキシサーバー。

Claude Code などの Anthropic クライアント、OpenAI Responses API クライアント、OpenAI Chat Completions クライアント、Google Gemini クライアントを、Ollama・LM Studio・vLLM などの OpenAI 互換バックエンドや Google Gemini に接続できる。

## インストール

### GitHub から直接インストール（推奨）

```bash
npm install -g github:himeyama/proxa
```

インストール時に自動でビルドされる。インストール後すぐに使える:

```bash
proxa
```

アンインストール:

```bash
npm uninstall -g proxa
```

### グローバルインストール（ローカルから）

```bash
git clone https://github.com/himeyama/proxa
cd proxa
pnpm install
pnpm build
npm install -g .
```

インストール後、どのディレクトリからでも起動できる:

```bash
proxa
```

アンインストール:

```bash
npm uninstall -g proxa
```

### tarball から

```bash
npm install -g ./proxa-0.1.0.tgz
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
  -h, --help              ヘルプを表示
```

優先順位: CLI オプション → 環境変数 → クライアント指定

モデル名はこのいずれかで必ず指定する必要がある。`--model` / `CHAT_DEFAULT_MODEL` を設定しておらず、クライアントの `model` フィールドも空欄/未指定の場合は、リクエストを上流へ送る前に HTTP 400 (`No model specified. ...`) を返す。

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
| `CHAT_AUTH_TYPE` | 認証ヘッダー形式: bearer \| api-key \| x-goog-api-key |
| `PORT` | Listen ポート。デフォルト: `3000` |
| `NO_SEARCH` | `1` または `true` で組み込み Web 検索ツールを無効化 |
| `MIN_TOOLS` | `--min` のフォールバック。`1` または `true` で最小構成のツールのみ転送 |
| `TUI_LOG` | `--tui` のフォールバック。`1` または `true` でフルスクリーン TUI ログを有効化 |
| `GEMINI_RELAY_URL` | `--gemini-relay-url` のフォールバック。`--provider google` / `gemini` 限定の中継先 URL |
| `GEMINI_CACHE` | 明示キャッシュ (`--provider google` / `gemini` 限定)。**既定で有効**。`0` または `false` で無効化 (`--no-gemini-cache` と同等) |
| `GEMINI_CACHE_TTL` | `--gemini-cache-ttl` のフォールバック。明示キャッシュの TTL (秒)。デフォルト: 600 |
| `STRIP_SYSTEM_LINE` | `--strip-system-line` のフォールバック。カンマ区切りで複数パターン可。指定文字列を含むシステムプロンプト行を除去 |

### 設定方法

**Linux / macOS**

```bash
export CHAT_BASE_URL=http://localhost:11434/v1
export CHAT_API_KEY=sk-xxx
proxa
```


**Windows (PowerShell)**

```powershell
$env:CHAT_BASE_URL="http://localhost:11434/v1"
$env:CHAT_API_KEY="sk-xxx"
proxa
```

### CLI オプションで指定する場合

```bash
proxa --provider openai --api-key sk-xxx --model gpt-4o
proxa --provider responses --api-key sk-xxx --model gpt-5
proxa --provider openrouter --api-key sk-or-xxx --model anthropic/claude-3.5-sonnet
proxa --provider gemini --api-key AIzaSy-xxx --model gemini-2.0-flash
proxa --provider google --api-key AIzaSy-xxx --model gemini-2.0-flash
proxa --provider azure --api-key <key> -u https://<resource>.openai.azure.com/openai/deployments/<deployment> -m gpt-4o
proxa -u http://localhost:11434/v1 -m llama3.2
# Azure は URL 指定のみでも自動判定
proxa -u https://<resource>.openai.azure.com/openai/deployments/<deployment> -k <key> -m gpt-4o
# Gemini は models/{model}:generateContent 形式の URL を直接指定可能 (ベース URL とモデル名を自動分解)
proxa -u https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent -k AIzaSy-xxx
proxa --provider gemini --gemini-relay-url https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent --model gemini-3.1-flash-lite-preview
```

## 使い方

### Ollama との接続例

```bash
CHAT_BASE_URL=http://localhost:11434/v1 proxa
```

Claude Code の設定でベース URL を `http://localhost:3000` に向ける。

### Claude Code との連携

`~/.claude/settings.json` などで API ベース URL を変更する。または環境変数で指定:

```bash
ANTHROPIC_BASE_URL=http://localhost:3000 claude
```

## エンドポイント

各 `GET` エンドポイントは、ブラウザ (`Accept: text/html`) にはブラウザで試せるテストページ (HTML) を返し、API クライアントには `{"status":"ok"}` を返す。

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/` | ブラウザからは使用法ページ (HTML) を返す。API クライアントからは `{"status":"ok"}` を返す |
| `GET` | `/v1/messages` | ブラウザからは Messages API テストページ (HTML) を返す。API クライアントからは `{"status":"ok"}` を返す |
| `POST` | `/v1/messages` | Anthropic Messages API 互換エンドポイント |
| `GET` | `/v1/responses` | ブラウザからは Responses API テストページ (HTML) を返す。API クライアントからは `{"status":"ok"}` を返す |
| `POST` | `/v1/responses` | OpenAI Responses API 互換エンドポイント (HTTP) |
| `WS` | `/v1/responses` | OpenAI Responses API 互換エンドポイント (WebSocket) |
| `GET` | `/v1/chat/completions` | ブラウザからは Chat Completions API テストページ (HTML) を返す。API クライアントからは `{"status":"ok"}` を返す |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions API 互換エンドポイント |
| `GET` | `/v1beta/models/{model}:…` (`/v1` も可) | ブラウザからは Gemini API テストページ (HTML) を返す。API クライアントからは `{"status":"ok"}` を返す |
| `POST` | `/v1beta/models/{model}:generateContent` (`/v1` も可) | Google Gemini API 互換エンドポイント (非ストリーム) |
| `POST` | `/v1beta/models/{model}:streamGenerateContent` (`/v1` も可) | Google Gemini API 互換エンドポイント (ストリーミング、SSE) |
| `GET` | `/logs` | 通信ログ閲覧ページ (HTML) を返す |
| `GET` | `/logs/data` | 通信ログを JSON 配列で返す (閲覧ページが取得) |
| `DELETE` | `/logs/data` | 通信ログをクリアする |

### クライアント認証

proxa 自身は受信リクエストを認証しない。上流へ渡す API キーは、サーバー側キー（`-k` / `CHAT_API_KEY` 等）があればそれを使い、無ければクライアントのヘッダーから取り出す。読み取り順は各エンドポイントの正規方式に合わせている。

- `/v1/messages`（Anthropic）: `x-api-key` を優先し、`Authorization: Bearer`（`ANTHROPIC_AUTH_TOKEN` 方式）にもフォールバック
- `/v1/responses` / `/v1/chat/completions`（OpenAI）: `Authorization: Bearer` を優先し、`x-api-key` にもフォールバック
- `/v1beta/models/...`（Gemini）: `x-goog-api-key` を優先し、`Authorization: Bearer` → `x-api-key` → `?key=` クエリにもフォールバック

取り出したキーは上流の認証ヘッダー（OpenAI 系は `--auth-type`、Gemini は「Gemini: 認証ヘッダー」参照）に載る。

### `/logs` について

プロキシを通過したリクエストを記録し、ブラウザで `/logs` を開くと一覧で確認できる。

- 一覧には日時・モデル・プロバイダー・入力トークン・入力キャッシュ・出力トークン・コスト・速度 (tok/s) を表示する
- 一覧の下に合計 (入力・入力キャッシュ・出力・出力キャッシュ・コスト) を表示する
- 「料金表」ボタンで単価を設定できる。行ごとに Provider・Model と単価 (Input / In cache / Output / Out cache、100 万トークンあたりの $) を入力すると、Provider と Model が一致 (大文字小文字を問わず) するログのコストを自動計算する。一致する料金がなければ `—`。設定はブラウザに保存される (サーバーには送らない)
- 料金表に「1 USD = N JPY」の為替レートを設定すると、コストを `$X.XXXXXX (JPY NNN)` 形式で円換算表示する (未設定なら $ のみ)
- 入力トークンにはキャッシュ分が含まれる。コストはキャッシュ分を入力単価から差し引き、入力キャッシュ単価で計算する
- 入力キャッシュは OpenAI 系 (`cached_tokens`) に加え、OpenRouter (`promptTokensDetails.cachedTokens`)・Gemini (`cachedContentTokenCount`) も記録する。Gemini はキャッシュ数を SDK が捨てるため、上流レスポンスを覗いて回収している (ストリーミング・非ストリーミング両対応)。SSE / JSON の判定はレスポンスの `content-type` で行うため、非ストリーム応答の本文に `data:` (データ URI など) が含まれていても入力キャッシュを正しく記録する
- ストリーミングでも上流が usage を返すよう、OpenAI 系プロバイダー (`openai` / `responses` / `azure`) には `stream_options: { include_usage: true }` を要求する (`compatibility: "strict"`)。これがないと上流が usage を返さず、トークンが 0 (空欄) と表示される。usage を返さない上流に対しては 0 として記録する
- 一覧が横に長いときはテーブルを横スクロールできる
- 行をクリックすると、概要・受信ヘッダー (折りたたみ)・送信したプロンプト (ロール別)・レスポンス本文・生 JSON を表示する
- 受信リクエストの HTTP ヘッダーも記録する。`Authorization` / `x-api-key` / `x-goog-api-key` / `api-key` / `Cookie` などの認証・機密系は値をマスクして表示する (スキームと先頭・末尾の数文字のみ)。それ以外のヘッダーはそのまま表示する
- 「更新」「自動更新 (3秒)」「料金表」「クリア」の操作に対応する
- 全エンドポイント (`/v1/messages` / `/v1/responses` (HTTP・WebSocket) / `/v1/chat/completions` / `/v1beta/models/{model}:generateContent`) が対象
- ログはメモリ上に直近 200 件だけ保持し、永続化しない (再起動でクリアされる)。料金表の設定はブラウザの `localStorage` に保存される

### `/v1/chat/completions` について

OpenAI Chat Completions 形式でリクエストを受け取る。上流プロバイダーによって動作が変わる。

- **Chat Completions 互換の上流 (ollama / openai / responses / openrouter / azure / custom)**: 変換せずそのまま上流の `/chat/completions` へ転送する (パススルー)。`stream: true` の SSE もそのまま中継し、SDK 非対応のフィールドも透過する
- **Gemini (`--provider google` / `--provider gemini`)**: Chat Completions 非互換のため変換して転送し、`chat.completion` / `chat.completion.chunk` 形式で返す。ツール呼び出し・組み込み Web 検索にも対応
- いずれの場合も `--model` / `CHAT_DEFAULT_MODEL` の強制指定が優先される (パススルーでもボディの `model` を書き換える)
- OpenAI 系プロバイダー (`openai` / `responses` / `azure`) では、`max_tokens` を `max_completion_tokens` へ自動変換してから転送する (OpenAI の新しいモデルが `max_tokens` を拒否するため)
- パススルーで `stream: true` のときは、転送前に `stream_options.include_usage` を `true` に補う。Azure / OpenAI / OpenRouter などは指定がないとストリーム応答に `usage` を含めず、`/logs` のトークン数が常に 0 になるため (クライアントが明示済みならその指定を尊重する)

```bash
# OpenAI Chat Completions クライアントをそのまま接続 (パススルー)
proxa --provider openai -k sk-xxx
# Gemini を Chat Completions 形式で利用 (変換)
proxa --provider gemini -k AIzaSy-xxx -m gemini-2.0-flash
```

### `/v1/responses` について

OpenAI Responses API 形式でリクエストを受け取り、上流へは Chat Completions として転送し、Responses API 形式でレスポンスを返す。

- `input` に文字列または入力アイテムの配列を指定する。アイテムには通常メッセージ・`function_call`・`function_call_output` を混在できる
- `instructions` がシステムプロンプトとして機能する
- `stream: true` で SSE ストリーミングに対応。`response.created` → `response.output_text.delta` → `response.completed` 等の標準イベントを送出する
- ツール呼び出し結果は `output` 配列内の `function_call` アイテムとして返される

**WebSocket 対応:** Codex CLI など WebSocket トランスポートを使うクライアントにも対応している。`ws://host:port/v1/responses` に接続後、最初のメッセージとしてリクエスト JSON を送信すると、HTTP SSE と同じイベント列が WebSocket テキストフレームとして返される。

### `/v1beta/models/{model}:generateContent` について

Google Gemini API 形式でリクエストを受け取り (`generateContent` / `streamGenerateContent`)、上流へは各プロバイダーの形式へ変換して転送し、Gemini 形式でレスポンスを返す。Gemini クライアント (公式 SDK や `curl`) を、Ollama などの OpenAI 互換バックエンドや任意の上流へ接続できる。**上流プロバイダーは何でもよい** (`/v1/messages` と同じく全プロバイダー対応)。

- パスは `/v1beta/models/{model}:generateContent` (非ストリーム) と `/v1beta/models/{model}:streamGenerateContent` (ストリーミング、SSE)。`/v1` 版も受け付ける
- モデル名は URL パスから取り出す (`--model` / `CHAT_DEFAULT_MODEL` 指定時はそれが優先)
- `contents` / `systemInstruction` / `tools` (`functionDeclarations`) / `toolConfig` / `generationConfig` (`temperature` / `topP` / `maxOutputTokens` / `stopSequences` / `thinkingConfig`) を解釈する。camelCase と snake_case の両方を受け付ける
- 画像 (`inlineData` / `fileData`)・関数呼び出し (`functionCall` / `functionResponse`)・思考 (`thinkingConfig.includeThoughts`) に対応。組み込み Web 検索ツールも利用できる
- レスポンスは `candidates[0].content.parts[]` + `usageMetadata` + `modelVersion` 形式。エラーは Gemini 形式 (`{ error: { code, message, status } }`)

```bash
# 例: 上流 Ollama に対して Gemini 形式で問い合わせる
proxa -u http://localhost:11434/v1 -m llama3.2
curl http://localhost:3000/v1beta/models/llama3.2:generateContent \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"role":"user","parts":[{"text":"hello"}]}]}'

# ストリーミング (SSE)
curl -N 'http://localhost:3000/v1beta/models/llama3.2:streamGenerateContent?alt=sse' \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"role":"user","parts":[{"text":"hello"}]}]}'
```

### サポートしているリクエストフィールド

`model` / `messages` / `system` / `max_tokens` / `max_completion_tokens` / `stream` / `temperature` / `top_p` / `stop_sequences` / `tools` / `tool_choice` / `thinking`

`max_tokens` と `max_completion_tokens` はどちらも受け付ける。両方指定した場合は `max_tokens` が優先される。

未サポート: `top_k`、`image` コンテンツブロック

### 思考 (thinking) の制御

リクエストの `thinking` フィールドで reasoning モデルの思考を制御できる。プロバイダーごとに適切な形式へ変換される。

- **Google / Gemini**: `thinkingBudget` (トークン予算) と `includeThoughts` に変換。`disabled` は `thinkingBudget: 0` だが、思考をオフにできない gemini-2.5-pro 系 (モデル名に `pro` を含む) には送らずモデルのデフォルトに任せる (`thinking_budget to 0` 拒否エラーの回避)
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

OpenRouter は専用プロバイダー `@openrouter/ai-sdk-provider` 経由で転送し、**プロンプトキャッシュ**に対応する。OpenRouter のキャッシュは上流モデルにより条件が異なり、Anthropic Claude / Gemini は `cache_control` の明示ブレークポイントが必須 (OpenAI / DeepSeek などは自動)。クライアント (Claude Code など) が `/v1/messages` で送る `cache_control` を、proxa が上流リクエストの `cache_control` へ転送するため、OpenRouter 上の Claude / Gemini でもキャッシュが効く。キャッシュトークン数は usage accounting で回収して `/logs` の In cache に反映する。

### Google / Gemini プロバイダーの制約

`--provider google` / `--provider gemini` 使用時、マルチターン会話で過去の `tool_use` / `tool_result` をテキスト形式に変換する。Gemini 思考モデルはツール呼び出し履歴に `thought_signature` を要求するが、Anthropic フォーマットにその概念がないため署名が失われる。テキスト形式で代替することで `INVALID_ARGUMENT (400)` エラーを回避する。

### Gemini: ツール呼び出しテキスト化のサルベージ

上記のテキスト平坦化の副作用で、Gemini は履歴の `[Tool Use: ...] { JSON }` というパターンを模倣し、**新しいツール呼び出しを本来の `functionCall` ではなくテキスト (JSON) で出力**してしまうことがある（ツールを 1 往復した後のマルチターンで起きやすい）。そのままだとクライアントには「JSON のようなもの」がテキストとして返ってしまう。

これを防ぐため、Google プロバイダー時は **出力テキストからツール呼び出しを自動復元（サルベージ）** する。ネイティブのツール呼び出しが 1 件も無い場合に限り、出力テキストを解析して既知ツール名に一致する呼び出しを `tool_use` / `functionCall` / `tool_calls` へ組み直す。

- 復元対象: `[Tool Use: NAME]\n{ JSON }`、素の JSON や ```` ```json ```` / ```` ```tool_code ```` フェンス内の `{ "name": ..., "args"/"arguments"/"parameters": ... }`、`{"functionCall": {...}}` 等のネスト、`arguments` が文字列化された JSON
- 既知ツール名に一致するものだけを復元するため、通常の JSON テキスト回答を誤ってツール呼び出し化しない
- `/v1/messages`・`/v1beta/models/{model}:…`・`/v1/chat/completions`（Gemini 変換）の stream / non-stream すべてに効く。ストリーミングでは先頭がツール呼び出しらしいテキストのみバッファし、通常テキストは逐次そのまま流す
- ストリーミングで Gemini が説明文を先に出してから `[Tool Use: ...]` を吐くケースにも対応する。先頭が通常テキストでも、途中に現れた `[Tool Use:` マーカーを検出してそこから先をバッファし直し、ツール呼び出しとして復元する（マーカー直前までのテキストはそのまま流す）
- 設定は不要（自動）。誤検出は既知ツール名一致で抑止している

### Gemini: 認証ヘッダー

google / gemini の認証ヘッダーは **デフォルトで `x-goog-api-key`** を使う。`--auth-type`（環境変数 `CHAT_AUTH_TYPE`）で切り替えられ、API キー（`-k` / `CHAT_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`）が選択したヘッダーに入る。

| `--auth-type` | 送出されるヘッダー |
|---|---|
| 未指定 / `x-goog-api-key` | `x-goog-api-key: <key>` |
| `bearer` | `Authorization: Bearer <key>` |
| `api-key` | `api-key: <key>` |

```bash
# 既定: x-goog-api-key
proxa --provider gemini -k AIzaSy-xxx

# 中継ゲートウェイが Bearer 認証を要求する場合など
proxa --provider gemini --gemini-relay-url https://gw.example.com/v1/endpoint --auth-type bearer -k MY-TOKEN
```

### Gemini: モデル付き URL の直接指定

`-u` に `models/{model}:generateContent` 形式の URL を渡すと、ベース URL とモデル名を自動分解する。`-m` や `CHAT_DEFAULT_MODEL` が未指定の場合は URL 内のモデル名をそのまま使用する。

```bash
proxa -u https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent -k AIzaSy-xxx
```

### Gemini: 任意 URL への中継 (`--gemini-relay-url`)

`@ai-sdk/google` は baseURL から必ず `{baseURL}/models/{model}:generateContent` (ストリーム時は `:streamGenerateContent?alt=sse`) を組み立てるため、この形に当てはまらない任意のエンドポイントへは送れない。`--gemini-relay-url <url>` (または環境変数 `GEMINI_RELAY_URL`) を指定すると、SDK が組み立てた URL を破棄し、**設定した URL へそのまま転送** する。

```bash
# 例: SDK の URL 組み立てを無視して、この URL へ verbatim 転送する
proxa --provider gemini --gemini-relay-url https://example.com/v1/baseurl/endpoint -k AIzaSy-xxx
```

- 別ポートのサーバーは立てず、プロセス内の fetch インターセプターとして中継する (`クライアント → proxa → gemini SDK → 中継 → 設定 URL`)
- ストリーミング判定の `?alt=sse` は転送先 URL にも引き継がれる (非ストリーム → `<url>`、ストリーム → `<url>?alt=sse`)
- 転送先がモデルを決める前提のため、モデル名は URL パスに乗らない。`-u` / `customBaseURL` は relay 時には使われない
- 転送先が Google 認証を要求しない場合は API キー未指定でも動作する (内部でプレースホルダを補う)。要求する場合は通常どおり `-k` / `CHAT_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` でキーを渡す
- `/v1/messages` と `/v1/chat/completions` (Gemini 変換パス) の双方に効く
- 起動時バナーは relay 設定時、実際の転送先 URL を `Upstream:  <url> (relay)` と表示する (使われない SDK のベース URL は表示しない)

### Gemini: 明示キャッシュ (`--gemini-cache`)

`--provider google` / `gemini` で、Gemini の**明示キャッシュ (CachedContent)** を使う。systemInstruction・ツール定義・会話履歴の安定したプレフィックスを上流にキャッシュして `cachedContent` で参照することで、毎リクエストでの再送を避け、入力トークンのコストを下げる。会話を繰り返すクライアント (Claude Code など、巨大な system + 多数のツール) で効果が大きい。**google/gemini では既定で有効**。

```bash
# 既定で有効 (TTL 600 秒)。明示指定は不要
proxa --provider gemini -k AIzaSy-xxx

# TTL を 30 分に
proxa --provider gemini --gemini-cache-ttl 1800 -k AIzaSy-xxx

# 無効化する
proxa --provider gemini --no-gemini-cache -k AIzaSy-xxx
```

- fetch 層で透過的に動作する。SDK が組み立てた Gemini リクエストの本文をインターセプトし、安定プレフィックスをキャッシュへ寄せて本文から外し、`cachedContent` を付けて転送する (ハンドラーのコードは変更なし)
- Gemini はキャッシュ参照時に systemInstruction / tools をリクエストへ重複指定できないためそれらをキャッシュへ移すが、SDK にはツール定義を渡し続けるので、ツールループ・サーバー側 Web 検索はそのまま動く
- `contents` を 1 件ずつ進めた累積ハッシュで「現在のリクエストの最長一致キャッシュ」を再利用し、残りの contents だけを送る。append-only で伸びる会話では前ターンのキャッシュが次ターンでヒットする
- 古い小さなキャッシュは新しい大きなキャッシュ作成時に best-effort で削除し、保管課金の累積を抑える
- 失敗時 (最小トークン未満で作成不可・キャッシュ失効など) はキャッシュ無しの通常転送へ自動で縮退する。参照時に得られる `cachedContentTokenCount` は `/logs` の In cache に反映される
- `--gemini-relay-url` 併用時も有効。生成リクエストは relay 経由で送り、キャッシュの作成/削除は Gemini の `cachedContents` エンドポイントへ直接送る (生成と作成が同一 Gemini プロジェクトを指す前提)。`/v1/messages`・`/v1beta/models/{model}:…`・`/v1/chat/completions` (Gemini 変換) に効く
- 再送されない単発リクエストではキャッシュ作成分のわずかな保管課金が無駄になる点に注意
- 起動時バナーは有効時に `Cache:     explicit (CachedContent, ttl <秒>s)` を表示する

### システムプロンプトの行除去 (`--strip-system-line`)

クライアントが送ってきたシステムプロンプトから、指定した文字列を含む**行**を上流へ転送する前に丸ごと除去する汎用フィルタ。社内テンプレートの除去・冗長な定型文の削減などのプロンプト整形に使う。

```bash
# "Internal use only" を含む行を除去
proxa --strip-system-line "Internal use only"

# カンマ区切りで複数パターン (前後の空白はトリムされる)
proxa --strip-system-line "Internal use only, Confidential:"

# 繰り返し指定も可 (カンマ区切りと併用・合算できる)
proxa --strip-system-line "Internal use only" --strip-system-line "Confidential:"
```

- マッチングは**大文字小文字を区別する部分一致**。指定文字列を含む行だけが削除され、それ以外の行はそのまま残る
- 1 つの値を**カンマ区切り**にすると複数パターンを指定できる。`--strip-system-line` の繰り返し・環境変数 `STRIP_SYSTEM_LINE` とすべて合算される
- 全エンドポイント (`/v1/messages`・`/v1/responses`・`/v1/chat/completions`・`/v1beta/models/{model}:…`) のシステムプロンプト / `instructions` / `system`・`developer` メッセージに適用される
- 除去の結果システムプロンプトが空になった場合は、上流へ system を送らない
- `/logs` の `request` 表示は**行除去後**(実際に上流へ送った内容)になるため、除去が効いているかをそこで確認できる

### 最小ツール構成 (`--min`)

クライアント (例: Claude Code) が送ってくるツール定義のうち、エージェント実行・タスク管理・スケジューリングなど最小構成では不要なツールを、上流へ転送する前に名前で除外する。軽量なモデル・上流へ余計なツールを送りたくない場合に使う。

```bash
# --min を付けるだけ
proxa --min

# 環境変数でも指定可
MIN_TOOLS=1 proxa
```

- 除外対象 (ツール名と完全一致): `DesignSync` / `NotebookEdit` / `WaitForMcpServers` / `Monitor` / `PushNotification` / `ScheduleWakeup` / `TaskCreate` / `TaskGet` / `TaskList` / `TaskOutput` / `TaskStop` / `TaskUpdate` / `Agent` / `CronCreate` / `CronDelete` / `CronList` / `EnterWorktree` / `ExitWorktree` / `EnterPlanMode` / `ExitPlanMode` / `Skill` / `Workflow` / `mcp__ide__executeCode` / `mcp__ide__getDiagnostics`
- 組み込み Web 検索 (`google_search` / `WebSearch`) はサーバー側で注入されるツールのため `--min` の影響を受けない (無効化は `--no-search`)
- 全エンドポイント (`/v1/messages`・`/v1/responses`・`/v1/chat/completions`・`/v1beta/models/{model}:…`) に適用される
- `/logs` の `request.tools` は**除外後**(実際に上流へ送ったツール)を表示する

## 開発

```bash
pnpm dev      # ホットリロードあり
pnpm build    # TypeScript コンパイル → dist/
pnpm start    # ビルド済みで起動
```

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
       │  上流は全プロバイダー対応
       ▼
     [geminiContentsToAnthropic / geminiToolsToAnthropic]  src/converters/from-gemini.ts
  │
  │  共通プロバイダー  src/handlers/provider.ts
  │  Vercel AI SDK (ai / @ai-sdk/openai / @ai-sdk/google / @openrouter/ai-sdk-provider)
  ▼
上流エンドポイント
  ├─ Chat Completions 互換: ollama / openai / responses / openrouter / azure (パススルー)
  └─ Google Gemini API (変換)
  │  レスポンス変換
  ▼
クライアントへ返却 (Anthropic 形式 / Responses API 形式 / Chat Completions 形式 / Gemini 形式 / SSE / WebSocket)
```

## エージェントコーディングツールでの使用例
```ps1
proxa --provider openai -k $env:OPENAI_API_KEY --model gpt-5.4-mini
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

### Gemini CLI
```ps1
$env:GEMINI_API_KEY="dummy"
$env:GOOGLE_GEMINI_BASE_URL="http://localhost:3000"
gemini
```

※モデルオプションは任意です。proxa の `--model` オプションが優先されます。

## ライセンス

MIT
