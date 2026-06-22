## proxa — Gemini の URL まとめ

`--provider gemini`（`google` も同義）指定時、`-u/--url` で渡した URL は
`@ai-sdk/google`（`createGoogleGenerativeAI`）の **baseURL** として使われ、SDK が必ず

    {baseURL}/models/{model}:generateContent
    {baseURL}/models/{model}:streamGenerateContent?alt=sse

を組み立てて **Gemini ネイティブ形式**で通信する。つまり「URL のホスト／パス接頭辞」は
差し替え可能だが、「話すプロトコル」は Gemini 形式に固定される。

### デフォルト URL
- `--provider gemini` / `google` のデフォルト baseURL:
  `https://generativelanguage.googleapis.com/v1beta`
- `-u` 未指定なら上記が使われる。

### カスタム URL（`-u`）
- `-u` の URL がそのまま baseURL になる（モデル名の手前＝`/v1beta` まで を渡す）。
- 差し替え先が **Gemini API 互換**である必要がある（プロキシ・リージョナル・自前ゲートウェイ等）。
- OpenAI Chat Completions 形式など **非互換プロトコルの URL は `--provider gemini` では動かない**。
- 注意: Gemini/Google では環境変数 `CHAT_BASE_URL` は適用されない。カスタム URL は `-u` のみ有効。

### モデル名付き URL の自動分解
`-u` に `.../models/{model}:generateContent` 形式を渡すと、`parseGeminiModelURL()` が
ベース URL とモデル名に分解する。
- 例: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
  → baseURL = `https://generativelanguage.googleapis.com/v1beta`, model = `gemini-2.5-flash`
- `-m` / `CHAT_DEFAULT_MODEL` が未指定なら、URL 内のモデル名がデフォルトモデルになる。

### プロバイダー自動判定
- `--provider` 省略時、`-u` の URL から判定する。
  `generativelanguage.googleapis.com` を含む URL → `google` 扱い。
- 上記ドメイン以外の URL は `custom`（＝ OpenAI 互換扱い）になるため、
  非 google ドメインで Gemini ネイティブ処理を強制したいなら `--provider gemini` を明示する。

### 任意 URL へそのまま転送したい場合（`--gemini-relay-url`）
SDK の `{baseURL}/models/{model}:...` 組み立てに当てはまらない URL へ送りたいとき、
`--gemini-relay-url <url>`（または環境変数 `GEMINI_RELAY_URL`）を指定すると、
SDK が組み立てた URL を破棄して**設定した URL へ verbatim 転送**する。
- 実体は `getProvider()` が `createGoogleGenerativeAI({ fetch })` に渡すインターセプター（別ポート不要）。
- ストリーム判定の `?alt=sse` は転送先にも引き継がれる（非ストリーム → `<url>`、ストリーム → `<url>?alt=sse`）。
- モデル名は URL に乗らない（転送先がモデルを決める前提）。`-u` は relay 時には使われない。
- 例: `proxa --provider gemini --gemini-relay-url https://example.com/v1/baseurl/endpoint -k "$KEY"`

### Gemini モデルを「OpenAI 互換 URL」で使いたい場合
`--provider gemini` ではなく **`--provider openai`** にして OpenAI 互換 URL を `-u` で渡す。
こうすると Chat Completions 互換上流として **パススルー**処理される。
- 例: `https://generativelanguage.googleapis.com/v1beta/openai/`

### API キー
- `-k/--api-key` → `CHAT_API_KEY` → `GOOGLE_GENERATIVE_AI_API_KEY` の順でフォールバック。

### コマンド例

    # 1) デフォルト (Google AI Studio)
    proxa --provider gemini -k "$GEMINI_API_KEY"

    # 2) カスタム baseURL（Gemini 互換プロキシなど）
    proxa --provider gemini -u https://my-proxy.example.com/v1beta -k "$KEY"

    # 3) モデル名付き URL（自動分解 → baseURL と model に分かれる）
    proxa --provider gemini \
      -u https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent \
      -k "$GEMINI_API_KEY"

    # 4) URL からプロバイダー自動判定（google と判定される）
    proxa -u https://generativelanguage.googleapis.com/v1beta -k "$GEMINI_API_KEY"

    # 5) Gemini モデルを OpenAI 互換エンドポイントで使う（provider は openai）
    proxa --provider openai \
      -u https://generativelanguage.googleapis.com/v1beta/openai \
      -k "$GEMINI_API_KEY"
