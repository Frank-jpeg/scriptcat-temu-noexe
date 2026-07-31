// ==UserScript==
// @name         TEMU实拍图直传-自改版批量版
// @namespace    https://github.com/Frank-jpeg/scriptcat-temu-noexe
// @version      1.0.3
// @description  按指定 SPU 清单批量套用实拍图标签图。直接调 TEMU 接口，图片只上传一次，一次提交 50 个 SPU，无需逐个处理。
// @match        https://agentseller.temu.com/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu%E5%AE%9E%E6%8B%8D%E5%9B%BE%E7%9B%B4%E4%BC%A0%E8%87%AA%E6%94%B9%E7%89%88%E6%89%B9%E9%87%8F%E7%89%88.user.js
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu%E5%AE%9E%E6%8B%8D%E5%9B%BE%E7%9B%B4%E4%BC%A0%E8%87%AA%E6%94%B9%E7%89%88%E6%89%B9%E9%87%8F%E7%89%88.user.js
// ==/UserScript==

/* ============================================================================
 * 接口全景（全部经真实抓包 / 公开脚本交叉确认）
 *
 * 1) 列表   POST /api/flash/real_picture/list
 *           headers: {Content-Type: application/json, Mallid}
 *           body:    {page, page_size(最大50), page_version:1, spu_id_list?:[字符串]}
 *           resp:    {error_code:1000000, result:{total, items:[{spu_id, goods_id, ...}]}}
 *
 * 2) 签名   POST /ms/bg-flux-ms/compliance_property/signature   body:{tag:'flash-tag'}
 *           resp: result.signature   ← 一次性，每张图都要重新取
 *
 * 2b) 图床  POST /api/galerie/v3/store_image?sdk_version=js-0.0.37&tag_name=flash-tag
 *           FormData: {url_width_height:'true', image: File, upload_sign: 签名}
 *           不需要 Mallid / anti-content
 *           resp:    含 https://pos.file.temu.com/... 的图片地址
 *
 * 3) 类目   POST /api/kiana/mms/robin/searchForChainSupplier
 *           headers: {Content-Type: application/json, Mallid}
 *           body:    {productSpuIdList:[最多100], pageNum:1, pageSize:100, supplierTodoTypeList:[]}
 *           resp:    {result:{dataList:[{productId, catIdList:[...]}]}}
 *
 * 4) 提交   POST /api/flash/real_picture/batch_upload
 *           headers: {Content-Type: application/json, Mallid}
 *           body:    {confirm_type:4, spu_ids:[数字, 最多50], batch_upload_task_type:1,
 *                     cate_id_list:[catId],
 *                     upload_image_list:[{position, position_type, image:'图片URL'}]}
 *
 * position    1=商品主体实拍图  2=商品外包装实拍图  3=说明书  5=EU DOC
 * position_type  2=标签图（其余槽位未验证，本脚本只做标签图）
 * ==========================================================================*/

(function () {
  'use strict';

  // ============================ 配置 ============================

  // 类目接口。来源：另一份公开脚本「合规中心-实拍图-自改版」实测可用
  //   body: {pageNum:1, pageSize:100, supplierTodoTypeList:[], productSpuIdList:[...]}
  //   resp: result.dataList[].catIdList
  // 半托管店铺可能要换成 searchForSemiSupplier
  const CATE_API = '/api/kiana/mms/robin/searchForChainSupplier';

  // catIdList 是类目路径 [一级, 二级, …, 叶子]，取哪一级两份参考实现不一致：
  //   佳同 batch_upload 用 catIdList[length-1]（叶子）
  //   杨总 upload_new  用 catIdList[0]（一级）
  // 我们走的是 batch_upload，所以跟佳同一致取叶子。试运行会打印完整路径供核对。
  const CATE_PICK = (list) => list[list.length - 1];

  const MAX_IMAGE_BYTES = 3 * 1024 * 1024;   // 弹窗提示「每张不超过 3Mb」

  const API = {
    list:   '/api/flash/real_picture/list',
    sign:   '/ms/bg-flux-ms/compliance_property/signature',
    image:  '/api/galerie/v3/store_image?sdk_version=js-0.0.37&tag_name=flash-tag',
    submit: '/api/flash/real_picture/batch_upload',
  };

  const POSITION = { 主体: 1, 外包装: 2, 说明书: 3, EUDOC: 5 };
  const POSITION_TYPE_标签图 = 2;

  const LIST_PAGE_SIZE   = 50;   // TEMU 硬上限，实测 100 直接系统异常
  const LIST_SPU_CHUNK   = 50;   // 单次请求携带的 spu_id_list 长度，超了 TEMU 不响应
  const CATE_SPU_CHUNK   = 100;  // 类目接口一次可查 100 个
  const SUBMIT_SPU_CHUNK = 50;   // 佳同自己也是 50 一批
  const CONCURRENCY      = 4;    // 保守，TEMU 会 429
  const ALLOW_PATHS = ['/govern/dashboard', '/govern/compliant-live-photos'];

  // ============================ 工具 ============================

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (a, b) => a + Math.floor(Math.random() * (b - a));

  /** 店铺 ID。TEMU 自己存在 localStorage，佳同也会在页面上渲染一份 */
  function getMallId() {
    const fromWin = typeof window.mallId !== 'undefined' && window.mallId;
    if (fromWin) return String(fromWin);
    const fromLs = localStorage.getItem('agentseller-mall-info-id');
    if (fromLs && /^\d{5,}$/.test(fromLs)) return fromLs;
    const el = document.querySelector('#jtkj-temu-mallid');
    const m = el && el.textContent.match(/(\d{5,})/);
    if (m) return m[1];
    throw new Error('取不到店铺 ID（mallid），请求会被 403 拒绝');
  }

  function parseSpu(text) {
    const seen = new Set(); const out = []; let bad = 0;
    for (const t of String(text).split(/[\s,，、;；|]+/)) {
      const s = t.trim();
      if (!s) continue;
      if (!/^\d{6,}$/.test(s)) { bad++; continue; }
      if (!seen.has(s)) { seen.add(s); out.push(s); }
    }
    return { spus: out, bad };
  }

  const chunk = (arr, n) => {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  /**
   * 带重试 + 429 退避的 JSON 请求。
   * TEMU 不同接口族的字段命名不统一：
   *   /api/flash/*  → error_code / error_msg（下划线）
   *   /api/kiana/*  → errorCode  / errorMsg （驼峰）
   * 所以这里两种都认，认不出来就只看 success 和 result 是否存在。
   */
  async function callApi(url, body, { retries = 5 } = {}) {
    const mall = getMallId();
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await fetch(url, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Mallid': mall },
          body: JSON.stringify(body),
        });
        if (res.status === 429) { await sleep(jitter(20000, 30000)); continue; }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        const raw = JSON.stringify(j).slice(0, 300);
        const code = j.error_code ?? j.errorCode;
        const msg = j.error_msg ?? j.errorMsg ?? j.error_message ?? '';
        if (j.success === false) throw new Error(`success=false ${msg} | ${raw}`);
        if (code != null && code !== 1000000) throw new Error(`code=${code} ${msg} | ${raw}`);
        if (j.result == null) throw new Error(`响应里没有 result | ${raw}`);
        return j.result;
      } catch (e) {
        if (i === retries) throw e;
        await sleep(jitter(800, 2000) * (i + 1));
      }
    }
  }

  /** 并发跑一组任务，保持 CONCURRENCY 上限 */
  async function pool(items, worker, onTick) {
    const out = new Array(items.length);
    let idx = 0, done = 0;
    const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        try { out[i] = await worker(items[i], i); }
        catch (e) { out[i] = { __error: e.message || String(e) }; }
        done++; onTick && onTick(done, items.length);
        await sleep(jitter(300, 900));
      }
    });
    await Promise.all(runners);
    return out;
  }

  // ======================= 四个业务步骤 =======================

  /**
   * 取图床上传签名。没有它 store_image 直接 401。
   * 佳同和「杨总改版」两份实现都是这么两步走的。
   */
  async function getUploadSign() {
    const res = await fetch(API.sign, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Mallid': getMallId() },
      body: JSON.stringify({ tag: 'flash-tag' }),
    });
    if (!res.ok) throw new Error('签名接口 HTTP ' + res.status);
    const j = await res.json().catch(() => null);
    const r = j?.result;
    const sign = (r && (r.signature || r.upload_sign || r.sign)) || (typeof r === 'string' ? r : null);
    if (!j?.success || !sign) {
      throw new Error('取图床签名失败：' + (j?.error_msg || JSON.stringify(j || {}).slice(0, 200)));
    }
    return sign;
  }

  /**
   * 上传一张图 → 返回 pos.file.temu.com 的 URL
   * 注意：签名是【一次性】的，用过就作废（"The signature already used"），
   * 所以每张图都必须单独取一次，不能提到外面复用。
   */
  async function uploadImage(file, retries = 3) {
    for (let i = 0; i <= retries; i++) {
      const sign = await getUploadSign();
      const fd = new FormData();
      fd.append('url_width_height', 'true');
      fd.append('image', file);
      fd.append('upload_sign', sign);
      const res = await fetch(API.image, { method: 'POST', credentials: 'include', body: fd });
      const j = await res.json().catch(() => null);
      const url = j && (j.url || j.image_url || (j.result && (j.result.url || j.result.image_url)));
      if (url) return url;
      const hit = JSON.stringify(j || {}).match(/https:\/\/[a-z0-9.-]*file\.temu\.com\/[^"\\]+/i);
      if (hit) return hit[0];
      const msg = j?.error_msg || j?.message || JSON.stringify(j || {}).slice(0, 200);
      if (i === retries) throw new Error(`图床 HTTP ${res.status} ${msg}`);
      await sleep(jitter(600, 1500));
    }
  }

  /** 用 spu_id_list 分片查回商品，确认哪些确实在待办里 */
  async function fetchProducts(spus, log) {
    const parts = chunk(spus, LIST_SPU_CHUNK);
    log(`查询商品：${spus.length} 个，分 ${parts.length} 批`);
    const res = await pool(parts,
      (part) => callApi(API.list, { page: 1, page_size: LIST_PAGE_SIZE, page_version: 1, spu_id_list: part }),
      (d, t) => log(`  查询进度 ${d}/${t}`, true));
    const items = [];
    for (const r of res) {
      if (r?.__error) { log(`  ⚠ 一批查询失败：${r.__error}`, false, 'warn'); continue; }
      items.push(...(r?.items || []));
    }
    return items;
  }

  /** 批量取类目 ID。返回 Map<spuId, {catId, path}> */
  async function fetchCategories(spus, log) {
    const parts = chunk(spus.map(Number), CATE_SPU_CHUNK);
    log(`查询类目：分 ${parts.length} 批`);
    const res = await pool(parts,
      (part) => callApi(CATE_API, { productSpuIdList: part, pageNum: 1, pageSize: CATE_SPU_CHUNK, supplierTodoTypeList: [] }),
      (d, t) => log(`  类目进度 ${d}/${t}`, true));
    const map = new Map();
    for (const r of res) {
      if (r?.__error) { log(`  ⚠ 一批类目失败：${r.__error}`, false, 'warn'); continue; }
      for (const row of (r?.dataList || r?.data_list || [])) {
        const list = row.catIdList || row.cat_id_list || [];
        if (list.length) {
          map.set(String(row.productId ?? row.product_id), { catId: CATE_PICK(list), path: list });
        }
      }
    }
    return map;
  }

  /** 按类目分组 → 每组 50 一批提交 */
  function buildTasks(spus, cateMap, images) {
    const byCate = new Map();
    const noCate = [];
    for (const s of spus) {
      const c = cateMap.get(String(s));
      if (c == null) { noCate.push(s); continue; }
      if (!byCate.has(c.catId)) byCate.set(c.catId, []);
      byCate.get(c.catId).push(Number(s));
    }
    const tasks = [];
    for (const [catId, ids] of byCate) {
      for (const part of chunk(ids, SUBMIT_SPU_CHUNK)) {
        tasks.push({
          confirm_type: 4,
          spu_ids: part,
          upload_image_list: images,
          cate_id_list: [catId],
          batch_upload_task_type: 1,
        });
      }
    }
    return { tasks, noCate };
  }

  // ============================ UI ============================

  const css = `
  #jtA{position:fixed;z-index:2147483000;top:80px;right:18px;width:360px;
    font:13px/1.55 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#e9edf4;
    background:#161d2b;border:1px solid #2d3850;border-radius:11px;
    box-shadow:0 14px 38px rgba(6,10,20,.5);overflow:hidden}
  #jtA *{box-sizing:border-box}
  #jtA header{display:flex;align-items:center;gap:8px;padding:11px 13px;cursor:move;
    background:#1d2739;border-bottom:1px solid #2d3850;user-select:none}
  #jtA header b{flex:1;font-size:13px;letter-spacing:.2px}
  #jtA header .tag{font-size:10px;padding:2px 6px;border-radius:4px;background:#4a3a17;color:#f2c14e}
  #jtA .body{padding:13px;max-height:74vh;overflow:auto}
  #jtA textarea{width:100%;height:88px;resize:vertical;padding:8px;border-radius:6px;
    background:#0f1521;border:1px solid #2d3850;color:#e9edf4;outline:none;
    font:12px/1.5 ui-monospace,Consolas,monospace}
  #jtA textarea:focus,#jtA input:focus{border-color:#5b8def}
  #jtA .row{display:flex;align-items:center;gap:8px;margin-top:10px}
  #jtA label.k{color:#8d9bb5;font-size:12px;flex:none;width:74px}
  #jtA input[type=file]{flex:1;font-size:11px;color:#8d9bb5}
  #jtA .stat{margin-top:10px;padding:8px 9px;border-radius:6px;background:#0f1521;
    border:1px solid #24304a;font:12px/1.65 ui-monospace,Consolas,monospace;color:#a5b3cc}
  #jtA .stat em{color:#7dd3fc;font-style:normal;font-weight:600}
  #jtA .btns{display:flex;gap:7px;margin-top:11px}
  #jtA button{flex:1;padding:9px;border:0;border-radius:6px;cursor:pointer;
    font:600 12.5px/1 inherit;color:#fff;background:#3d6bd6}
  #jtA button:hover{background:#4d7cea}
  #jtA button:disabled{background:#2a3450;opacity:.5;cursor:not-allowed}
  #jtA button.dry{background:#2a3346;color:#a5b3cc}
  #jtA button.dry:hover{background:#333f57;color:#fff}
  #jtA .log{margin-top:11px;max-height:190px;overflow:auto;padding-top:9px;
    border-top:1px solid #24304a;font:11.5px/1.65 ui-monospace,Consolas,monospace}
  #jtA .log div{color:#8794ad;word-break:break-all}
  #jtA .log div.ok{color:#86efac} #jtA .log div.warn{color:#fcd34d} #jtA .log div.err{color:#fca5a5}
  #jtA .log::-webkit-scrollbar{width:6px}
  #jtA .log::-webkit-scrollbar-thumb{background:#36425c;border-radius:3px}`;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'jtA';
  root.innerHTML = `
    <header><b>实拍图 · 批量直传</b><span class="tag">A 方案</span></header>
    <div class="body">
      <textarea id="a-spu" spellcheck="false" placeholder="粘贴 SPU，换行/逗号/空格分隔"></textarea>
      <div class="row"><label class="k">主体标签图</label><input type="file" id="a-img1" accept="image/*" multiple></div>
      <div class="row"><label class="k">外包装标签图</label><input type="file" id="a-img2" accept="image/*" multiple></div>
      <div class="stat" id="a-stat">等待输入…</div>
      <div class="btns">
        <button class="dry" id="a-dry">试运行（不提交）</button>
        <button id="a-go">开始提交</button>
      </div>
      <div class="log" id="a-log"></div>
    </div>`;
  document.body.appendChild(root);

  const $ = (s) => root.querySelector(s);
  const elSpu = $('#a-spu'), elImg1 = $('#a-img1'), elImg2 = $('#a-img2');
  const elStat = $('#a-stat'), elLog = $('#a-log'), elDry = $('#a-dry'), elGo = $('#a-go');

  let lastLine = null;
  function log(msg, replace = false, cls = '') {
    if (replace && lastLine) { lastLine.textContent = msg; return; }
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = msg;
    elLog.appendChild(d);
    elLog.scrollTop = elLog.scrollHeight;
    lastLine = replace ? d : null;
  }

  (function drag() {
    const h = root.querySelector('header');
    let on = false, sx, sy, ox, oy;
    h.addEventListener('mousedown', (e) => {
      on = true; const r = root.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      root.style.right = 'auto'; e.preventDefault();
    });
    addEventListener('mousemove', (e) => {
      if (!on) return;
      root.style.left = Math.max(0, ox + e.clientX - sx) + 'px';
      root.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
    });
    addEventListener('mouseup', () => { on = false; });
  })();

  function refresh() {
    const { spus, bad } = parseSpu(elSpu.value);
    const n1 = elImg1.files.length, n2 = elImg2.files.length;
    elStat.innerHTML = spus.length
      ? `SPU <em>${spus.length}</em> 个${bad ? `（忽略 ${bad}）` : ''}　图片：主体 <em>${n1}</em> 张 / 外包装 <em>${n2}</em> 张`
      : '等待输入…';
    const ready = spus.length > 0 && (n1 + n2) > 0;
    elGo.disabled = !ready; elDry.disabled = !ready;
    return spus;
  }
  elSpu.addEventListener('input', refresh);
  elImg1.addEventListener('change', refresh);
  elImg2.addEventListener('change', refresh);

  // ============================ 主流程 ============================

  async function run(dryRun) {
    elGo.disabled = elDry.disabled = true;
    try {
      const spus = parseSpu(elSpu.value).spus;
      log(`===== ${dryRun ? '试运行' : '正式提交'} 开始（${spus.length} 个 SPU）=====`, false, 'ok');

      // 1. 上传图片（每张只传一次）
      const images = [];
      for (const [pos, input] of [[POSITION.主体, elImg1], [POSITION.外包装, elImg2]]) {
        for (const f of input.files) {
          if (f.size > MAX_IMAGE_BYTES) {
            throw new Error(`${f.name} 有 ${(f.size / 1048576).toFixed(2)}MB，超过 TEMU 的 3MB 限制`);
          }
          const url = await uploadImage(f);
          images.push({ position: pos, position_type: POSITION_TYPE_标签图, image: url });
          log(`图片已上传 [position=${pos}] ${f.name} → ${url.slice(0, 64)}…`, false, 'ok');
        }
      }
      if (!images.length) throw new Error('没有可用图片');

      // 2. 确认商品在待办列表里
      const items = await fetchProducts(spus, log);
      const found = new Set(items.map((i) => String(i.spu_id)));
      const missing = spus.filter((s) => !found.has(s));
      log(`命中 ${found.size} 个，未命中 ${missing.length} 个`, false, missing.length ? 'warn' : 'ok');
      if (missing.length) log(`未命中（不在实拍图待办里/已传过/不属于本店）：${missing.slice(0, 20).join(',')}${missing.length > 20 ? ' …' : ''}`, false, 'warn');
      const valid = [...found];
      if (!valid.length) throw new Error('没有任何 SPU 命中，终止');

      // 3. 取类目
      const cateMap = await fetchCategories(valid, log);
      log(`拿到类目 ${cateMap.size} 个`, false, 'ok');

      // 4. 组装
      const { tasks, noCate } = buildTasks(valid, cateMap, images);
      if (noCate.length) log(`⚠ ${noCate.length} 个 SPU 没查到类目，已跳过：${noCate.slice(0, 10).join(',')}`, false, 'warn');
      log(`组装完成：${tasks.length} 个提交批次`, false, 'ok');

      if (dryRun) {
        log('—— 试运行结束，未提交任何数据 ——', false, 'ok');
        // catIdList 取哪一级两份参考实现不一致，把完整路径打出来人工核对
        log('类目路径抽样（确认 cate_id_list 取的是不是对的那一级）：');
        for (const s of valid.slice(0, 3)) {
          const c = cateMap.get(String(s));
          if (c) log(`  SPU ${s}  catIdList=[${c.path.join(' > ')}]  取用 ${c.catId}`);
        }
        log('第 1 个批次的请求体预览：');
        log(JSON.stringify(tasks[0], null, 1));
        return;
      }

      // 5. 提交
      let ok = 0, fail = 0;
      const res = await pool(tasks, (t) => callApi(API.submit, t),
        (d, t) => log(`  提交进度 ${d}/${t}`, true));
      res.forEach((r, i) => {
        if (r?.__error) { fail++; log(`批次 ${i + 1} 失败：${r.__error}`, false, 'err'); }
        else ok += tasks[i].spu_ids.length;
      });
      log(`===== 完成：成功 ${ok} 个商品，失败批次 ${fail} 个 =====`, false, fail ? 'warn' : 'ok');
    } catch (e) {
      log('中止：' + (e.message || e), false, 'err');
    } finally {
      refresh();
    }
  }

  elDry.onclick = () => run(true);
  elGo.onclick = () => {
    const n = parseSpu(elSpu.value).spus.length;
    if (!confirm(`即将向 ${n} 个商品写入实拍图，这会真实修改线上数据。\n\n确认继续？`)) return;
    run(false);
  };

  // ---------------------- 生效页面 ----------------------
  const allowed = () => ALLOW_PATHS.includes(location.pathname.replace(/\/+$/, '') || '/');
  const apply = () => { root.style.display = allowed() ? '' : 'none'; };
  for (const t of ['pushState', 'replaceState']) {
    const o = history[t];
    history[t] = function () { const r = o.apply(this, arguments); apply(); return r; };
  }
  addEventListener('popstate', apply);
  setInterval(apply, 900);
  apply();

  log('脚本已就绪 v1.0.3');
  refresh();
})();
