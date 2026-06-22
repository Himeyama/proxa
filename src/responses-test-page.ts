export const responsesTestPage = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>proxa — Responses API テスト</title>
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

    main { max-width: 880px; margin: 0 auto; }

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

    header h1 a { color: inherit; text-decoration: none; }
    header h1 a:hover { text-decoration: underline; }
    header h1 .path { color: var(--muted); font-weight: 400; }

    header p { color: var(--muted); font-size: 0.93rem; line-height: 1.7; }

    section { margin-bottom: 2.75rem; }

    section h2 {
      font-family: Georgia, 'Times New Roman', 'Noto Sans JP', sans-serif;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--muted);
      margin-bottom: 0.8rem;
      padding-bottom: 0.4rem;
      border-bottom: 1px solid var(--border);
    }

    label {
      display: block;
      font-family: Georgia, 'Times New Roman', 'Noto Sans JP', sans-serif;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin-bottom: 0.3rem;
    }

    label .opt {
      font-weight: 400;
      text-transform: none;
      letter-spacing: 0;
      font-family: 'Noto Serif JP', serif;
      font-size: 0.78rem;
    }

    code {
      font-family: 'Cascadia Code', 'BIZ UDGothic', monospace;
      font-size: 0.83em;
      background: var(--code-bg);
      padding: 0.08em 0.32em;
      border-radius: var(--radius);
    }

    input[type="text"],
    input[type="number"],
    textarea {
      width: 100%;
      font-family: 'Cascadia Code', 'BIZ UDGothic', monospace;
      font-size: 0.85rem;
      line-height: 1.6;
      color: var(--fg);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 0.45rem 0.65rem;
      outline: none;
      transition: border-color 0.15s;
    }

    input[type="text"]:focus,
    input[type="number"]:focus,
    textarea:focus { border-color: var(--fg); }

    textarea { resize: vertical; }

    .form-group { margin-bottom: 1.1rem; }

    .form-row {
      display: flex;
      gap: 1.25rem;
      align-items: flex-end;
      flex-wrap: wrap;
      margin-bottom: 1.4rem;
    }

    .form-row .form-group { flex: 1; min-width: 120px; margin-bottom: 0; }
    .form-row .form-group-check { flex: 0 0 auto; padding-bottom: 0.5rem; }

    .form-group-check label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      cursor: pointer;
    }

    input[type="checkbox"] {
      width: 14px;
      height: 14px;
      cursor: pointer;
      accent-color: var(--fg);
    }

    button {
      font-family: Georgia, 'Times New Roman', 'Noto Sans JP', sans-serif;
      font-size: 0.85rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: var(--bg);
      background: var(--fg);
      border: none;
      border-radius: var(--radius);
      padding: 0.55rem 1.75rem;
      cursor: pointer;
      transition: opacity 0.15s;
    }

    button:hover:not(:disabled) { opacity: 0.8; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }

    .hint {
      font-size: 0.78rem;
      color: var(--muted);
      margin-top: 0.5rem;
    }

    .output-box {
      background: var(--code-bg);
      border-radius: var(--radius);
      padding: 1rem 1.1rem;
      min-height: 3rem;
      font-size: 0.9rem;
      line-height: 1.85;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .output-error { color: #a04020; }

    details { margin-top: 0.9rem; }

    summary {
      font-family: Georgia, 'Times New Roman', 'Noto Sans JP', sans-serif;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      cursor: pointer;
      user-select: none;
    }

    summary:hover { color: var(--fg); }

    pre {
      margin-top: 0.5rem;
      background: var(--code-bg);
      border-radius: var(--radius);
      padding: 0.85rem 1rem;
      overflow-x: auto;
      font-family: 'Cascadia Code', 'BIZ UDGothic', monospace;
      font-size: 0.83em;
      line-height: 1.7;
    }

    @media (max-width: 640px) {
      body { padding: 2.5rem 1rem; font-size: 14px; }
      header h1 { font-size: 1.6rem; }
      .form-row { flex-direction: column; gap: 0.75rem; }
      .form-row .form-group { min-width: 0; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1><a href="/">proxa</a><span class="path"> /v1/responses</span></h1>
      <p>OpenAI Responses API (<code>/v1/responses</code>) のテストコンソール。</p>
    </header>

    <section>
      <h2>リクエスト</h2>

      <div class="form-group">
        <label for="f-model">model <span class="opt">（空欄でサーバーデフォルト）</span></label>
        <input type="text" id="f-model" placeholder="例: gpt-4o" spellcheck="false" autocomplete="off">
      </div>

      <div class="form-group">
        <label for="f-instructions">instructions <span class="opt">（任意）</span></label>
        <textarea id="f-instructions" rows="3" placeholder="システムプロンプトを入力..."></textarea>
      </div>

      <div class="form-group">
        <label for="f-input">input</label>
        <textarea id="f-input" rows="6" placeholder="ユーザーメッセージを入力..."></textarea>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="f-max-output-tokens">max_output_tokens</label>
          <input type="number" id="f-max-output-tokens" value="1024" min="1" max="65536">
        </div>
        <div class="form-group">
          <label for="f-temperature">temperature <span class="opt">（任意）</span></label>
          <input type="number" id="f-temperature" step="0.1" min="0" max="2" placeholder="省略時はデフォルト">
        </div>
        <div class="form-group form-group-check">
          <label>
            <input type="checkbox" id="f-stream">
            stream
          </label>
        </div>
      </div>

      <button id="send-btn" type="button">送信</button>
      <p class="hint">Ctrl+Enter / ⌘+Enter でも送信できます。</p>
    </section>

    <section id="output-section" hidden>
      <h2>レスポンス</h2>
      <div id="output-text" class="output-box"></div>
      <details id="raw-details" hidden>
        <summary>Raw JSON</summary>
        <pre id="output-raw"></pre>
      </details>
    </section>
  </main>

  <script>
    const btn           = document.getElementById('send-btn');
    const outputSection = document.getElementById('output-section');
    const outputText    = document.getElementById('output-text');
    const outputRaw     = document.getElementById('output-raw');
    const rawDetails    = document.getElementById('raw-details');

    async function send() {
      const model       = document.getElementById('f-model').value.trim();
      const instructions = document.getElementById('f-instructions').value.trim();
      const input       = document.getElementById('f-input').value.trim();
      const maxTokens   = parseInt(document.getElementById('f-max-output-tokens').value) || 1024;
      const tempVal     = document.getElementById('f-temperature').value.trim();
      const useStream   = document.getElementById('f-stream').checked;

      outputSection.hidden = false;
      outputText.className = 'output-box';
      outputText.textContent = '';
      rawDetails.hidden = true;
      outputRaw.textContent = '';

      if (!input) {
        outputText.textContent = 'input を入力してください。';
        outputText.className = 'output-box output-error';
        return;
      }

      btn.disabled = true;
      btn.textContent = '送信中…';

      const reqBody = {
        input: input,
        max_output_tokens: maxTokens,
        stream: useStream,
      };
      if (model)        reqBody.model = model;
      if (instructions) reqBody.instructions = instructions;
      if (tempVal)      reqBody.temperature = parseFloat(tempVal);

      try {
        const res = await fetch('/v1/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody),
        });

        if (useStream) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          let currentEvent = '';
          let fullText = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\\n');
            buf = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                let data;
                try { data = JSON.parse(line.slice(6)); } catch { continue; }

                if (currentEvent === 'error') {
                  outputText.textContent = data.message || JSON.stringify(data, null, 2);
                  outputText.className = 'output-box output-error';
                } else if (currentEvent === 'response.output_text.delta') {
                  fullText += data.delta || '';
                  outputText.textContent = fullText;
                }
              }
            }
          }
        } else {
          const data = await res.json();
          if (!res.ok) {
            outputText.textContent = data.error && data.error.message ? data.error.message : JSON.stringify(data, null, 2);
            outputText.className = 'output-box output-error';
          } else {
            var text = '';
            var output = data.output || [];
            for (var i = 0; i < output.length; i++) {
              var item = output[i];
              if (item.type === 'message') {
                var content = item.content || [];
                for (var j = 0; j < content.length; j++) {
                  if (content[j].type === 'output_text') {
                    text += content[j].text;
                  }
                }
              }
            }
            outputText.textContent = text || '(レスポンスなし)';
            rawDetails.hidden = false;
            outputRaw.textContent = JSON.stringify(data, null, 2);
          }
        }
      } catch (err) {
        outputText.textContent = err.message || String(err);
        outputText.className = 'output-box output-error';
      } finally {
        btn.disabled = false;
        btn.textContent = '送信';
      }
    }

    btn.addEventListener('click', send);

    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') send();
    });
  </script>
</body>
</html>`;
