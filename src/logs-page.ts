export const logsPage = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>proxa — 通信ログ</title>
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
      --sel: #ecebe4;
      --radius: 2px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Noto Serif JP', Georgia, serif;
      font-size: 15px;
      line-height: 1.7;
      color: var(--fg);
      background: var(--bg);
      padding: 2.5rem 1.5rem;
    }

    main { max-width: 1280px; margin: 0 auto; }

    header {
      margin-bottom: 1.5rem;
      padding-bottom: 1.25rem;
      border-bottom: 1px solid var(--border);
    }

    header h1 {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 1.8rem;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin-bottom: 0.4rem;
      line-height: 1.2;
    }

    header h1 a { color: inherit; text-decoration: none; }
    header h1 a:hover { text-decoration: underline; }
    header h1 .path { color: var(--muted); font-weight: 400; }

    header p { color: var(--muted); font-size: 0.9rem; }

    code {
      font-family: 'Cascadia Code', 'BIZ UDGothic', monospace;
      font-size: 0.83em;
      background: var(--code-bg);
      padding: 0.08em 0.32em;
      border-radius: var(--radius);
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
    }

    button {
      font-family: Georgia, 'Times New Roman', 'Noto Sans JP', sans-serif;
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.03em;
      color: var(--fg);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 0.4rem 1.1rem;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    button:hover { border-color: var(--fg); background: var(--code-bg); }

    .toolbar label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8rem;
      color: var(--muted);
      cursor: pointer;
      font-family: Georgia, 'Times New Roman', 'Noto Sans JP', sans-serif;
    }
    .toolbar input[type="checkbox"] { width: 14px; height: 14px; accent-color: var(--fg); cursor: pointer; }
    .toolbar .count { margin-left: auto; font-size: 0.8rem; color: var(--muted); }

    .layout { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 1.5rem; align-items: start; }

    /* テーブル */
    .table-wrap { border: 1px solid var(--border); border-radius: var(--radius); overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    /* 横に長いときはテーブルを縮めずスクロールさせる */
    .table-wrap table { min-width: max-content; }
    thead th {
      font-family: Georgia, 'Times New Roman', 'Noto Sans JP', sans-serif;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--muted);
      text-align: left;
      padding: 0.6rem 0.7rem;
      background: var(--code-bg);
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    thead th.num, tbody td.num { text-align: right; }
    tbody td {
      padding: 0.55rem 0.7rem;
      border-bottom: 1px solid var(--border-light);
      vertical-align: middle;
      white-space: nowrap;
    }
    tbody tr { cursor: pointer; }
    tbody tr:hover { background: var(--code-bg); }
    tbody tr.selected { background: var(--sel); }
    tbody tr:last-child td { border-bottom: none; }

    .mono { font-family: 'Cascadia Code', 'BIZ UDGothic', monospace; }
    .model-cell { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
    .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 0.45rem; vertical-align: middle; }
    .dot.ok { background: #4a8f4a; }
    .dot.error { background: #b3472f; }
    .dot.pending { background: #c8a020; animation: pulse 1s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

    .empty { padding: 2.5rem 1rem; text-align: center; color: var(--muted); font-size: 0.9rem; }

    /* 詳細パネル */
    .detail {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.1rem 1.2rem;
      position: sticky;
      top: 1rem;
      max-height: calc(100vh - 2rem);
      overflow-y: auto;
    }
    .detail .placeholder { color: var(--muted); font-size: 0.9rem; text-align: center; padding: 2rem 0; }

    .detail h2 {
      font-family: Georgia, 'Times New Roman', 'Noto Sans JP', sans-serif;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--muted);
      margin: 1.3rem 0 0.6rem;
      padding-bottom: 0.35rem;
      border-bottom: 1px solid var(--border);
    }
    .detail h2:first-child { margin-top: 0; }

    .meta-grid { display: grid; grid-template-columns: auto 1fr; gap: 0.2rem 0.9rem; font-size: 0.82rem; }
    .meta-grid dt { color: var(--muted); font-family: Georgia, 'Noto Sans JP', sans-serif; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; padding-top: 0.12rem; }
    .meta-grid dd { font-family: 'Cascadia Code', 'BIZ UDGothic', monospace; font-size: 0.8rem; word-break: break-all; }

    .msg { margin-bottom: 0.7rem; }
    .msg .role {
      font-family: Georgia, 'Noto Sans JP', sans-serif;
      font-size: 0.66rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      display: inline-block;
      padding: 0.08rem 0.5rem;
      border-radius: var(--radius);
      margin-bottom: 0.3rem;
    }
    .role.system    { background: #ece7f6; color: #5b478f; }
    .role.user      { background: #e3f0e3; color: #3c7a3c; }
    .role.assistant { background: #e1ecf7; color: #2f5f93; }
    .role.tool      { background: #f7efd9; color: #8a6d1f; }
    .role.developer { background: #ece7f6; color: #5b478f; }
    .msg .body {
      background: var(--code-bg);
      border-radius: var(--radius);
      padding: 0.6rem 0.75rem;
      font-family: 'Cascadia Code', 'BIZ UDGothic', monospace;
      font-size: 0.78rem;
      line-height: 1.65;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 22rem;
      overflow-y: auto;
    }

    .err-box { background: #fbeae6; color: #a04020; border-radius: var(--radius); padding: 0.7rem 0.85rem; font-family: 'Cascadia Code', monospace; font-size: 0.8rem; white-space: pre-wrap; word-break: break-word; }

    details { margin-top: 0.8rem; }
    summary {
      font-family: Georgia, 'Noto Sans JP', sans-serif;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--muted);
      cursor: pointer;
      user-select: none;
    }
    summary:hover { color: var(--fg); }
    pre {
      margin-top: 0.5rem;
      background: var(--code-bg);
      border-radius: var(--radius);
      padding: 0.7rem 0.85rem;
      overflow-x: auto;
      font-family: 'Cascadia Code', 'BIZ UDGothic', monospace;
      font-size: 0.78rem;
      line-height: 1.6;
      max-height: 28rem;
      overflow-y: auto;
    }

    /* 合計 */
    .totals {
      margin-top: 0.9rem;
      padding: 0.75rem 0.9rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--code-bg);
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem 1.4rem;
      align-items: baseline;
    }
    .totals .totals-title {
      font-family: Georgia, 'Times New Roman', 'Noto Sans JP', sans-serif;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--muted);
    }
    .totals .item { font-size: 0.82rem; }
    .totals .item .label {
      font-family: Georgia, 'Noto Sans JP', sans-serif;
      font-size: 0.72rem;
      color: var(--muted);
      margin-right: 0.35rem;
    }
    .totals .item .val { font-family: 'Cascadia Code', 'BIZ UDGothic', monospace; font-weight: 700; }
    .totals .item .val.cost { color: #3c7a3c; }

    /* 料金表エディタ */
    .pricing {
      margin-bottom: 1.25rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem 1.1rem;
    }
    .pricing[hidden] { display: none; }
    .pricing p.hint { color: var(--muted); font-size: 0.78rem; margin-bottom: 0.7rem; line-height: 1.6; }
    .pricing table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    .pricing thead th {
      font-family: Georgia, 'Times New Roman', 'Noto Sans JP', sans-serif;
      font-size: 0.66rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--muted); text-align: left; padding: 0.35rem 0.4rem; white-space: nowrap;
    }
    .pricing tbody td { padding: 0.25rem 0.4rem; border-bottom: 1px solid var(--border-light); }
    .pricing input {
      font-family: 'Cascadia Code', 'BIZ UDGothic', monospace;
      font-size: 0.8rem; color: var(--fg); background: var(--bg);
      border: 1px solid var(--border); border-radius: var(--radius);
      padding: 0.25rem 0.4rem; width: 100%;
    }
    .pricing input:focus { outline: none; border-color: var(--fg); }
    .pricing input.num { text-align: right; }
    .pricing-rate { margin-bottom: 0.8rem; font-size: 0.82rem; }
    .pricing-rate label { display: inline-flex; align-items: center; gap: 0.4rem; font-family: Georgia, 'Noto Sans JP', sans-serif; color: var(--fg); }
    .pricing-rate input { width: 7rem; text-align: right; }
    .pricing .row-del {
      font-family: Georgia, sans-serif; font-size: 0.95rem; line-height: 1;
      color: var(--muted); background: none; border: none; padding: 0.2rem 0.4rem; cursor: pointer;
    }
    .pricing .row-del:hover { color: #b3472f; background: none; }
    .pricing .pricing-actions { margin-top: 0.7rem; display: flex; gap: 0.7rem; }

    @media (max-width: 880px) {
      .layout { grid-template-columns: 1fr; }
      .detail { position: static; max-height: none; }
      body { padding: 1.75rem 1rem; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1><a href="/">proxa</a><span class="path"> /logs</span></h1>
      <p>プロキシを通過したリクエストの通信ログ。行をクリックするとプロンプトの詳細を表示します。</p>
    </header>

    <div class="toolbar">
      <button id="refresh" type="button">更新</button>
      <label><input type="checkbox" id="auto"> 自動更新 (3秒)</label>
      <button id="pricing-toggle" type="button">料金表</button>
      <button id="clear" type="button">クリア</button>
      <span class="count" id="count"></span>
    </div>

    <section class="pricing" id="pricing" hidden>
      <p class="hint">
        モデル名とプロバイダ名が一致 (大文字小文字を問わず) する行の単価でコストを計算します。料金は 100 万トークンあたりの金額 ($ / 1M tokens)。<br>
        入力トークンにはキャッシュ分が含まれます。コストはキャッシュ分を入力単価から差し引き、入力キャッシュ単価で計算します。設定はこのブラウザに保存されます。
      </p>
      <div class="pricing-rate">
        <label>為替レート: 1 USD = <input type="number" id="usd-jpy" step="any" min="0" placeholder="例: 150"> JPY</label>
      </div>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Model</th>
            <th class="num">Input</th>
            <th class="num">In cache</th>
            <th class="num">Output</th>
            <th class="num">Out cache</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="pricing-rows"></tbody>
      </table>
      <div class="pricing-actions">
        <button id="pricing-add" type="button">行を追加</button>
      </div>
    </section>

    <div class="layout">
      <div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Model</th>
                <th>Provider</th>
                <th class="num">Input</th>
                <th class="num">In cache</th>
                <th class="num">Output</th>
                <th class="num">Cost</th>
                <th class="num">Speed</th>
              </tr>
            </thead>
            <tbody id="rows"></tbody>
          </table>
          <div class="empty" id="empty" hidden>ログはまだありません。</div>
        </div>
        <div class="totals" id="totals" hidden></div>
      </div>
      <div class="detail" id="detail">
        <div class="placeholder">行を選択するとここに詳細が表示されます。</div>
      </div>
    </div>
  </main>

  <script>
    var rowsEl   = document.getElementById('rows');
    var emptyEl  = document.getElementById('empty');
    var detailEl = document.getElementById('detail');
    var countEl  = document.getElementById('count');
    var autoEl   = document.getElementById('auto');
    var totalsEl = document.getElementById('totals');
    var pricingEl = document.getElementById('pricing');
    var pricingRowsEl = document.getElementById('pricing-rows');
    var logs = [];
    var selectedId = null;
    var timer = null;

    // --- 料金表 (localStorage に保存) ---
    var PRICING_KEY = 'proxa_pricing';
    var USDJPY_KEY = 'proxa_usdjpy';
    var DEFAULT_USDJPY = 160; // 為替レート未設定時のデフォルト (1 USD = 160 円)
    var pricing = loadPricing();
    var usdJpy = loadUsdJpy(); // 1 USD = usdJpy 円 (0 = 円換算なし)

    function loadUsdJpy() {
      try { var v = parseFloat(localStorage.getItem(USDJPY_KEY)); return isFinite(v) && v > 0 ? v : DEFAULT_USDJPY; }
      catch (e) { return DEFAULT_USDJPY; }
    }
    function saveUsdJpy() {
      try {
        if (usdJpy > 0) localStorage.setItem(USDJPY_KEY, String(usdJpy));
        else localStorage.removeItem(USDJPY_KEY);
      } catch (e) {}
    }

    function loadPricing() {
      try {
        var raw = localStorage.getItem(PRICING_KEY);
        var arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
      } catch (e) { return []; }
    }
    function savePricing() {
      try { localStorage.setItem(PRICING_KEY, JSON.stringify(pricing)); } catch (e) {}
    }
    function priceNum(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

    // provider と model が一致 (大文字小文字を問わず) する料金行を探す
    function findPrice(e) {
      var prov = (e.provider || '').toLowerCase();
      var model = (e.model || '').toLowerCase();
      for (var i = 0; i < pricing.length; i++) {
        var p = pricing[i];
        if ((p.provider || '').toLowerCase() === prov && (p.model || '').toLowerCase() === model) return p;
      }
      return null;
    }
    // コスト (USD)。一致する料金行がなければ null。
    function costOf(e) {
      var p = findPrice(e);
      if (!p) return null;
      var inCache = e.inputCacheTokens || 0;
      var outCache = e.outputCacheTokens || 0;
      var inBase = Math.max(0, (e.inputTokens || 0) - inCache);
      var outBase = Math.max(0, (e.outputTokens || 0) - outCache);
      return (
        inBase * priceNum(p.input) +
        inCache * priceNum(p.inputCache) +
        outBase * priceNum(p.output) +
        outCache * priceNum(p.outputCache)
      ) / 1e6;
    }
    function fmtCost(n) {
      var s = '$' + n.toFixed(6);
      if (usdJpy > 0) {
        // 0.0001 単位で四捨五入して表示
        var jpy = Math.round(n * usdJpy * 10000) / 10000;
        s += ' (JPY ' + jpy.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + ')';
      }
      return s;
    }

    function fmtDate(ts) {
      var d = new Date(ts);
      var pad = function (n) { return String(n).padStart(2, '0'); };
      var mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
      return mon + ' ' + pad(d.getDate()) + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }
    function fmtNum(n) { return (n == null ? 0 : n).toLocaleString(); }
    function fmtSpeed(e) {
      if (e.status !== 'ok' || !e.durationMs || !e.outputTokens) return '—';
      return (e.outputTokens / (e.durationMs / 1000)).toFixed(1) + ' tok/s';
    }
    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }

    function renderRows() {
      rowsEl.textContent = '';
      emptyEl.hidden = logs.length > 0;
      countEl.textContent = logs.length > 0 ? (logs.length + ' 件') : '';
      logs.forEach(function (e) {
        var tr = el('tr');
        if (e.id === selectedId) tr.className = 'selected';
        tr.addEventListener('click', function () { select(e.id); });

        var tdDate = el('td');
        var dot = el('span', 'dot ' + e.status);
        tdDate.appendChild(dot);
        tdDate.appendChild(document.createTextNode(fmtDate(e.timestamp)));
        tr.appendChild(tdDate);

        tr.appendChild(el('td', 'mono model-cell', e.model));
        tr.appendChild(el('td', '', e.provider));
        var pending = e.status === 'pending';
        tr.appendChild(el('td', 'num mono', pending ? '…' : fmtNum(e.inputTokens)));
        tr.appendChild(el('td', 'num mono', pending ? '…' : fmtNum(e.inputCacheTokens)));
        tr.appendChild(el('td', 'num mono', pending ? '…' : fmtNum(e.outputTokens)));
        var cost = pending ? null : costOf(e);
        tr.appendChild(el('td', 'num mono', pending ? '…' : (cost == null ? '—' : fmtCost(cost))));
        tr.appendChild(el('td', 'num mono', fmtSpeed(e)));

        rowsEl.appendChild(tr);
      });
      renderTotals();
    }

    function renderTotals() {
      totalsEl.textContent = '';
      totalsEl.hidden = logs.length === 0;
      if (logs.length === 0) return;
      var sum = { input: 0, inputCache: 0, output: 0, outputCache: 0, cost: 0 };
      logs.forEach(function (e) {
        sum.input += e.inputTokens || 0;
        sum.inputCache += e.inputCacheTokens || 0;
        sum.output += e.outputTokens || 0;
        sum.outputCache += e.outputCacheTokens || 0;
        var c = costOf(e);
        if (c != null) sum.cost += c;
      });
      totalsEl.appendChild(el('span', 'totals-title', '合計'));
      var addItem = function (label, value, cls) {
        var item = el('span', 'item');
        item.appendChild(el('span', 'label', label));
        item.appendChild(el('span', 'val' + (cls ? ' ' + cls : ''), value));
        totalsEl.appendChild(item);
      };
      addItem('入力', fmtNum(sum.input));
      addItem('入力キャッシュ', fmtNum(sum.inputCache));
      addItem('出力', fmtNum(sum.output));
      addItem('出力キャッシュ', fmtNum(sum.outputCache));
      addItem('コスト', fmtCost(sum.cost), 'cost');
    }

    // --- プロンプト整形 ---
    function stringifyBlock(b) {
      if (b == null) return '';
      if (typeof b === 'string') return b;
      if (typeof b !== 'object') return String(b);
      switch (b.type) {
        case 'text':
        case 'input_text':
        case 'output_text':
          return b.text || '';
        case 'image':
        case 'input_image':
        case 'image_url':
          return '[image]';
        case 'tool_use':
          return '🔧 ' + (b.name || 'tool') + '(' + JSON.stringify(b.input == null ? {} : b.input) + ')';
        case 'tool_result':
          return '↳ ' + stringifyContent(b.content);
        default:
          return JSON.stringify(b);
      }
    }
    function stringifyContent(content) {
      if (content == null) return '';
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) return content.map(stringifyBlock).join('\\n');
      return JSON.stringify(content);
    }
    function requestToMessages(req) {
      var out = [];
      if (!req || typeof req !== 'object') return out;
      if (req.system != null) out.push({ role: 'system', text: stringifyContent(req.system) });
      if (req.instructions != null) out.push({ role: 'system', text: stringifyContent(req.instructions) });
      if (Array.isArray(req.messages)) {
        req.messages.forEach(function (m) { out.push({ role: m.role || 'user', text: stringifyContent(m.content) }); });
      }
      if (typeof req.input === 'string') {
        out.push({ role: 'user', text: req.input });
      } else if (Array.isArray(req.input)) {
        req.input.forEach(function (item) {
          if (item.type === 'function_call') out.push({ role: 'assistant', text: '🔧 ' + item.name + '(' + (item.arguments || '') + ')' });
          else if (item.type === 'function_call_output') out.push({ role: 'tool', text: '↳ ' + stringifyContent(item.output) });
          else out.push({ role: item.role || 'user', text: stringifyContent(item.content) });
        });
      }
      return out;
    }

    function roleClass(role) {
      var known = ['system', 'user', 'assistant', 'tool', 'developer'];
      return known.indexOf(role) >= 0 ? role : 'user';
    }

    function addMessage(parent, role, text) {
      var wrap = el('div', 'msg');
      wrap.appendChild(el('span', 'role ' + roleClass(role), role));
      wrap.appendChild(el('div', 'body', text || '(空)'));
      parent.appendChild(wrap);
    }

    function renderDetail(e) {
      detailEl.textContent = '';

      // メタ情報
      detailEl.appendChild(el('h2', null, '概要'));
      var dl = el('dl', 'meta-grid');
      var add = function (k, v) {
        dl.appendChild(el('dt', null, k));
        dl.appendChild(el('dd', null, v));
      };
      add('Time', fmtDate(e.timestamp));
      add('Endpoint', e.endpoint);
      add('Status', e.status + (e.error ? ' (error)' : ''));
      add('Provider', e.provider);
      add('Model', e.modelRequested ? (e.modelRequested + ' → ' + e.model) : e.model);
      add('Stream', e.stream ? 'true' : 'false');
      add('Input', fmtNum(e.inputTokens) + (e.inputCacheTokens ? ' (cache ' + fmtNum(e.inputCacheTokens) + ')' : ''));
      add('Output', fmtNum(e.outputTokens) + (e.outputCacheTokens ? ' (cache ' + fmtNum(e.outputCacheTokens) + ')' : ''));
      var dCost = costOf(e);
      add('Cost', dCost == null ? '—' : fmtCost(dCost));
      add('Duration', e.durationMs ? (e.durationMs + ' ms') : '—');
      add('Speed', fmtSpeed(e));
      detailEl.appendChild(dl);

      // ヘッダー (認証系はマスク済み)
      if (e.headers && Object.keys(e.headers).length) {
        var hdet = el('details');
        hdet.appendChild(el('summary', null, 'ヘッダー (' + Object.keys(e.headers).length + ')'));
        var hdl = el('dl', 'meta-grid');
        Object.keys(e.headers).forEach(function (k) {
          hdl.appendChild(el('dt', null, k));
          hdl.appendChild(el('dd', null, e.headers[k]));
        });
        hdet.appendChild(hdl);
        detailEl.appendChild(hdet);
      }

      // プロンプト
      var msgs = requestToMessages(e.request);
      detailEl.appendChild(el('h2', null, 'プロンプト'));
      if (msgs.length === 0) {
        detailEl.appendChild(el('div', 'placeholder', '(メッセージなし)'));
      } else {
        msgs.forEach(function (m) { addMessage(detailEl, m.role, m.text); });
      }

      // レスポンス
      if (e.error) {
        detailEl.appendChild(el('h2', null, 'エラー'));
        detailEl.appendChild(el('div', 'err-box', e.error));
      } else if (e.response) {
        detailEl.appendChild(el('h2', null, 'レスポンス'));
        if (e.response.text) addMessage(detailEl, 'assistant', e.response.text);
        if (e.response.toolCalls && e.response.toolCalls.length) {
          e.response.toolCalls.forEach(function (tc) {
            addMessage(detailEl, 'assistant', '🔧 ' + tc.name + '(' + (tc.arguments || '') + ')');
          });
        }
        if (!e.response.text && !(e.response.toolCalls && e.response.toolCalls.length)) {
          detailEl.appendChild(el('div', 'placeholder', '(本文なし)'));
        }
      }

      // 生 JSON
      var det = el('details');
      det.appendChild(el('summary', null, 'リクエスト JSON'));
      det.appendChild(el('pre', null, JSON.stringify(e.request, null, 2)));
      detailEl.appendChild(det);

      if (e.response) {
        var det2 = el('details');
        det2.appendChild(el('summary', null, 'レスポンス JSON'));
        det2.appendChild(el('pre', null, JSON.stringify(e.response, null, 2)));
        detailEl.appendChild(det2);
      }
    }

    function select(id) {
      selectedId = id;
      var e = logs.filter(function (x) { return x.id === id; })[0];
      renderRows();
      if (e) renderDetail(e);
    }

    function load() {
      return fetch('/logs/data')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          logs = Array.isArray(data) ? data : [];
          renderRows();
          if (selectedId) {
            var e = logs.filter(function (x) { return x.id === selectedId; })[0];
            if (e) renderDetail(e);
          }
        })
        .catch(function () { logs = []; renderRows(); });
    }

    // 料金表エディタ ---
    function recomputeCosts() {
      renderRows();
      if (selectedId) {
        var sel = logs.filter(function (x) { return x.id === selectedId; })[0];
        if (sel) renderDetail(sel);
      }
    }

    function pricingInput(value, field, idx, isNum) {
      var inp = el('input', isNum ? 'num' : null);
      if (isNum) { inp.type = 'number'; inp.step = 'any'; inp.min = '0'; inp.placeholder = '0'; }
      else { inp.type = 'text'; }
      inp.value = value == null ? '' : value;
      inp.addEventListener('input', function () {
        pricing[idx][field] = inp.value;
        savePricing();
        recomputeCosts();
      });
      return inp;
    }

    function renderPricing() {
      pricingRowsEl.textContent = '';
      pricing.forEach(function (p, idx) {
        var tr = el('tr');
        var addCell = function (node) { var td = el('td'); td.appendChild(node); tr.appendChild(td); };
        addCell(pricingInput(p.provider, 'provider', idx, false));
        addCell(pricingInput(p.model, 'model', idx, false));
        addCell(pricingInput(p.input, 'input', idx, true));
        addCell(pricingInput(p.inputCache, 'inputCache', idx, true));
        addCell(pricingInput(p.output, 'output', idx, true));
        addCell(pricingInput(p.outputCache, 'outputCache', idx, true));
        var del = el('button', 'row-del', '✕');
        del.type = 'button';
        del.title = '削除';
        del.addEventListener('click', function () {
          pricing.splice(idx, 1);
          savePricing();
          renderPricing();
          recomputeCosts();
        });
        addCell(del);
        pricingRowsEl.appendChild(tr);
      });
    }

    document.getElementById('pricing-toggle').addEventListener('click', function () {
      pricingEl.hidden = !pricingEl.hidden;
      if (!pricingEl.hidden) renderPricing();
    });
    document.getElementById('pricing-add').addEventListener('click', function () {
      pricing.push({ provider: '', model: '', input: '', inputCache: '', output: '', outputCache: '' });
      savePricing();
      renderPricing();
    });
    var usdJpyEl = document.getElementById('usd-jpy');
    usdJpyEl.value = usdJpy || '';
    usdJpyEl.addEventListener('input', function () {
      var v = parseFloat(usdJpyEl.value);
      usdJpy = isFinite(v) && v > 0 ? v : 0;
      saveUsdJpy();
      recomputeCosts();
    });

    document.getElementById('refresh').addEventListener('click', load);
    document.getElementById('clear').addEventListener('click', function () {
      fetch('/logs/data', { method: 'DELETE' }).then(function () {
        selectedId = null;
        detailEl.textContent = '';
        detailEl.appendChild(el('div', 'placeholder', '行を選択するとここに詳細が表示されます。'));
        load();
      });
    });
    autoEl.addEventListener('change', function () {
      if (autoEl.checked) { timer = setInterval(load, 3000); }
      else if (timer) { clearInterval(timer); timer = null; }
    });

    load();
  </script>
</body>
</html>`;
