export const usagePage = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ant2chat</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=BIZ+UDGothic:wght@400;700&family=Noto+Sans+JP:wght@700&family=Noto+Serif+JP:wght@400&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #fafaf8;
      --fg: #1c1c1a;
      --border: #d6d6d0;
      --border-light: #e8e8e2;
      --muted: #6b6b65;
      --code-bg: #f0f0eb;
      --radius: 2px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Noto Serif JP', Georgia, serif;
      font-size: 15px;
      line-height: 1.9;
      color: var(--fg);
      background: var(--bg);
      padding: 3.5rem 1.5rem;
    }

    main {
      max-width: 880px;
      margin: 0 auto;
    }

    header {
      margin-bottom: 3rem;
      padding-bottom: 1.75rem;
      border-bottom: 1px solid var(--border);
    }

    header h1 {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin-bottom: 0.6rem;
      line-height: 1.2;
    }

    header p {
      color: var(--muted);
      font-size: 0.93rem;
      line-height: 1.7;
    }

    section {
      margin-bottom: 2.75rem;
    }

    section h2 {
      font-family: Georgia, 'Times New Roman', 'Noto Sans JP', sans-serif;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--muted);
      margin-bottom: 0.65rem;
      padding-bottom: 0.4rem;
      border-bottom: 1px solid var(--border);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }

    thead th {
      font-family: Georgia, 'Times New Roman', 'Noto Sans JP', sans-serif;
      font-weight: 700;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--muted);
      padding: 0.25rem 0.8rem;
      border-bottom: 1px solid var(--border);
      text-align: left;
      white-space: nowrap;
    }

    tbody td {
      padding: 0.5rem 0.8rem;
      border-bottom: 1px solid var(--border-light);
      vertical-align: top;
      line-height: 1.65;
    }

    tbody tr:last-child td {
      border-bottom: none;
    }

    code {
      font-family: 'Cascadia Code', 'BIZ UDGothic', monospace;
      font-size: 0.83em;
      background: var(--code-bg);
      padding: 0.08em 0.32em;
      border-radius: var(--radius);
    }

    strong, b {
      font-family: Georgia, 'Times New Roman', 'Noto Sans JP', sans-serif;
      font-weight: 700;
    }

    .badge {
      display: inline-block;
      font-family: 'Cascadia Code', 'BIZ UDGothic', monospace;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      padding: 0.12em 0.45em;
      border-radius: var(--radius);
      line-height: 1.5;
    }

    .badge-get  { background: #dff0e6; color: #1a6635; }
    .badge-post { background: #ddeaf8; color: #1a4080; }
    .badge-ws   { background: #eee8f8; color: #52289a; }

    .tag-rec { color: #a04020; font-size: 0.78rem; font-family: 'Noto Serif JP', serif; }
    .tag-opt { color: var(--muted); font-size: 0.78rem; font-family: 'Noto Serif JP', serif; }

    pre {
      background: var(--code-bg);
      border-radius: var(--radius);
      padding: 0.85rem 1rem;
      overflow-x: auto;
      font-family: 'Cascadia Code', 'BIZ UDGothic', monospace;
      font-size: 0.83em;
      line-height: 1.8;
    }

    pre code {
      background: none;
      padding: 0;
      font-size: 1em;
    }

    .comment { color: var(--muted); }

    .col-method { width: 5rem; }
    .col-path   { width: 13rem; white-space: nowrap; }
    .col-opt    { width: 16rem; white-space: nowrap; }
    .col-def    { width: 7rem; white-space: nowrap; }
    .col-var    { width: 16rem; white-space: nowrap; }
    .col-req    { width: 4rem; white-space: nowrap; }

    @media (max-width: 640px) {
      body { padding: 2.5rem 1rem; font-size: 14px; }
      header h1 { font-size: 1.6rem; }
      thead { display: none; }
      table, tbody, tr, td { display: block; }
      tbody tr {
        padding: 0.6rem 0;
        border-bottom: 1px solid var(--border-light);
      }
      tbody tr:last-child { border-bottom: none; }
      tbody td { padding: 0.15rem 0; border: none; }
      .col-method, .col-path, .col-opt, .col-def, .col-var, .col-req { width: auto; white-space: normal; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>ant2chat</h1>
      <p>Anthropic Messages API (<code>/v1/messages</code>)、OpenAI Responses API (<code>/v1/responses</code>)、OpenAI Chat Completions API (<code>/v1/chat/completions</code>) を受け取り、<br>上流のプロバイダー (Chat Completions / Responses API / Google Gemini など) へ変換して転送するプロキシサーバー。</p>
    </header>

    <section>
      <h2>エンドポイント</h2>
      <table>
        <thead>
          <tr>
            <th class="col-method">Method</th>
            <th class="col-path">Path</th>
            <th>説明</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span class="badge badge-get">GET</span></td>
            <td><code>/</code></td>
            <td>このページを表示</td>
          </tr>
          <tr>
            <td><span class="badge badge-get">GET</span></td>
            <td><a href="/v1/messages"><code>/v1/messages</code></a></td>
            <td>Messages API テストページ (ブラウザ) / <code>{"status":"ok"}</code> (API)</td>
          </tr>
          <tr>
            <td><span class="badge badge-post">POST</span></td>
            <td><code>/v1/messages</code></td>
            <td>Anthropic Messages API 互換エンドポイント</td>
          </tr>
          <tr>
            <td><span class="badge badge-get">GET</span></td>
            <td><a href="/v1/responses"><code>/v1/responses</code></a></td>
            <td>Responses API テストページ (ブラウザ) / <code>{"status":"ok"}</code> (API)</td>
          </tr>
          <tr>
            <td><span class="badge badge-post">POST</span></td>
            <td><code>/v1/responses</code></td>
            <td>OpenAI Responses API 互換エンドポイント (HTTP)</td>
          </tr>
          <tr>
            <td><span class="badge badge-ws">WS</span></td>
            <td><code>/v1/responses</code></td>
            <td>OpenAI Responses API 互換エンドポイント (WebSocket)</td>
          </tr>
          <tr>
            <td><span class="badge badge-get">GET</span></td>
            <td><a href="/v1/chat/completions"><code>/v1/chat/completions</code></a></td>
            <td>Chat Completions API テストページ (ブラウザ) / <code>{"status":"ok"}</code> (API)</td>
          </tr>
          <tr>
            <td><span class="badge badge-post">POST</span></td>
            <td><code>/v1/chat/completions</code></td>
            <td>OpenAI Chat Completions API 互換エンドポイント (パススルー / Gemini 変換)</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>CLI オプション</h2>
      <table>
        <thead>
          <tr>
            <th class="col-opt">オプション</th>
            <th class="col-def">デフォルト</th>
            <th>説明</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>--provider &lt;name&gt;</code></td>
            <td><code>ollama</code></td>
            <td>上流プロバイダー: <code>ollama</code> | <code>openai</code> | <code>responses</code> | <code>openrouter</code> | <code>google</code> | <code>gemini</code> | <code>azure</code></td>
          </tr>
          <tr>
            <td><code>-u, --url &lt;url&gt;</code></td>
            <td>—</td>
            <td>上流ベース URL。<code>--provider</code> 省略時は URL からプロバイダーを自動判定</td>
          </tr>
          <tr>
            <td><code>-p, --port &lt;port&gt;</code></td>
            <td><code>3000</code></td>
            <td>Listen ポート</td>
          </tr>
          <tr>
            <td><code>-k, --api-key &lt;key&gt;</code></td>
            <td>—</td>
            <td>上流 API キー</td>
          </tr>
          <tr>
            <td><code>--auth-type &lt;type&gt;</code></td>
            <td><code>bearer</code></td>
            <td>認証ヘッダー形式: <code>bearer</code> | <code>api-key</code></td>
          </tr>
          <tr>
            <td><code>-m, --model &lt;model&gt;</code></td>
            <td>—</td>
            <td>モデル名を強制指定 (クライアントの <code>model</code> フィールドを上書き)</td>
          </tr>
          <tr>
            <td><code>-g, --global</code></td>
            <td>—</td>
            <td><code>0.0.0.0</code> でリッスン (ネットワークに公開)</td>
          </tr>
          <tr>
            <td><code>--no-search</code></td>
            <td>—</td>
            <td>組み込み Web 検索ツールを無効化</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>使用例</h2>
      <pre><code><span class="comment"># Ollama (デフォルト)</span>
ant2chat -u http://localhost:11434/v1 -m llama3.2

<span class="comment"># OpenAI</span>
ant2chat --provider openai --api-key sk-xxx --model gpt-4o

<span class="comment"># OpenAI Responses API</span>
ant2chat --provider responses --api-key sk-xxx --model gpt-5

<span class="comment"># OpenRouter</span>
ant2chat --provider openrouter --api-key sk-or-xxx --model anthropic/claude-3.5-sonnet

<span class="comment"># Google Gemini</span>
ant2chat --provider gemini --api-key AIzaSy-xxx --model gemini-2.0-flash

<span class="comment"># Azure (プロバイダー明示)</span>
ant2chat --provider azure --api-key &lt;key&gt; -u https://&lt;resource&gt;.openai.azure.com/openai/deployments/&lt;deployment&gt; -m gpt-4o

<span class="comment"># Azure は URL 指定のみでも自動判定</span>
ant2chat -u https://&lt;resource&gt;.openai.azure.com/openai/deployments/&lt;deployment&gt; -k &lt;key&gt; -m gpt-4o

<span class="comment"># Gemini は models/{model}:generateContent 形式の URL を直接指定可能</span>
ant2chat -u https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent -k AIzaSy-xxx</code></pre>
    </section>
  </main>
</body>
</html>`;
