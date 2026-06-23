export const logsPage = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>proxa — 通信ログ</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DotGothic16&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { pixel: ['"DotGothic16"', 'sans-serif'] },
          colors: {
            px: {
              bg:    '#1a1a28',
              panel: '#22223a',
              code:  '#252540',
              bdr:   '#44446a',
              txt:   '#c8cce0',
              mut:   '#7880a0',
              tea:   '#6ab8a0',
              blu:   '#6898c8',
              pur:   '#a880c0',
              red:   '#c87070',
              grn:   '#70a870',
              sel:   '#2e2e4a',
              yw:    '#c0a860',
            }
          }
        }
      }
    }
  </script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; border-radius: 0 !important; }
    :root { font-family: 'DotGothic16', sans-serif; }
    ::-webkit-scrollbar { width: 6px; height: 6px; background: #1a1a28; }
    ::-webkit-scrollbar-thumb { background: #44446a; }
    ::-webkit-scrollbar-thumb:hover { background: #7880a0; }
    code { font-family: 'DotGothic16', monospace; font-size: 0.85em; background: #252540; color: #6ab8a0; padding: 0.1em 0.4em; border: 1px solid #44446a; }
    a { color: #6ab8a0; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .btn-px { box-shadow: 2px 2px 0 #44446a; transition: box-shadow 0.05s, transform 0.05s; }
    .btn-px:hover { box-shadow: 1px 1px 0 #44446a; transform: translate(1px, 1px); }
    .btn-px:active { box-shadow: none; transform: translate(2px, 2px); }

    /* ステータスドット (JS で動的生成) */
    .dot { display: inline-block; width: 7px; height: 7px; margin-right: 0.5rem; vertical-align: middle; }
    .dot.ok      { background: #70a870; }
    .dot.error   { background: #c87070; }
    .dot.pending { background: #c0a860; animation: blink 1s infinite; }
    @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.2; } }

    /* メッセージブロック (JS で動的生成) */
    .msg { margin-bottom: 0.6rem; }
    .role {
      display: inline-block;
      font-size: 0.65rem;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 0.06rem 0.5rem;
      margin-bottom: 0.25rem;
      border: 1px solid;
    }
    .role.system    { background: #2a1f3a; color: #a880c0; border-color: #a880c0; }
    .role.user      { background: #1a2e2a; color: #6ab8a0; border-color: #6ab8a0; }
    .role.assistant { background: #1a2238; color: #6898c8; border-color: #6898c8; }
    .role.tool      { background: #2a2218; color: #c0a860; border-color: #c0a860; }
    .role.developer { background: #2a1f3a; color: #a880c0; border-color: #a880c0; }
    .msg .body {
      background: #252540;
      border: 1px solid #44446a;
      border-left: 3px solid #44446a;
      padding: 0.5rem 0.7rem;
      font-family: 'DotGothic16', monospace;
      font-size: 0.75rem;
      line-height: 1.65;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 20rem;
      overflow-y: auto;
      color: #c8cce0;
    }
    .err-box {
      background: #2a1818;
      color: #c87070;
      border: 2px solid #c87070;
      padding: 0.6rem 0.8rem;
      font-family: 'DotGothic16', monospace;
      font-size: 0.75rem;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* メタグリッド (JS で動的生成) */
    .meta-grid { display: grid; grid-template-columns: auto 1fr; gap: 0.2rem 0.8rem; font-size: 0.78rem; }
    .meta-grid dt { color: #7880a0; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; padding-top: 0.1rem; }
    .meta-grid dd { font-family: 'DotGothic16', monospace; font-size: 0.75rem; word-break: break-all; color: #c8cce0; }

    /* mono クラス (JS で動的生成) */
    .mono { font-family: 'DotGothic16', monospace; }

    /* テーブル行スタイル */
    tbody tr { cursor: pointer; }
    tbody tr:hover td { background: #2e2e4a; }
    tbody tr.selected td { background: #2e2e4a; border-left: 2px solid #a880c0; }
    tbody td.num { text-align: right; }
    thead th.num { text-align: right; }

    /* 合計 */
    .totals { display: flex; flex-wrap: wrap; gap: 0.3rem 1.2rem; align-items: baseline; }
    .totals .totals-title { font-size: 0.68rem; font-weight: bold; text-transform: uppercase; letter-spacing: 0.07em; color: #7880a0; }
    .totals .item { font-size: 0.78rem; }
    .totals .item .label { font-size: 0.68rem; color: #7880a0; margin-right: 0.3rem; }
    .totals .item .val { font-family: 'DotGothic16', monospace; font-weight: bold; color: #c8cce0; }
    .totals .item .val.cost { color: #70a870; }

    /* 料金表 */
    .pricing input {
      font-family: 'DotGothic16', monospace;
      font-size: 0.75rem;
      color: #c8cce0;
      background: #1a1a28;
      border: 1px solid #44446a;
      padding: 0.2rem 0.35rem;
      width: 100%;
      outline: none;
    }
    .pricing input:focus { border-color: #a880c0; }
    .pricing input.num { text-align: right; }
    .pricing .row-del {
      font-family: 'DotGothic16', sans-serif;
      font-size: 0.9rem;
      color: #7880a0;
      background: none;
      border: none;
      padding: 0.15rem 0.35rem;
      cursor: pointer;
      box-shadow: none !important;
      transform: none !important;
    }
    .pricing .row-del:hover { color: #c87070; }

    /* model-cell */
    .model-cell { max-width: 200px; overflow: hidden; text-overflow: ellipsis; }

    /* placeholder */
    .placeholder { color: #7880a0; font-size: 0.85rem; text-align: center; padding: 2rem 0; }

    details summary { cursor: pointer; user-select: none; }
    details summary:hover { color: #c8cce0; }
  </style>
</head>
<body class="min-h-screen bg-px-bg text-px-txt font-pixel text-sm leading-relaxed px-6 py-8">
  <main class="max-w-[1300px] mx-auto">

    <header class="mb-6 pb-5 border-b-2 border-px-bdr">
      <h1 class="text-xl font-bold tracking-widest mb-2">
        <a href="/" class="text-px-txt no-underline hover:text-px-tea transition-colors"><span class="text-px-tea">▸</span> proxa</a><span class="text-px-mut font-normal"> /logs</span>
      </h1>
      <p class="text-px-mut text-xs">プロキシを通過したリクエストの通信ログ。行をクリックするとプロンプトの詳細を表示します。</p>
    </header>

    <div class="flex flex-wrap items-center gap-3 mb-5">
      <button id="refresh" type="button" class="btn-px bg-px-panel border border-px-bdr text-px-txt text-xs font-bold uppercase tracking-wider px-4 py-1.5 cursor-pointer">更新</button>
      <label class="flex items-center gap-2 text-xs text-px-mut cursor-pointer">
        <input type="checkbox" id="auto" class="w-3.5 h-3.5 accent-px-pur cursor-pointer">
        自動更新 (3秒)
      </label>
      <button id="pricing-toggle" type="button" class="btn-px bg-px-panel border border-px-bdr text-px-txt text-xs font-bold uppercase tracking-wider px-4 py-1.5 cursor-pointer">料金表</button>
      <button id="clear" type="button" class="btn-px bg-px-panel border border-px-bdr text-px-red text-xs font-bold uppercase tracking-wider px-4 py-1.5 cursor-pointer">クリア</button>
      <span id="count" class="ml-auto text-xs text-px-mut"></span>
    </div>

    <section class="pricing mb-5 border-2 border-px-bdr bg-px-panel p-4" id="pricing" hidden>
      <p class="text-px-mut text-xs mb-3 leading-relaxed">
        モデル名とプロバイダ名が一致 (大文字小文字を問わず) する行の単価でコストを計算します。料金は 100 万トークンあたりの金額 ($ / 1M tokens)。<br>
        入力トークンにはキャッシュ分が含まれます。コストはキャッシュ分を入力単価から差し引き、入力キャッシュ単価で計算します。設定はこのブラウザに保存されます。
      </p>
      <div class="mb-3 text-xs">
        <label class="inline-flex items-center gap-2 text-px-mut">
          為替レート: 1 USD = <input type="number" id="usd-jpy" step="any" min="0" placeholder="例: 150" class="w-24" style="font-family:'DotGothic16',monospace;font-size:0.75rem;color:#c8cce0;background:#1a1a28;border:1px solid #44446a;padding:0.2rem 0.35rem;outline:none;text-align:right;"> JPY
        </label>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-xs">
          <thead>
            <tr class="bg-px-code">
              <th class="text-left px-2 py-1.5 border-b border-px-bdr text-px-mut font-bold uppercase tracking-wider text-xs">Provider</th>
              <th class="text-left px-2 py-1.5 border-b border-px-bdr text-px-mut font-bold uppercase tracking-wider text-xs">Model</th>
              <th class="text-right px-2 py-1.5 border-b border-px-bdr text-px-mut font-bold uppercase tracking-wider text-xs">Input</th>
              <th class="text-right px-2 py-1.5 border-b border-px-bdr text-px-mut font-bold uppercase tracking-wider text-xs">In cache</th>
              <th class="text-right px-2 py-1.5 border-b border-px-bdr text-px-mut font-bold uppercase tracking-wider text-xs">Output</th>
              <th class="text-right px-2 py-1.5 border-b border-px-bdr text-px-mut font-bold uppercase tracking-wider text-xs">Out cache</th>
              <th class="px-2 py-1.5 border-b border-px-bdr"></th>
            </tr>
          </thead>
          <tbody id="pricing-rows"></tbody>
        </table>
      </div>
      <div class="mt-3 flex gap-3">
        <button id="pricing-add" type="button" class="btn-px bg-px-bg border border-px-bdr text-px-txt text-xs font-bold uppercase tracking-wider px-3 py-1.5 cursor-pointer">行を追加</button>
      </div>
    </section>

    <div class="grid gap-5" style="grid-template-columns: minmax(0,1.15fr) minmax(0,1fr); align-items: start;">
      <div>
        <div class="border-2 border-px-bdr overflow-x-auto">
          <table class="border-collapse text-xs" style="min-width: max-content; width: 100%;">
            <thead>
              <tr class="bg-px-panel">
                <th class="text-left px-3 py-2 border-b border-px-bdr text-px-mut font-bold uppercase tracking-wider text-xs whitespace-nowrap">Date</th>
                <th class="text-left px-3 py-2 border-b border-px-bdr text-px-mut font-bold uppercase tracking-wider text-xs whitespace-nowrap">Model</th>
                <th class="text-left px-3 py-2 border-b border-px-bdr text-px-mut font-bold uppercase tracking-wider text-xs whitespace-nowrap">Provider</th>
                <th class="num px-3 py-2 border-b border-px-bdr text-px-mut font-bold uppercase tracking-wider text-xs whitespace-nowrap">Input</th>
                <th class="num px-3 py-2 border-b border-px-bdr text-px-mut font-bold uppercase tracking-wider text-xs whitespace-nowrap">In cache</th>
                <th class="num px-3 py-2 border-b border-px-bdr text-px-mut font-bold uppercase tracking-wider text-xs whitespace-nowrap">Output</th>
                <th class="num px-3 py-2 border-b border-px-bdr text-px-mut font-bold uppercase tracking-wider text-xs whitespace-nowrap">Cost</th>
                <th class="num px-3 py-2 border-b border-px-bdr text-px-mut font-bold uppercase tracking-wider text-xs whitespace-nowrap">Speed</th>
              </tr>
            </thead>
            <tbody id="rows"></tbody>
          </table>
          <div class="p-6 text-center text-px-mut text-xs" id="empty" hidden>ログはまだありません。</div>
        </div>
        <div class="mt-3 p-3 border border-px-bdr bg-px-panel" id="totals" hidden></div>
      </div>
      <div class="border-2 border-px-bdr p-4 bg-px-panel sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto" id="detail">
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
    // 入力トークン (入力キャッシュを除く)
    function inputExclCache(e) { return Math.max(0, (e.inputTokens || 0) - (e.inputCacheTokens || 0)); }
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

        var tdDate = el('td', 'px-3 py-2 border-b border-px-bdr/30 whitespace-nowrap text-px-mut');
        var dot = el('span', 'dot ' + e.status);
        tdDate.appendChild(dot);
        tdDate.appendChild(document.createTextNode(fmtDate(e.timestamp)));
        tr.appendChild(tdDate);

        tr.appendChild(el('td', 'mono model-cell px-3 py-2 border-b border-px-bdr/30 whitespace-nowrap', e.model));
        tr.appendChild(el('td', 'px-3 py-2 border-b border-px-bdr/30 whitespace-nowrap text-px-mut', e.provider));
        var pending = e.status === 'pending';
        tr.appendChild(el('td', 'num mono px-3 py-2 border-b border-px-bdr/30 whitespace-nowrap', pending ? '…' : fmtNum(inputExclCache(e))));
        tr.appendChild(el('td', 'num mono px-3 py-2 border-b border-px-bdr/30 whitespace-nowrap text-px-mut', pending ? '…' : fmtNum(e.inputCacheTokens)));
        tr.appendChild(el('td', 'num mono px-3 py-2 border-b border-px-bdr/30 whitespace-nowrap', pending ? '…' : fmtNum(e.outputTokens)));
        var cost = pending ? null : costOf(e);
        tr.appendChild(el('td', 'num mono px-3 py-2 border-b border-px-bdr/30 whitespace-nowrap text-px-grn', pending ? '…' : (cost == null ? '—' : fmtCost(cost))));
        tr.appendChild(el('td', 'num mono px-3 py-2 border-b border-px-bdr/30 whitespace-nowrap text-px-mut', fmtSpeed(e)));

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
        sum.input += inputExclCache(e);
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
          return '[tool] ' + (b.name || 'tool') + '(' + JSON.stringify(b.input == null ? {} : b.input) + ')';
        case 'tool_result':
          return '[-] ' + stringifyContent(b.content);
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
          if (item.type === 'function_call') out.push({ role: 'assistant', text: '[tool] ' + item.name + '(' + (item.arguments || '') + ')' });
          else if (item.type === 'function_call_output') out.push({ role: 'tool', text: '[-] ' + stringifyContent(item.output) });
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

      // セクション見出し
      function detailH2(text) {
        var h = el('div', null, null);
        h.style.cssText = 'font-size:0.65rem;font-weight:bold;text-transform:uppercase;letter-spacing:0.08em;color:#7880a0;margin:1rem 0 0.5rem;padding-bottom:0.3rem;border-bottom:1px solid #44446a;';
        h.textContent = '■ ' + text;
        return h;
      }

      // メタ情報
      detailEl.appendChild(detailH2('概要'));
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
      if (e.cacheKey) add('Cache key', e.cacheKey);
      add('Input', fmtNum(inputExclCache(e)) + (e.inputCacheTokens ? ' (cache ' + fmtNum(e.inputCacheTokens) + ')' : ''));
      add('Output', fmtNum(e.outputTokens) + (e.outputCacheTokens ? ' (cache ' + fmtNum(e.outputCacheTokens) + ')' : ''));
      var dCost = costOf(e);
      add('Cost', dCost == null ? '—' : fmtCost(dCost));
      add('Duration', e.durationMs ? (e.durationMs + ' ms') : '—');
      add('Speed', fmtSpeed(e));
      detailEl.appendChild(dl);

      // ヘッダー (認証系はマスク済み)
      if (e.headers && Object.keys(e.headers).length) {
        var hdet = el('details');
        var hsum = el('summary', null, null);
        hsum.style.cssText = 'font-size:0.65rem;font-weight:bold;text-transform:uppercase;letter-spacing:0.07em;color:#7880a0;margin-top:0.8rem;';
        hsum.textContent = '▹ ヘッダー (' + Object.keys(e.headers).length + ')';
        hdet.appendChild(hsum);
        var hdl = el('dl', 'meta-grid');
        hdl.style.marginTop = '0.4rem';
        Object.keys(e.headers).forEach(function (k) {
          hdl.appendChild(el('dt', null, k));
          hdl.appendChild(el('dd', null, e.headers[k]));
        });
        hdet.appendChild(hdl);
        detailEl.appendChild(hdet);
      }

      // プロンプト
      var msgs = requestToMessages(e.request);
      detailEl.appendChild(detailH2('プロンプト'));
      if (msgs.length === 0) {
        detailEl.appendChild(el('div', 'placeholder', '(メッセージなし)'));
      } else {
        msgs.forEach(function (m) { addMessage(detailEl, m.role, m.text); });
      }

      // レスポンス
      if (e.error) {
        detailEl.appendChild(detailH2('エラー'));
        detailEl.appendChild(el('div', 'err-box', e.error));
      } else if (e.response) {
        detailEl.appendChild(detailH2('レスポンス'));
        if (e.response.text) addMessage(detailEl, 'assistant', e.response.text);
        if (e.response.toolCalls && e.response.toolCalls.length) {
          e.response.toolCalls.forEach(function (tc) {
            addMessage(detailEl, 'assistant', '[tool] ' + tc.name + '(' + (tc.arguments || '') + ')');
          });
        }
        if (!e.response.text && !(e.response.toolCalls && e.response.toolCalls.length)) {
          detailEl.appendChild(el('div', 'placeholder', '(本文なし)'));
        }
      }

      // 生 JSON
      var det = el('details');
      var dsum = el('summary', null, null);
      dsum.style.cssText = 'font-size:0.65rem;font-weight:bold;text-transform:uppercase;letter-spacing:0.07em;color:#7880a0;margin-top:0.8rem;display:block;';
      dsum.textContent = '▹ リクエスト JSON';
      det.appendChild(dsum);
      var pre1 = el('pre', null, JSON.stringify(e.request, null, 2));
      pre1.style.cssText = 'margin-top:0.4rem;background:#252540;border:1px solid #44446a;padding:0.6rem 0.8rem;overflow-x:auto;font-family:"DotGothic16",monospace;font-size:0.72rem;line-height:1.6;max-height:24rem;overflow-y:auto;color:#c8cce0;';
      det.appendChild(pre1);
      detailEl.appendChild(det);

      if (e.response) {
        var det2 = el('details');
        var dsum2 = el('summary', null, null);
        dsum2.style.cssText = 'font-size:0.65rem;font-weight:bold;text-transform:uppercase;letter-spacing:0.07em;color:#7880a0;margin-top:0.8rem;display:block;';
        dsum2.textContent = '▹ レスポンス JSON';
        det2.appendChild(dsum2);
        var pre2 = el('pre', null, JSON.stringify(e.response, null, 2));
        pre2.style.cssText = 'margin-top:0.4rem;background:#252540;border:1px solid #44446a;padding:0.6rem 0.8rem;overflow-x:auto;font-family:"DotGothic16",monospace;font-size:0.72rem;line-height:1.6;max-height:24rem;overflow-y:auto;color:#c8cce0;';
        det2.appendChild(pre2);
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
        var addCell = function (node) {
          var td = el('td', 'px-2 py-1 border-b border-px-bdr/30');
          td.appendChild(node);
          tr.appendChild(td);
        };
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
