// ==UserScript==
// @name         批量报名流量增长
// @namespace    https://github.com/Frank-jpeg/scriptcat-temu-noexe
// @version      3.3.0
// @description  TEMU 卖家中心「流量增长」批量报名（两步式全屏面板）：点「开始获取数据」只读扫描全店 SKU 并自动补上商品类目 → 顶部可按类目筛选，列表里一目了然哪些能被报名、哪些因价格太低/已报过名被跳过 → 确认无误再点「确认提交」才真正提交，提交范围严格限定在当前类目 + 已勾选。全程走接口，3 万 SKU 约 1 分钟
// @author       洋芋
// @match        https://agentseller.temu.com/main/flow-grow*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @noframes
// @homepageURL  https://github.com/Frank-jpeg/scriptcat-temu-noexe
// @supportURL   https://github.com/Frank-jpeg/scriptcat-temu-noexe/issues
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/%E6%89%B9%E9%87%8F%E6%8A%A5%E5%90%8D%E6%B5%81%E9%87%8F%E5%A2%9E%E9%95%BF.user.js
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/%E6%89%B9%E9%87%8F%E6%8A%A5%E5%90%8D%E6%B5%81%E9%87%8F%E5%A2%9E%E9%95%BF.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (window.__tfgV3) return;
  window.__tfgV3 = true;

  // ============ 配置 ============
  const CFG_KEY = 'tfg_v3_cfg';
  const DEFAULTS = {
    floor: 16,      // 普通底价：降价后 / 活动价都不得低于它
    highFrom: 20,   // 原价 ≥ 这个数的商品，用下面的高价底价
    highFloor: 19,
    maxSku: 0,      // 0 = 不限
    batch: 10,
    delay: 900
  };

  function loadCfg() {
    try {
      const raw = typeof GM_getValue === 'function'
        ? GM_getValue(CFG_KEY, '')
        : localStorage.getItem(CFG_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  const cfg = Object.assign({}, DEFAULTS, loadCfg());
  function saveCfg() {
    const raw = JSON.stringify(cfg);
    try {
      if (typeof GM_setValue === 'function') GM_setValue(CFG_KEY, raw);
      else localStorage.setItem(CFG_KEY, raw);
    } catch (e) { /* ignore */ }
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ============ 接口 ============
  const BASE = '/api/kiana/marvel-mms/cyborg/fully/increase/flow/';

  function getMallId() {
    const m = document.cookie.match(/(?:^|;\s*)mall_?id=(\d+)/i);
    if (m) return m[1];
    for (const k of Object.keys(localStorage)) {
      const v = localStorage.getItem(k) || '';
      const mm = v.match(/"mallId":(\d{8,})/);
      if (mm && /mall/i.test(k)) return mm[1];
    }
    return null;
  }

  async function api(path, body) {
    const mallid = getMallId();
    if (!mallid) throw new Error('读不到 mallid，请确认已登录卖家后台');
    const res = await fetch(BASE + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'mallid': mallid },
      body: JSON.stringify(body || {})
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) {
      throw new Error(path + ' 返回非 JSON：' + text.slice(0, 120));
    }
    if (!json.success && json.errorMsg) {
      throw new Error(path + ' 失败：' + (json.errorMsg || json.errorCode));
    }
    return json.result || {};
  }

  // 商品列表接口带完整类目树；流量增长那套接口一个类目字段都没有
  // 必须用 XHR：佳同跨境插件 hook 了 window.fetch，会把这类请求打崩
  const CAT_API = '/visage-agent-seller/product/skc/pageQuery';

  function xhrPost(path, body) {
    return new Promise((resolve, reject) => {
      const mallid = getMallId();
      const x = new XMLHttpRequest();
      x.open('POST', path, true);
      x.setRequestHeader('content-type', 'application/json');
      if (mallid) x.setRequestHeader('mallid', mallid);
      x.onreadystatechange = () => {
        if (x.readyState !== 4) return;
        if (x.status < 200 || x.status >= 300) return reject(new Error('HTTP ' + x.status));
        let j;
        try { j = JSON.parse(x.responseText || '{}'); } catch (e) { return reject(new Error('返回不是 JSON')); }
        if (!j.success) return reject(new Error(j.errorMsg || '接口报错'));
        resolve(j.result || {});
      };
      x.onerror = () => reject(new Error('网络错误'));
      x.send(JSON.stringify(body));
    });
  }

  // productId → { leaf, path }，一次最多 100 个 ID
  // 连发几十批时偶尔有批次抽风返回空，所以跑完一轮会把没拿到的 ID 补查两轮
  async function loadCatMap(pids, onProgress) {
    const map = new Map();

    const fetchBatch = async (ids) => {
      const res = await xhrPost(CAT_API, { pageSize: 1000, page: 1, productIds: ids });
      let got = 0;
      for (const it of (res.pageItems || [])) {
        const cs = it.categories || {};
        const names = [];
        for (let i = 1; i <= 10; i++) {
          const c = cs['cat' + i];
          if (c && c.catName) names.push(c.catName);
        }
        const leaf = (it.leafCat && it.leafCat.catName) || names[names.length - 1] || '';
        if (!leaf) continue;
        map.set(it.productId, { leaf, path: names.join(' > ') || leaf });
        got++;
      }
      return got;
    };

    const runPass = async (ids, conc, size, gap, retry) => {
      const chunks = [];
      for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
      let idx = 0, done = 0, hit = 0;
      const worker = async () => {
        while (idx < chunks.length) {
          const my = chunks[idx++];
          if (S.stop) return;
          try { hit += await fetchBatch(my); } catch (e) { /* 没拿到的留到补查轮 */ }
          done++;
          if (onProgress) onProgress({ done, total: chunks.length, retry, hit });
          if (gap) await sleep(gap);
        }
      };
      await Promise.all(Array.from({ length: Math.min(conc, chunks.length) }, worker));
      return hit;
    };

    // 一次问上千个商品会被平台软限流（返回成功但列表为空），所以放慢节奏
    await runPass(pids, 2, 100, 200, false);

    for (let round = 0; round < 2 && !S.stop; round++) {
      const miss = pids.filter(id => !map.has(id));
      if (!miss.length) break;
      if (onProgress) onProgress({ wait: true, miss: miss.length, round: round + 1 });
      await sleep(12000);
      if (S.stop) break;
      await runPass(miss, 1, 50, 400, true);
    }
    return map;
  }

  // ============ 状态 ============
  const ST = {
    ok:        { text: '可提交',   cls: 'ok' },
    submitted: { text: '已报名',   cls: 'sub' },
    pending:   { text: '待确认',   cls: 'pend' },
    floor:     { text: '价格太低', cls: 'warn' },
    done:      { text: '已报过名', cls: 'muted' },
    none:      { text: '无降价档', cls: 'muted' },
    fail:      { text: '提交失败', cls: 'err' }
  };

  const S = {
    phase: 'idle',    // idle | scanning | ready | submitting | done
    rows: [],
    filter: 'all',
    cat: 'all',
    catMap: null,
    catBusy: false,
    q: '',
    page: 0,
    pages: 0,
    scanned: 0,
    stop: false,
    shop: null,
    tip: ''
  };

  const yuan = (fen) => (fen == null ? '—' : (fen / 100).toFixed(2));
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // ============ 样式 ============
  const CSS = `
  #tfg-root{position:fixed;inset:0;z-index:2147483000;pointer-events:none}
  #tfg-root *{box-sizing:border-box}

  /* 收起后的小胶囊 */
  .tfg-fab{position:fixed;right:20px;bottom:20px;pointer-events:auto;display:none;
    align-items:center;gap:8px;padding:10px 18px;border-radius:999px;cursor:pointer;
    background:#0071e3;color:#fff;font:600 13px/1 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
    box-shadow:0 6px 22px rgba(0,113,227,.4);transition:transform .15s}
  .tfg-fab:hover{transform:translateY(-2px)}
  .tfg-fab b{font-weight:700}

  .tfg-mask{position:fixed;inset:0;pointer-events:auto;display:none;
    background:rgba(20,20,24,.42);backdrop-filter:blur(3px);
    align-items:center;justify-content:center;
    font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
    color:#1d1d1f;-webkit-font-smoothing:antialiased}
  .tfg-mask.on{display:flex}
  .tfg-panel{position:relative;width:calc(100vw - 40px);height:calc(100vh - 40px);max-width:1680px;
    display:flex;flex-direction:column;background:#fff;border-radius:18px;overflow:hidden;
    box-shadow:0 24px 80px rgba(0,0,0,.34),0 0 0 1px rgba(0,0,0,.05)}

  /* 头部 */
  .tfg-head{flex:0 0 auto;display:flex;align-items:center;gap:14px;padding:16px 24px;
    border-bottom:1px solid #ececf0;background:#fff}
  .tfg-logo{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#0071e3,#34c759);
    display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;flex:0 0 auto}
  .tfg-h1{font-size:17px;font-weight:600;letter-spacing:.2px}
  .tfg-h1 i{font-style:normal;font-weight:400;color:#86868b;font-size:13px;margin-left:8px}
  .tfg-head .tfg-shop{margin-left:auto;font-size:12.5px;color:#86868b;display:flex;gap:14px}
  .tfg-shop b{color:#1d1d1f;font-weight:600}
  .tfg-x{border:0;background:#f5f5f7;color:#86868b;width:32px;height:32px;border-radius:9px;
    cursor:pointer;font-size:18px;line-height:1;flex:0 0 auto}
  .tfg-x:hover{background:#e8e8ed;color:#1d1d1f}

  /* 参数行 */
  .tfg-cfg{flex:0 0 auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
    padding:12px 24px;background:#fafafc;border-bottom:1px solid #ececf0;font-size:13px;color:#3c3c43}
  .tfg-cfg label{display:flex;align-items:center;gap:6px}
  .tfg-cfg input[type=number]{width:78px;padding:6px 9px;border:1px solid #d8d8de;border-radius:8px;
    background:#fff;font:inherit;font-weight:600;text-align:right;outline:none;color:#1d1d1f}
  .tfg-cfg input[type=number]:focus{border-color:#0071e3;box-shadow:0 0 0 3px rgba(0,113,227,.14)}
  .tfg-cfg .tfg-sep{width:1px;height:18px;background:#e0e0e6;margin:0 4px}
  .tfg-link{margin-left:auto;font-size:12.5px;color:#0071e3;cursor:pointer;user-select:none}
  .tfg-adv{display:none;flex-basis:100%;gap:10px;align-items:center;padding-top:4px}
  .tfg-adv.on{display:flex}

  /* 统计卡 */
  .tfg-stats{flex:0 0 auto;display:flex;gap:10px;padding:14px 24px 6px}
  .tfg-card{flex:1;min-width:0;border:1px solid #e6e6ec;border-radius:12px;padding:10px 14px;
    background:#fff;cursor:pointer;transition:border-color .12s,background .12s}
  .tfg-card:hover{border-color:#c9c9d1}
  .tfg-card.on{border-color:#0071e3;background:#f2f8ff;box-shadow:0 0 0 1px #0071e3 inset}
  .tfg-card .n{font-size:26px;font-weight:600;line-height:1.15;letter-spacing:-.5px}
  .tfg-card .l{font-size:12px;color:#86868b;margin-top:2px}
  .tfg-card.ok .n{color:#1a7f37}
  .tfg-card.sub .n{color:#0071e3}
  .tfg-card.warn .n{color:#ff9500}
  .tfg-card.pend .n{color:#b26a00}
  .tfg-card.muted .n{color:#86868b}

  /* 筛选条 */
  .tfg-bar{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 24px 10px}
  .tfg-chip{padding:6px 13px;border-radius:999px;border:1px solid #e0e0e6;background:#fff;
    font-size:12.5px;color:#3c3c43;cursor:pointer;user-select:none}
  .tfg-chip:hover{background:#f5f5f7}
  .tfg-chip.on{background:#1d1d1f;border-color:#1d1d1f;color:#fff}
  .tfg-chip b{margin-left:5px;font-weight:600;opacity:.75}
  .tfg-search{margin-left:auto;position:relative}
  .tfg-search input{width:250px;padding:7px 12px 7px 30px;border:1px solid #e0e0e6;border-radius:999px;
    font:inherit;font-size:12.5px;outline:none;background:#fafafc}
  .tfg-search input:focus{border-color:#0071e3;background:#fff;box-shadow:0 0 0 3px rgba(0,113,227,.12)}
  .tfg-search svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);width:13px;height:13px;opacity:.4}

  /* 类目条 */
  .tfg-catbar{flex:0 0 auto;display:flex;align-items:center;gap:7px;padding:0 24px 10px;
    overflow-x:auto;overflow-y:hidden;white-space:nowrap}
  .tfg-catbar::-webkit-scrollbar{height:0}
  .tfg-catbar .lb{font-size:12px;color:#a1a1a6;flex:0 0 auto;margin-right:1px}
  .tfg-cc{padding:5px 12px;border-radius:8px;border:1px solid #e0e0e6;background:#fff;
    font-size:12.5px;color:#3c3c43;cursor:pointer;user-select:none;flex:0 0 auto;
    transition:background .12s,border-color .12s,color .12s}
  .tfg-cc:hover{background:#f5f5f7}
  .tfg-cc.on{background:#0071e3;border-color:#0071e3;color:#fff}
  .tfg-cc b{margin-left:5px;font-weight:600;opacity:.65}
  .tfg-cc.on b{opacity:.85}

  /* 提交确认层 */
  .tfg-cf{position:absolute;inset:0;display:none;align-items:center;justify-content:center;
    background:rgba(20,20,24,.4);backdrop-filter:blur(2px);z-index:6}
  .tfg-cf.on{display:flex}
  .tfg-cfbox{width:460px;max-width:calc(100% - 60px);background:#fff;border-radius:16px;padding:24px;
    box-shadow:0 20px 60px rgba(0,0,0,.3);font-size:13px}
  .tfg-cfbox h3{margin:0 0 14px;font-size:17px;font-weight:600;color:#1d1d1f}
  .tfg-cfrow{display:flex;justify-content:space-between;gap:20px;padding:9px 0;
    border-bottom:1px solid #f2f2f5}
  .tfg-cfrow:last-of-type{border-bottom:0}
  .tfg-cfrow span{color:#86868b;flex:0 0 auto}
  .tfg-cfrow b{color:#1d1d1f;font-weight:600;text-align:right;word-break:break-all}
  .tfg-cfwarn{margin-top:12px;padding:10px 12px;border-radius:10px;background:#fff8e6;
    color:#a05a00;font-size:12.5px;line-height:1.65}
  .tfg-cfact{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}

  /* 表格 */
  .tfg-thead{flex:0 0 auto;display:grid;grid-template-columns:38px 52px minmax(0,1fr) 140px 80px 84px 84px 104px;
    align-items:center;gap:0;padding:0 24px;height:34px;background:#fafafc;
    border-top:1px solid #ececf0;border-bottom:1px solid #ececf0;font-size:12px;color:#86868b}
  .tfg-list{flex:1 1 auto;overflow-y:auto;overflow-x:hidden;position:relative;background:#fff}
  .tfg-sizer{position:relative;width:100%}
  .tfg-view{position:absolute;top:0;left:0;right:0;will-change:transform}
  .tfg-tr{display:grid;grid-template-columns:38px 52px minmax(0,1fr) 140px 80px 84px 84px 104px;
    align-items:center;padding:0 24px;height:64px;border-bottom:1px solid #f2f2f5;font-size:13px}
  .tfg-tr:hover{background:#fafafc}
  .tfg-td{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tfg-chk input{width:16px;height:16px;accent-color:#0071e3;cursor:pointer}
  .tfg-chk input:disabled{cursor:default;opacity:.35}
  .tfg-pic img{width:44px;height:44px;border-radius:8px;object-fit:cover;background:#f0f0f3;display:block}
  .tfg-name{line-height:1.3;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;
    -webkit-box-orient:vertical;padding-right:14px;font-size:13px;color:#1d1d1f}
  .tfg-name i{display:block;font-style:normal;font-size:11px;color:#a1a1a6;margin-top:1px}
  .tfg-spec{font-size:12px;color:#6e6e73}
  .tfg-num{text-align:right;font-variant-numeric:tabular-nums;color:#6e6e73;padding-right:6px}
  .tfg-num.strong{color:#1d1d1f;font-weight:600}
  .tfg-jd{text-align:center}
  .tfg-tag{display:inline-block;padding:3px 9px;border-radius:6px;font-size:11.5px;font-weight:500}
  .tfg-tag.ok{background:#e7f7ec;color:#1a7f37}
  .tfg-tag.sub{background:#e6f1fd;color:#0066cc}
  .tfg-tag.warn{background:#fff5e5;color:#c26a00}
  .tfg-tag.pend{background:#fff2dc;color:#b26a00}
  .tfg-tag.muted{background:#f2f2f5;color:#86868b}
  .tfg-tag.err{background:#fdeceb;color:#c1272d}
  .tfg-empty{padding:70px 24px;text-align:center;color:#a1a1a6;font-size:13.5px;line-height:2}

  /* 底部 */
  .tfg-foot{flex:0 0 auto;display:flex;align-items:center;gap:16px;padding:14px 24px;
    border-top:1px solid #ececf0;background:#fafafc}
  .tfg-prog{flex:1;min-width:0}
  .tfg-prog .txt{font-size:12.5px;color:#6e6e73;margin-bottom:6px;min-height:18px}
  .tfg-prog .txt b{color:#1d1d1f}
  .tfg-prog .bar{height:6px;border-radius:3px;background:#e8e8ed;overflow:hidden}
  .tfg-prog .bar>i{display:block;height:100%;width:0;border-radius:3px;
    background:linear-gradient(90deg,#0071e3,#34c759);transition:width .25s}
  .tfg-act{display:flex;align-items:center;gap:10px;flex:0 0 auto}
  .tfg-btn{border:1px solid #d8d8de;background:#fff;color:#1d1d1f;padding:11px 20px;border-radius:11px;
    font:600 14px/1 inherit;cursor:pointer;white-space:nowrap}
  .tfg-btn:hover{background:#f5f5f7}
  .tfg-btn.primary{background:#0071e3;border-color:#0071e3;color:#fff;padding:11px 26px}
  .tfg-btn.primary:hover{background:#0062c4}
  .tfg-btn.green{background:#34c759;border-color:#34c759;color:#fff;padding:11px 26px}
  .tfg-btn.green:hover{background:#2bb14e}
  .tfg-btn:disabled{opacity:.4;cursor:default}
  .tfg-btn.ghost{color:#86868b}

  /* 提示条 */
  .tfg-toast{position:fixed;left:50%;top:26px;transform:translateX(-50%) translateY(-12px);
    pointer-events:none;opacity:0;transition:.2s;padding:10px 20px;border-radius:10px;
    background:rgba(29,29,31,.92);color:#fff;font-size:13px;z-index:2147483001;max-width:70vw}
  .tfg-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}
  `;

  // ============ DOM ============
  let root, mask, listEl, sizerEl, viewEl, statsEl, chipsEl, footTxtEl, barEl, btnMain, btnSub, cfgBar;
  let catBarEl, cfEl, cfBodyEl, cfYes, cfNo;

  function h(html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  }

  function build() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    root = h('<div id="tfg-root"></div>');
    root.appendChild(h('<div class="tfg-fab" id="tfg-fab">🌱 流量增长批量报名 <b id="tfg-fab-n"></b></div>'));
    mask = h(`<div class="tfg-mask" id="tfg-mask"><div class="tfg-panel">
      <div class="tfg-head">
        <div class="tfg-logo">🌱</div>
        <div class="tfg-h1">流量增长 · 批量报名<i>接口版 v3.3.0</i></div>
        <div class="tfg-shop" id="tfg-shop"></div>
        <button class="tfg-x" id="tfg-x" title="收起">×</button>
      </div>
      <div class="tfg-cfg" id="tfg-cfg">
        <label>底价 <input id="tfg-floor" type="number" step="0.01"> 元</label>
        <span class="tfg-sep"></span>
        <label>原价 ≥ <input id="tfg-highfrom" type="number" step="0.01"> 元的商品，底价用 <input id="tfg-highfloor" type="number" step="0.01"> 元</label>
        <span class="tfg-link" id="tfg-adv-toggle">高级 ▾</span>
        <div class="tfg-adv" id="tfg-adv">
          <label>最多报 <input id="tfg-maxsku" type="number" min="0" step="1"> 个 SKU（0=不限）</label>
          <span class="tfg-sep"></span>
          <label>每批 <input id="tfg-batch" type="number" min="1" step="1"> 个，间隔 <input id="tfg-delay" type="number" min="200" step="100"> ms</label>
        </div>
      </div>
      <div class="tfg-stats" id="tfg-stats"></div>
      <div class="tfg-bar">
        <div id="tfg-chips" style="display:flex;gap:8px"></div>
        <div class="tfg-search">
          <svg viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="#1d1d1f" stroke-width="1.6"/><path d="M11 11l3.5 3.5" stroke="#1d1d1f" stroke-width="1.6" stroke-linecap="round"/></svg>
          <input id="tfg-q" placeholder="搜索商品名 / 商品ID / SKU ID">
        </div>
      </div>
      <div class="tfg-catbar" id="tfg-catbar" style="display:none"></div>
      <div class="tfg-thead">
        <div></div><div></div><div>商品</div><div>规格</div>
        <div style="text-align:right;padding-right:6px">现价</div>
        <div style="text-align:right;padding-right:6px">降价后</div>
        <div style="text-align:right;padding-right:6px">活动价</div>
        <div style="text-align:center">判定</div>
      </div>
      <div class="tfg-list" id="tfg-list"><div class="tfg-sizer" id="tfg-sizer"><div class="tfg-view" id="tfg-view"></div></div></div>
      <div class="tfg-foot">
        <div class="tfg-prog">
          <div class="txt" id="tfg-ftxt">点「开始获取数据」扫描全店商品，这一步只读取、不会提交任何东西。</div>
          <div class="bar"><i id="tfg-bar"></i></div>
        </div>
        <div class="tfg-act">
          <button class="tfg-btn ghost" id="tfg-sub" style="display:none">停止</button>
          <button class="tfg-btn primary" id="tfg-main">开始获取数据</button>
        </div>
      </div>
      <div class="tfg-cf" id="tfg-cf"><div class="tfg-cfbox">
        <h3>确认提交</h3>
        <div id="tfg-cfbody"></div>
        <div class="tfg-cfact">
          <button class="tfg-btn ghost" id="tfg-cfno">取消</button>
          <button class="tfg-btn green" id="tfg-cfyes">确认提交</button>
        </div>
      </div></div>
    </div></div>`);
    root.appendChild(mask);
    root.appendChild(h('<div class="tfg-toast" id="tfg-toast"></div>'));
    document.body.appendChild(root);

    listEl = root.querySelector('#tfg-list');
    sizerEl = root.querySelector('#tfg-sizer');
    viewEl = root.querySelector('#tfg-view');
    statsEl = root.querySelector('#tfg-stats');
    chipsEl = root.querySelector('#tfg-chips');
    footTxtEl = root.querySelector('#tfg-ftxt');
    barEl = root.querySelector('#tfg-bar');
    btnMain = root.querySelector('#tfg-main');
    btnSub = root.querySelector('#tfg-sub');
    cfgBar = root.querySelector('#tfg-cfg');
    catBarEl = root.querySelector('#tfg-catbar');
    cfEl = root.querySelector('#tfg-cf');
    cfBodyEl = root.querySelector('#tfg-cfbody');
    cfYes = root.querySelector('#tfg-cfyes');
    cfNo = root.querySelector('#tfg-cfno');

    root.querySelector('#tfg-floor').value = cfg.floor;
    root.querySelector('#tfg-highfrom').value = cfg.highFrom;
    root.querySelector('#tfg-highfloor').value = cfg.highFloor;
    root.querySelector('#tfg-maxsku').value = cfg.maxSku;
    root.querySelector('#tfg-batch').value = cfg.batch;
    root.querySelector('#tfg-delay').value = cfg.delay;

    root.querySelector('#tfg-x').addEventListener('click', close);
    root.querySelector('#tfg-fab').addEventListener('click', open);
    root.querySelector('#tfg-adv-toggle').addEventListener('click', (e) => {
      const adv = root.querySelector('#tfg-adv');
      adv.classList.toggle('on');
      e.target.textContent = adv.classList.contains('on') ? '高级 ▴' : '高级 ▾';
    });

    listEl.addEventListener('scroll', () => renderRows(true), { passive: true });
    window.addEventListener('resize', () => renderRows(true));

    listEl.addEventListener('change', (e) => {
      const cb = e.target.closest('input[data-chk]');
      if (!cb) return;
      const sku = Number(cb.getAttribute('data-chk'));
      const r = S.rows.find(x => x.skuId === sku);
      if (r) r.picked = cb.checked;
      renderFoot();
    });

    ['floor', 'highfrom', 'highfloor', 'maxsku', 'batch', 'delay'].forEach(id => {
      root.querySelector('#tfg-' + id).addEventListener('change', readCfg);
    });

    root.querySelector('#tfg-q').addEventListener('input', (e) => {
      S.q = e.target.value; invalidate(); listEl.scrollTop = 0; renderRows();
    });

    statsEl.addEventListener('click', (e) => {
      const c = e.target.closest('.tfg-card');
      if (!c) return;
      S.filter = c.getAttribute('data-f');
      invalidate(); listEl.scrollTop = 0; renderStats(); renderRows();
    });
    chipsEl.addEventListener('click', (e) => {
      const c = e.target.closest('.tfg-chip');
      if (!c) return;
      S.filter = c.getAttribute('data-f');
      invalidate(); listEl.scrollTop = 0; renderStats(); renderRows();
    });

    catBarEl.addEventListener('click', (e) => {
      const c = e.target.closest('.tfg-cc');
      if (!c) return;
      if (S.phase === 'submitting') { toast('提交中，先别切类目'); return; }
      S.cat = c.getAttribute('data-c');
      invalidate(); listEl.scrollTop = 0; renderStats(); renderRows(); renderFoot();
    });

    cfYes.addEventListener('click', () => {
      cfEl.classList.remove('on');
      const f = cfResolve; cfResolve = null;
      if (f) f(true);
    });
    cfNo.addEventListener('click', () => {
      cfEl.classList.remove('on');
      const f = cfResolve; cfResolve = null;
      if (f) f(false);
    });

    btnMain.addEventListener('click', onMain);
    btnSub.addEventListener('click', () => {
      if (S.phase === 'scanning' || S.phase === 'submitting') {
        S.stop = true;
        footText('正在停止…', '');
      } else {
        scan();
      }
    });

    renderStats();
    renderRows();
    renderFoot();
  }

  function readCfg() {
    const val = (id, d) => {
      const v = parseFloat(root.querySelector('#tfg-' + id).value);
      return isNaN(v) ? d : v;
    };
    cfg.floor = val('floor', DEFAULTS.floor);
    cfg.highFrom = val('highfrom', DEFAULTS.highFrom);
    cfg.highFloor = val('highfloor', DEFAULTS.highFloor);
    cfg.maxSku = Math.max(0, Math.round(val('maxsku', DEFAULTS.maxSku)));
    cfg.batch = Math.max(1, Math.round(val('batch', DEFAULTS.batch)));
    cfg.delay = Math.max(200, Math.round(val('delay', DEFAULTS.delay)));
    saveCfg();
    rejudge();
  }

  function open() {
    mask.classList.add('on');
    root.querySelector('#tfg-fab').style.display = 'none';
    renderRows();
  }
  function close() {
    mask.classList.remove('on');
    const fab = root.querySelector('#tfg-fab');
    fab.style.display = 'flex';
    const n = S.rows.filter(r => r.status === 'ok' && r.picked).length;
    root.querySelector('#tfg-fab-n').textContent = n ? n + ' 个待提交' : '';
  }

  let toastTimer;
  function toast(msg) {
    const t = root.querySelector('#tfg-toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 3200);
  }

  // ============ 统计 / 列表 ============
  // 当前类目筛选范围内的行；提交也只看这个范围
  function catRows() {
    if (!S.cat || S.cat === 'all') return S.rows;
    const t = S.cat;
    return S.rows.filter(r => (r.cat || '未知') === t);
  }

  // 改了底价就地重算，不用重新拉 3 万个 SKU
  function rejudge() {
    if (S.phase !== 'ready') return;
    for (const r of S.rows) {
      if (!r._p || !r._s) continue;
      const cat = r.cat, catPath = r.catPath;
      Object.assign(r, judge(r._p, r._s, r.name, r.pic));
      r.cat = cat;
      r.catPath = catPath;
    }
    invalidate();
    renderStats(); renderRows(); renderFoot();
  }

  let catBarHtml = '';
  function renderCatBar() {
    if (!catBarEl) return;
    if (!S.catMap || !S.rows.length) { catBarEl.style.display = 'none'; return; }
    const cnt = {};
    for (const r of S.rows) {
      const k = r.cat || '未知';
      cnt[k] = (cnt[k] || 0) + 1;
    }
    const list = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
    if (list.length < 2) { catBarEl.style.display = 'none'; return; }
    catBarEl.style.display = 'flex';
    const cell = (k, label, n) =>
      `<div class="tfg-cc${S.cat === k ? ' on' : ''}" data-c="${esc(k)}">${esc(label)}<b>${n}</b></div>`;
    const html = '<span class="lb">类目</span>' +
      cell('all', '全部', S.rows.length) +
      list.map(([k, n]) => cell(k, k.length > 16 ? k.slice(0, 16) + '…' : k, n)).join('');
    if (html === catBarHtml) return;
    catBarHtml = html;
    const sl = catBarEl.scrollLeft;
    catBarEl.innerHTML = html;
    catBarEl.scrollLeft = sl;
  }

  function countBy() {
    const c = {};
    for (const r of catRows()) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }

  function renderStats() {
    const scoped = catRows();
    const c = countBy();
    const other = (c.none || 0) + (c.fail || 0);
    const card = (n, label, cls, f) =>
      `<div class="tfg-card ${cls}${S.filter === f ? ' on' : ''}" data-f="${f}">
         <div class="n">${n}</div><div class="l">${label}</div></div>`;
    statsEl.innerHTML =
      card(scoped.length, '扫到的 SKU', '', 'all') +
      card(c.ok || 0, '可以提交', 'ok', 'ok') +
      card(c.submitted || 0, '已报名成功', 'sub', 'submitted') +
      card(c.pending || 0, '待确认', 'pend', 'pending') +
      card(c.floor || 0, '价格太低', 'warn', 'floor') +
      card(c.done || 0, '已报过名', 'muted', 'done') +
      card(other, '其他不可报', 'muted', 'other');

    const chips = [
      ['all', '全部', scoped.length],
      ['ok', '可提交', c.ok || 0],
      ['submitted', '已报名', c.submitted || 0],
      ['pending', '待确认', c.pending || 0],
      ['floor', '价格太低', c.floor || 0],
      ['done', '已报过名', c.done || 0],
      ['other', '其他', other]
    ];
    chipsEl.innerHTML = chips.map(([f, t, n]) =>
      `<div class="tfg-chip${S.filter === f ? ' on' : ''}" data-f="${f}">${t}<b>${n}</b></div>`).join('');
    renderCatBar();
  }

  let cache = null;
  function invalidate() { cache = null; }

  function visibleRows() {
    if (cache) return cache;
    const q = S.q.trim().toLowerCase();
    cache = catRows().filter(r => {
      if (S.filter === 'ok' && r.status !== 'ok') return false;
      if (S.filter === 'submitted' && r.status !== 'submitted') return false;
      if (S.filter === 'pending' && r.status !== 'pending') return false;
      if (S.filter === 'floor' && r.status !== 'floor') return false;
      if (S.filter === 'done' && r.status !== 'done') return false;
      if (S.filter === 'other' && r.status !== 'none' && r.status !== 'fail') return false;
      if (q) {
        const hay = (r.name + ' ' + r.pid + ' ' + r.skuId + ' ' + r.spec).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    return cache;
  }

  const ROW_H = 64;

  function rowHtml(r) {
    const st = ST[r.status];
    return `<div class="tfg-tr" data-sku="${r.skuId}">
      <div class="tfg-td tfg-chk"><input type="checkbox" data-chk="${r.skuId}"${r.picked ? ' checked' : ''}${r.status === 'ok' ? '' : ' disabled'}></div>
      <div class="tfg-td tfg-pic">${r.pic ? `<img src="${esc(r.pic)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ''}</div>
      <div class="tfg-td tfg-name">${esc(r.name)}<i>${r.pid}</i></div>
      <div class="tfg-td tfg-spec" title="${esc(r.spec)}">${esc(r.spec) || '—'}</div>
      <div class="tfg-td tfg-num">${yuan(r.curFen)}</div>
      <div class="tfg-td tfg-num strong">${yuan(r.afterFen)}</div>
      <div class="tfg-td tfg-num">${yuan(r.actFen)}</div>
      <div class="tfg-td tfg-jd"><span class="tfg-tag ${st.cls}" title="${esc(r.reason || '')}">${st.text}</span></div>
    </div>`;
  }

  function renderRows() {
    if (!listEl) return;
    const rows = visibleRows();
    sizerEl.style.height = (rows.length * ROW_H) + 'px';

    if (!rows.length) {
      viewEl.style.transform = 'translateY(0)';
      viewEl.innerHTML = `<div class="tfg-empty">${emptyText()}</div>`;
      return;
    }

    const top = listEl.scrollTop;
    const hgt = listEl.clientHeight || 500;
    let start = Math.floor(top / ROW_H) - 4;
    if (start < 0) start = 0;
    let end = Math.ceil((top + hgt) / ROW_H) + 4;
    if (end > rows.length) end = rows.length;

    viewEl.style.transform = 'translateY(' + (start * ROW_H) + 'px)';
    let html = '';
    for (let i = start; i < end; i++) html += rowHtml(rows[i]);
    viewEl.innerHTML = html;
  }

  function emptyText() {
    if (S.phase === 'scanning') return '正在获取数据，请稍候…';
    if (!S.rows.length) return '还没有数据<br>点底部「开始获取数据」，先把全店商品扫一遍';
    if (S.q) return '没有匹配「' + esc(S.q) + '」的商品';
    if (S.filter === 'ok') return '这一类里没有商品';
    return '这一类里没有商品';
  }

  function footText(main, sub) {
    footTxtEl.innerHTML = main + (sub ? ` <span style="color:#a1a1a6">${sub}</span>` : '');
  }
  function setBar(pct) {
    barEl.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  function renderFoot() {
    if (!btnMain) return;
    const scoped = catRows();
    const pick = scoped.filter(r => r.status === 'ok' && r.picked).length;
    const allOk = scoped.filter(r => r.status === 'ok').length;
    const outside = S.rows.filter(r => r.status === 'ok' && r.picked).length - pick;

    if (S.phase === 'scanning') {
      btnMain.textContent = '获取中…';
      btnMain.disabled = true;
      btnSub.style.display = '';
      btnSub.textContent = '停止';
      return;
    }
    if (S.phase === 'submitting') {
      btnMain.textContent = '提交中…';
      btnMain.disabled = true;
      btnSub.style.display = '';
      btnSub.textContent = '停止';
      return;
    }
    btnSub.style.display = 'none';

    if (S.phase === 'ready' || S.phase === 'done') {
      btnSub.style.display = '';
      btnSub.textContent = '重新获取';
      btnMain.className = 'tfg-btn green';
      btnMain.disabled = pick === 0;
      const tag = S.cat === 'all' ? '' : ' · ' + (S.cat.length > 9 ? S.cat.slice(0, 9) + '…' : S.cat);
      btnMain.textContent = pick ? `确认提交 ${pick} 个${tag}` : '没有可提交的';
      const catName = S.cat === 'all' ? '全部' : esc(S.cat);
      footText(
        `已扫 <b>${S.rows.length}</b> 个 SKU，当前类目「<b>${catName}</b>」里 <b>${allOk}</b> 个符合底价、已选 <b>${pick}</b> 个。`,
        outside > 0
          ? `<span style="color:#c26a00;font-weight:500">另有 ${outside} 个勾选项不在当前类目，本次不会提交</span>`
          : '只提交当前类目里勾选的，确认后才会真正提交。'
      );
      return;
    }
    btnMain.className = 'tfg-btn primary';
    btnMain.disabled = false;
    btnMain.textContent = S.rows.length ? '重新获取数据' : '开始获取数据';
  }

  // ============ 扫描 ============
  async function scan() {
    S.phase = 'scanning';
    S.stop = false;
    S.rows = [];
    S.q = '';
    root.querySelector('#tfg-q').value = '';
    S.filter = 'all';
    S.cat = 'all';
    S.catMap = null;
    catBarHtml = '';
    if (catBarEl) catBarEl.style.display = 'none';
    invalidate();
    renderStats(); renderRows(); renderFoot();
    setBar(2);
    footText('正在读取店铺概况…', '');

    try {
      const cnt = await api('count', {});
      S.shop = cnt;
      root.querySelector('#tfg-shop').innerHTML =
        `待增长 <b>${cnt.nonReviewedNum ?? '—'}</b> · 长期增长 <b>${cnt.foreverNum ?? '—'}</b> · 商品 <b>${cnt.total ?? '—'}</b>`;
    } catch (e) {
      toast('读取店铺概况失败：' + e.message);
    }

    const pageSize = 100;
    const CONC = 4;                    // 同时拉几页
    const seen = new Set();
    const rows = [];
    const buf = new Map();
    let totalPages = 0;
    let nextRender = 1;
    let nextFetch = 1;
    let failPages = 0;

    const parsePage = (products) => {
      for (const p of products) {
        const name = p.productName || ('商品 ' + p.productId);
        const pic = (p.pics && p.pics[0]) || '';
        for (const s of (p.skcOrSkus || [])) {
          const skuId = s.productSkcOrSkuId;
          if (seen.has(skuId)) continue;
          seen.add(skuId);
          rows.push(judge(p, s, name, pic));
        }
      }
    };

    const flush = () => {
      let moved = false;
      while (buf.has(nextRender)) {
        parsePage(buf.get(nextRender));
        buf.delete(nextRender);
        nextRender++;
        moved = true;
      }
      if (!moved) return;
      S.rows = rows;
      S.scanned = rows.length;
      invalidate();
      renderStats();
      renderRows();
      setBar(totalPages ? Math.min(99, ((nextRender - 1) / totalPages) * 100) : 10);
      footText(`正在获取数据：<b>${nextRender - 1}</b>/${totalPages || '?'} 页，已扫 <b>${rows.length}</b> 个 SKU`,
        `其中符合底价条件 ${rows.filter(r => r.status === 'ok').length} 个`);
    };

    let first = null;
    try {
      first = await api('pageQuery', { pageInfo: { pageNo: 1, pageSize } });
    } catch (e) {
      toast('读取第 1 页失败：' + e.message);
    }

    if (first) {
      const firstProducts = first.products || [];
      totalPages = Math.max(1, Math.ceil((first.total || firstProducts.length) / pageSize));
      buf.set(1, firstProducts);
      nextFetch = 2;
      flush();

      const worker = async () => {
        while (!S.stop) {
          const pg = nextFetch++;
          if (pg > totalPages) return;
          try {
            const res = await api('pageQuery', { pageInfo: { pageNo: pg, pageSize } });
            buf.set(pg, res.products || []);
          } catch (e) {
            failPages++;
            buf.set(pg, []);
          }
          flush();
        }
      };

      await Promise.all(Array.from({ length: Math.min(CONC, totalPages) }, worker));

      for (let q = nextRender; q <= totalPages; q++) {
        if (buf.has(q)) parsePage(buf.get(q));
        buf.delete(q);
      }
      if (failPages) toast(failPages + ' 页没读到，已跳过');
    }

    // 补类目：流量增长那套接口没有类目字段，去商品列表接口按 productId 反查
    if (!S.stop && rows.length) {
      const pids = [];
      const seenPid = new Set();
      for (const r of rows) {
        if (!seenPid.has(r.pid)) { seenPid.add(r.pid); pids.push(r.pid); }
      }
      footText(`正在读取类目：<b>${pids.length}</b> 个商品…`, '');
      try {
        const map = await loadCatMap(pids, (p) => {
          if (p.wait) {
            footText(`类目还差 <b>${p.miss}</b> 个商品，等平台限流恢复后自动补查（第 ${p.round} 轮）…`, '');
            return;
          }
          if (p.retry) {
            footText(`补查类目：第 <b>${p.done}</b>/${p.total} 批，本轮到目前补到 <b>${p.hit}</b> 个…`, '');
          } else {
            footText(`正在读取类目：第 <b>${p.done}</b>/${p.total} 批，已拿到 <b>${p.hit}</b>/${pids.length} 个商品…`, '');
            setBar(95 + (p.done / p.total) * 4);
          }
        });
        S.catMap = map;
        for (const r of rows) {
          const c = map.get(r.pid);
          r.cat = c ? c.leaf : '未知';
          r.catPath = c ? c.path : '';
        }
        if (map.size < pids.length) {
          toast((pids.length - map.size) + ' 个商品没拿到类目（平台限流或已下架），归到「未知」了');
        }
      } catch (e) {
        toast('读取类目失败：' + e.message);
      }
    }

    // 扫描过程中可能有人改了底价，统一按当前配置重算一遍
    for (const r of rows) {
      if (!r._p || !r._s) continue;
      const cat = r.cat, catPath = r.catPath;
      Object.assign(r, judge(r._p, r._s, r.name, r.pic));
      r.cat = cat;
      r.catPath = catPath;
    }

    // 能提交的排最前，其次已报名，最后价格太低
    const ORDER = { ok: 0, submitted: 1, floor: 2, done: 3, fail: 4, none: 5 };
    rows.sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || (a.pid - b.pid));

    // 最多报 N 个：只勾选前 N 个可提交项
    const okRows = rows.filter(r => r.status === 'ok');
    if (cfg.maxSku > 0 && okRows.length > cfg.maxSku) {
      okRows.forEach((r, i) => { r.picked = i < cfg.maxSku; });
    }

    S.rows = rows;
    S.phase = 'ready';
    invalidate();
    renderStats(); renderRows(); renderFoot();

    const ok = rows.filter(r => r.status === 'ok').length;
    const floorN = rows.filter(r => r.status === 'floor').length;
    const floorPct = rows.length ? Math.round(floorN / rows.length * 100) : 0;
    setBar(100);
    footText(`扫描完成：共 <b>${rows.length}</b> 个 SKU，<b>${ok}</b> 个可以提交。`,
      floorPct >= 85
        ? `底价挡住了 ${floorPct}% 的商品，想多报就把底价调低再点「重新获取」。`
        : '核对下面的列表，没问题再点右边绿色按钮。');
    toast(`扫描完成，${ok} 个可以提交`);
  }

  function judge(p, s, name, pic) {
    const base = {
      _p: p,
      _s: s,
      cat: '',
      catPath: '',
      pid: p.productId,
      skuId: s.productSkcOrSkuId,
      name,
      pic,
      spec: (s.specList || []).join(' / '),
      curFen: s.currencySupplyPrice,
      afterFen: null,
      actFen: null,
      tier: null,
      reason: '',
      picked: false
    };

    if (s.increaseFlowRecordId || s.hasPreSubmit) {
      return Object.assign(base, {
        status: 'done',
        reason: s.hasPreSubmit ? '已有待处理的报名' : '已经在长期流量增长中'
      });
    }

    const tiers = (s.suggestPricePartList || []).slice();
    if (!tiers.length) {
      return Object.assign(base, { status: 'none', reason: '平台没给降价档位，当前不可报名' });
    }

    // 降幅最小的档 = suggestSupplyPrice 最大
    tiers.sort((a, b) => b.suggestSupplyPrice - a.suggestSupplyPrice);
    const best = tiers[0];
    const afterFen = best.suggestSupplyPrice;
    const actFen = afterFen - 1;
    const afterYuan = afterFen / 100;
    const floorFen = Math.round((afterYuan >= cfg.highFrom ? cfg.highFloor : cfg.floor) * 100);

    const row = Object.assign(base, { afterFen, actFen, tier: best });
    if (afterFen < floorFen || actFen < floorFen) {
      row.status = 'floor';
      row.reason = '降价后 ¥' + yuan(afterFen) + '、活动 ¥' + yuan(actFen) +
        '，低于底价 ¥' + yuan(floorFen);
      return row;
    }
    row.status = 'ok';
    row.picked = true;
    row.reason = '降价后 ¥' + yuan(afterFen) + '、活动 ¥' + yuan(actFen) +
      '，不低于底价 ¥' + yuan(floorFen);
    return row;
  }

  // ============ 提交 ============
  const FAIL_TEXT = {
    4: '需先处理调价单',
    5: '需走调价流程',
    6: '已报过名（重复提交）'
  };
  const failText = (x) => x.errMessage || FAIL_TEXT[x.failType] || ('failType ' + x.failType);

  let cfResolve = null;

  // 提交前把「要提交什么」摆清楚，尤其是不在筛选范围内的绝不动
  function askConfirm(pick) {
    const catLabel = S.cat === 'all' ? '全部类目' : S.cat;
    const pids = new Set();
    const dist = {};
    let lo = Infinity, hi = -Infinity;
    for (const r of pick) {
      pids.add(r.pid);
      dist[r.cat || '未知'] = (dist[r.cat || '未知'] || 0) + 1;
      if (r.afterFen < lo) lo = r.afterFen;
      if (r.afterFen > hi) hi = r.afterFen;
    }
    const distTxt = Object.keys(dist)
      .sort((a, b) => dist[b] - dist[a])
      .map(k => k + ' ' + dist[k]).join('、');
    const outside = S.rows.filter(r => r.picked && r.status === 'ok' && pick.indexOf(r) < 0).length;

    cfBodyEl.innerHTML =
      `<div class="tfg-cfrow"><span>本次提交</span><b>${pick.length} 个 SKU · ${pids.size} 个商品</b></div>` +
      `<div class="tfg-cfrow"><span>筛选类目</span><b>${esc(catLabel)}</b></div>` +
      `<div class="tfg-cfrow"><span>涉及类目</span><b>${esc(distTxt)}</b></div>` +
      `<div class="tfg-cfrow"><span>降价后价格</span><b>¥${yuan(lo)} ~ ¥${yuan(hi)}</b></div>` +
      (outside > 0
        ? `<div class="tfg-cfwarn">另外还有 <b>${outside}</b> 个勾选项不在「${esc(catLabel)}」里，<b>本次一个都不会提交</b>。要报它们，等这次结束后切到对应类目再提交一次。</div>`
        : `<div class="tfg-cfwarn">只提交上面这个范围里的商品，其他类目不会被动到。</div>`);

    return new Promise(res => {
      cfResolve = res;
      cfEl.classList.add('on');
    });
  }

  // 平台提交后写入有延迟（实测价格与增长记录要 1~2 分钟才出现），
  // 所以先把所有批次发完，再统一多轮回查，避免「提交完立刻查」全判失败。
  const VERIFY_ROUNDS = 8;      // 8 轮 × 15 秒 ≈ 2 分钟
  const VERIFY_GAP = 15000;

  async function verifySent(sent) {
    for (let round = 0; round < VERIFY_ROUNDS; round++) {
      if (S.stop) break;
      const rest = sent.filter(r => r.status === 'pending');
      if (!rest.length) break;

      const pids = [];
      for (const r of rest) if (pids.indexOf(r.pid) < 0) pids.push(r.pid);
      const live = new Map();
      for (let i = 0; i < pids.length; i += 100) {
        try {
          const q = await api('pageQuery', { pageInfo: { pageNo: 1, pageSize: 100 }, productIdList: pids.slice(i, i + 100) });
          for (const p of (q.products || [])) live.set(p.productId, p);
        } catch (e) { /* 限流或网络抖动，这一批留到下一轮 */ }
      }

      for (const r of rest) {
        const lp = live.get(r.pid);
        const ls = lp && (lp.skcOrSkus || []).find(x => x.productSkcOrSkuId === r.skuId);
        if (!ls) continue;                                  // 没查到 ≠ 失败，继续等
        if (ls.increaseFlowRecordId || ls.currencySupplyPrice === r.afterFen) {
          r.status = 'submitted';
          r.reason = '已报名成功：降到了 ¥' + yuan(r.afterFen) + '（活动价 ¥' + yuan(r.actFen) + '）';
        }
      }

      const ok = sent.filter(r => r.status === 'submitted').length;
      const left = sent.filter(r => r.status === 'pending').length;
      invalidate();
      renderStats();
      renderRows();
      setBar(88 + ((round + 1) / VERIFY_ROUNDS) * 12);
      footText(`核实第 <b>${round + 1}</b>/${VERIFY_ROUNDS} 轮 · 已确认成功 <b>${ok}</b> 个 · 还在处理 <b>${left}</b> 个`, '每轮隔 15 秒，平台生效一般 1~2 分钟');
      if (!left) break;
      if (round + 1 < VERIFY_ROUNDS) await sleep(VERIFY_GAP);
    }
  }

  async function doSubmit() {
    // 只提交「当前类目筛选范围内 + 已勾选」的，筛选外的一律不碰
    const pick = catRows().filter(r => r.status === 'ok' && r.picked);
    if (!pick.length) { toast('当前类目里没有勾选任何 SKU'); return; }

    const yes = await askConfirm(pick);
    if (!yes) return;

    S.phase = 'submitting';
    S.stop = false;
    renderFoot();
    setBar(0);

    // 同一商品的 SKU 必须同批
    const groups = [];
    {
      const by = new Map();
      for (const it of pick) {
        if (!by.has(it.pid)) { by.set(it.pid, []); groups.push(by.get(it.pid)); }
        by.get(it.pid).push(it);
      }
    }
    const batches = [];
    let cur = [];
    for (const g of groups) {
      if (cur.length && cur.length + g.length > cfg.batch) { batches.push(cur); cur = []; }
      cur.push.apply(cur, g);
    }
    if (cur.length) batches.push(cur);

    const sent = [];

    for (let bi = 0; bi < batches.length; bi++) {
      if (S.stop) break;
      const chunk = batches[bi];
      const body = {
        source: 'userscript',
        productInfoList: chunk.map(r => ({
          isTemp: false,
          productId: r.pid,
          productSkcOrSkuId: r.skuId,
          isApparel: false,
          adjustSupplyPrice: r.afterFen,
          index: r.tier.index,
          upRate: r.tier.upRate == null ? null : r.tier.upRate,
          upNum: r.tier.upNum == null ? 0 : r.tier.upNum,
          currencyType: 'CNY',
          acceptAdjustActPrice: true
        }))
      };

      try {
        const res = await api('commit', body);
        const detail = Array.isArray(res.productInfoList) ? res.productInfoList : [];
        const bySku = new Map(detail.map(x => [x.productSkcOrSkuId, x]));
        for (const r of chunk) {
          r.picked = false;
          r.status = 'pending';                  // 先挂「待确认」，统一回查后再定
          const d = bySku.get(r.skuId);
          r.retMsg = d && !d.isSuccess ? failText(d) : '';
        }
        sent.push.apply(sent, chunk);
      } catch (e) {
        // 请求报错不代表没提交成功，同样挂「待确认」，交给回查
        for (const r of chunk) {
          r.picked = false;
          r.status = 'pending';
          r.retMsg = '请求出错：' + e.message;
        }
        sent.push.apply(sent, chunk);
        toast('第 ' + (bi + 1) + ' 批请求出错：' + e.message);
      }

      invalidate();
      renderStats();
      renderRows();
      setBar((bi + 1) / (batches.length + VERIFY_ROUNDS) * 100);
      footText(`已发送 <b>${bi + 1}</b>/${batches.length} 批 · 共 <b>${sent.length}</b> 个 SKU`, '平台写入有延迟，全部发完后统一核实');
      if (bi + 1 < batches.length && !S.stop) await sleep(cfg.delay);
    }

    await verifySent(sent);

    const okNum = sent.filter(r => r.status === 'submitted').length;
    const pendNum = sent.filter(r => r.status === 'pending').length;
    for (const r of sent) {
      if (r.status !== 'pending') continue;
      r.reason = '平台还没返回生效结果（价格一般 1~2 分钟才变），刷新页面看「长期增长」里有没有它' +
        (r.retMsg ? '；提交接口当时说：' + r.retMsg : '');
    }

    S.phase = 'done';
    invalidate();
    renderStats();
    renderRows();
    renderFoot();
    setBar(100);
    footText(`提交结束：已确认成功 <b>${okNum}</b> 个，待确认 <b>${pendNum}</b> 个。`,
      pendNum
        ? '「待确认」不等于失败——平台写入慢，1~2 分钟后刷新页面对照「长期增长」即可。'
        : '全部已回查到增长记录，刷新页面即见「长期增长中」。');
    toast(`提交完成：确认成功 ${okNum} 个，待确认 ${pendNum} 个`);
  }

  // ============ 主按钮 ============
  function onMain() {
    readCfg();
    if (S.phase === 'ready' || S.phase === 'done') return doSubmit();
    return scan();
  }

  // ============ 启动 ============
  let autoOpened = false;
  function boot() {
    if (!/\/main\/flow-grow/.test(location.pathname)) return;
    if (!document.getElementById('tfg-root')) {
      const had = root;
      build();
      if (!had) open();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  setInterval(boot, 2500);
})();
