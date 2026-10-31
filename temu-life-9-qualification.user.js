// ==UserScript==
// @name         上新生命周期-9-按模板自动上传资质
// @namespace    https://www.goldabcd.com/
// @description  多模板自动扫描同末级类目待上传商品，复用模板FCM和FCM DoC，无需填写目标SPU
// @author       Frank-jpeg
// @match        https://agentseller.temu.com/newon/product-select*
// @version      2026.1031.2
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-9-qualification.user.js
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-9-qualification.user.js
// ==/UserScript==

(function () {
    'use strict';
    const VERSION = '2026.1031.2';
    const SCRIPT_NAME = '上新生命周期-9-按模板自动上传资质';
    const PREFIX = 'goldabcd_qualification_v1:';
    const LIST = '/mms/arbok/product_cert/query/list';
    const DETAIL = '/mms/arbok/product_cert/query/detail';
    const UPLOAD = '/bg-lich-mms/cert/product/upload';
    const TYPES = [132, 1208], NAMES = { 132: 'FCM', 1208: 'FCM DoC' };
    const INTERVAL = 6 * 60 * 60 * 1000;
    const id = v => String(v == null ? '' : v).trim();
    const safeSpu = v => /^[1-9]\d{4,15}$/.test(id(v)) && Number.isSafeInteger(Number(v));
    const clone = v => JSON.parse(JSON.stringify(v));
    function normalizeTemplateName(value, spu) {
        const name = id(value).slice(0, 80);
        return name || ('模板 ' + id(spu));
    }
    function normalizeTemplates(value) {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        return value.map(item => {
            if (!item || !safeSpu(item.spu)) return null;
            const spu = id(item.spu), name = normalizeTemplateName(item.name, spu);
            if (seen.has(name)) return null;
            seen.add(name);
            return { name, spu };
        }).filter(Boolean);
    }
    function normalizeConfig(raw) {
        raw = raw && typeof raw === 'object' ? raw : {};
        if (raw.version === 3) return { version: 3, templates: normalizeTemplates(raw.templates), enabled: raw.enabled === true };
        const legacySpu = safeSpu(raw.template) ? id(raw.template) : '48477498749';
        return { version: 3, templates: [{ name: '新奇马克杯', spu: legacySpu }], enabled: false };
    }
    function parseList(data) {
        const r = data && data.result;
        if (!data || data.success !== true || !r || !Array.isArray(r.product_with_cert_list) || !Number.isInteger(r.total) || r.total < 0) throw Error('资质列表格式异常');
        return { total: r.total, rows: r.product_with_cert_list.map(row => {
            const b = row.product_base_info;
            if (!b || !safeSpu(b.product_id) || !Array.isArray(b.cate_ids) || !b.cate_ids.length || !Array.isArray(row.product_cert_info_list)) throw Error('商品资质行格式异常');
            return { id: id(b.product_id), leaf: id(b.cate_ids.at(-1)), name: b.leaf_category_name || '', canEdit: b.can_edit === true, certs: row.product_cert_info_list };
        }) };
    }
    function certDetail(data, type) {
        const c = data && data.result && data.result.product_cert_info;
        if (!data || data.success !== true || !c || Number(c.cert_type) !== type || !Object.hasOwn(c, 'inspect_report_files') || !Object.hasOwn(c, 'product_cert_files')) throw Error(NAMES[type] + '详情格式异常');
        return c;
    }
    function files(rows) {
        return (rows || []).map(f => {
            const fileUrl = f.original_file_url;
            if (!f.file_name || typeof fileUrl !== 'string' || !fileUrl.startsWith('https://')) throw Error('模板缺少有效的原始文件地址');
            return { fileName: f.file_name, fileUrl };
        });
    }
    function hasFiles(c) {
        return !!((c.inspect_report_files || []).length || (c.product_cert_files || []).length ||
            Object.values(c.multi_lang_product_cert_file_map || {}).some(a => a && a.length) ||
            Object.values(c.multi_lang_inspect_report_map || {}).some(a => a && a.length) || c.doc_pdf_content_req);
    }
    // query/list 的待上传值为 1，不是 batch_upload/product_list 的 2。
    function pending(p, type) {
        const c = p.certs.find(c => Number(c.cert_type) === type);
        return p.canEdit && !!c && c.can_upload === true && Number(c.upload_status) === 1 && Number(c.audit_status) === 1;
    }
    function templateCert(c, type) {
        const out = { certType: type, docPdfContentReq: null, energyLabel: {} };
        if (type === 132) {
            out.inspectReportFiles = files(c.inspect_report_files);
            if (!out.inspectReportFiles.length) throw Error('模板没有 FCM 报告');
        } else if (type === 1208) {
            if (c.file_upload_type !== 1) throw Error('模板 FCM DoC 必须为已上传文件模式');
            out.fileUploadType = 1;
            out.multiLangProductCertFileMap = Object.fromEntries(Object.entries(c.multi_lang_product_cert_file_map || {}).map(([lang, rows]) => [lang, files(rows)]));
            if (!Object.values(out.multiLangProductCertFileMap).some(a => a.length)) throw Error('模板没有 FCM DoC 文件');
            out.selectedCheckItems = clone(c.selected_check_items || {});
        } else throw Error('不支持的资质');
        return out;
    }
    function uploadBody(spu, cert, target) {
        if (!safeSpu(spu) || !TYPES.includes(cert.certType)) throw Error('不支持的上传目标或资质');
        const body = { productId: Number(spu), extendedInfo: { hitUploadGray: true, hitUploadMultiLanguageGary: true, marketServiceAutoSendAudit: false, hitMerchantEditClpGray: true }, productCatCertReqList: [clone(cert)] };
        if (cert.certType === 132) {
            body.realPictures = (target.real_pictures || []).map(p => ({ imageUrl: p.image_url }));
            if (!body.realPictures.length || body.realPictures.some(p => !p.imageUrl)) throw Error('目标商品缺少实拍图，请先运行第6个脚本');
        }
        return body;
    }
    function matchesUpload(c, cert) {
        const urls = new Set([...(c.inspect_report_files || []), ...(c.product_cert_files || []), ...Object.values(c.multi_lang_product_cert_file_map || {}).flat()].map(f => f.original_file_url));
        const wanted = cert.inspectReportFiles || Object.values(cert.multiLangProductCertFileMap || {}).flat();
        return wanted.length > 0 && wanted.every(f => urls.has(f.fileUrl));
    }
    function createWorker({ request, assertContext = () => {}, stopped = () => false, sleep = ms => new Promise(r => setTimeout(r, ms)), progress = () => {}, log = () => {} }) {
        function check() { assertContext(); if (stopped()) { const e = Error('已暂停'); e.stopped = true; throw e; } }
        async function call(path, body, write = false) { check(); const r = await request(path, body, write); check(); return r; }
        async function getProduct(spu) {
            const rows = parseList(await call(LIST, { cert_types: TYPES, product_ids: [spu], page: 1, page_size: 25 })).rows;
            if (rows.length !== 1 || rows[0].id !== spu) throw Error('SPU ' + spu + ' 未返回唯一商品');
            return rows[0];
        }
        async function getDetail(spu, type) { return certDetail(await call(DETAIL, { product_id: spu, cert_type: type }), type); }
        async function readTemplate(spu) {
            if (!safeSpu(spu)) throw Error('模板 SPU 无效');
            const product = await getProduct(spu), certs = {};
            for (const t of TYPES) certs[t] = templateCert(await getDetail(spu, t), t);
            return { product, certs };
        }
        async function scanSnapshot() {
            const products = new Map(); let total;
            // 完整读取快照后才写入，防止上传后分页移动而漏扫。
            for (let page = 1; page <= 400; page++) {
                const r = parseList(await call(LIST, { cert_types: TYPES, page, page_size: 25 }));
                if (total === undefined) total = r.total;
                if (r.total !== total) throw Error('扫描期间商品总数变化，请重新开启扫描');
                if (total > 10000) throw Error('超过10000条扫描窗口，存在未覆盖商品，本轮未上传');
                for (const p of r.rows) {
                    if (products.has(p.id)) throw Error('分页返回重复商品，本轮未上传，请重新扫描');
                    products.set(p.id, p);
                }
                progress('扫描第 ' + page + ' 页：' + products.size + '/' + total + ' 个商品');
                if (products.size === total) return [...products.values()];
                if (r.rows.length !== 25 || products.size > total) throw Error('分页数据未完整覆盖，本轮未上传');
                await sleep(200); check();
            }
            throw Error('扫描达到页数上限，存在未覆盖商品');
        }
        async function scan(template) {
            return (await scanSnapshot()).filter(p => p.id !== template.id && p.leaf === template.leaf && TYPES.some(t => pending(p, t)));
        }
        async function uploadForTemplate(template, targets, limit = Infinity) {
            let success = 0, skipped = 0, processed = 0;
            for (const row of targets.slice(0, limit)) {
                check();
                for (const t of TYPES) {
                    if (!pending(row, t)) continue;
                    const live = await getProduct(row.id);
                    if (live.leaf !== template.product.leaf || !pending(live, t)) { skipped++; continue; }
                    const d = await getDetail(row.id, t);
                    if (Number(d.audit_status) !== 1 || hasFiles(d)) { skipped++; log(row.id + ' ' + NAMES[t] + ' 已存在文件或审核记录，跳过'); continue; }
                    if (t === 132 && !(d.real_pictures || []).length) { skipped++; log(row.id + ' FCM 缺少实拍图，跳过（先运行第6个脚本）', 'detail-error'); continue; }
                    const body = uploadBody(row.id, template.certs[t], d);
                    progress('上传 ' + (processed + 1) + '/' + targets.length + '：' + row.id + ' ' + NAMES[t]);
                    const result = await call(UPLOAD, body, true);
                    if (result.success !== true || !result.result || result.result.success !== true) throw Error(row.id + ' ' + NAMES[t] + ' 上传失败或结果不明，已停止');
                    let verified = false;
                    try {
                        for (let attempt = 0; attempt < 3; attempt++) {
                            await sleep(800); check();
                            if (matchesUpload(await getDetail(row.id, t), template.certs[t])) { verified = true; break; }
                        }
                    } catch (e) { e.retryableRead = false; throw e; }
                    if (!verified) throw Error(row.id + ' ' + NAMES[t] + ' 提交后文件复查未通过，已停止');
                    success++; log(row.id + ' ' + NAMES[t] + ' 上传成功，文件复查一致');
                }
                processed++;
            }
            return { candidates: targets.length, processed, success, skipped };
        }
        async function runMany(templateSpecs, { limit = Infinity } = {}) {
            const templates = [];
            for (const spec of templateSpecs || []) {
                check();
                const loaded = await readTemplate(spec.spu);
                if (templates.some(item => item.product.leaf === loaded.product.leaf)) throw Error('多个模板使用同一末级类目：' + loaded.product.name + '（' + loaded.product.leaf + '）');
                templates.push({ ...loaded, name: normalizeTemplateName(spec.name, spec.spu), spu: id(spec.spu) });
            }
            if (!templates.length) throw Error('请先保存至少一个模板');
            const snapshot = await scanSnapshot();
            const totals = { candidates: 0, processed: 0, success: 0, skipped: 0 };
            const seen = new Set();
            for (const template of templates) {
                const targets = snapshot.filter(p => p.id !== template.product.id && p.leaf === template.product.leaf && TYPES.some(t => pending(p, t)) && !seen.has(p.id));
                targets.forEach(p => seen.add(p.id));
                log(template.name + '：自动扫描到待上传商品 ' + targets.length + ' 个');
                const result = await uploadForTemplate(template, targets, limit);
                for (const key of Object.keys(totals)) totals[key] += result[key];
            }
            return totals;
        }
        async function run(spu, options = {}) {
            const template = await readTemplate(spu);
            return uploadForTemplate(template, await scan(template.product), options.limit);
        }
        return { run, runMany, scan, scanSnapshot, readTemplate };
    }
    function panelPosition(button, width, height, vw, vh) {
        const w = Math.min(width, vw - 16), h = Math.min(height, vh - 16);
        return { left: Math.max(8, Math.min(button.left, vw - w - 8)), top: Math.max(8, Math.min(button.bottom + 4, vh - h - 8)) };
    }
    function init() {
        if (document.getElementById('goldabcd-qualification-host')) return;
        const mallId = () => localStorage.getItem('agentseller-mall-info-id') || '';
        const mall = mallId(); if (!mall) { setTimeout(init, 1000); return; }
        const key = PREFIX + mall; let raw;
        try { raw = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { raw = null; }
        const config = normalizeConfig(raw);
        if (raw && raw.version !== 3) {
            localStorage.setItem(key + ':backup:' + Date.now(), JSON.stringify(raw));
            localStorage.setItem(key, JSON.stringify(config));
        }
        let busy = false, stopped = false, leaving = false, changed = false, timer = null, editingName = '';
        const host = document.createElement('div'); host.id = 'goldabcd-qualification-host'; host.dataset.version = VERSION;
        document.body.appendChild(host); const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = '<style>:host{all:initial;font:13px/1.45 Arial,"Microsoft YaHei",sans-serif;color:#111}*{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer;border:1px solid #bbb;border-radius:4px;padding:5px 8px;background:#fff}button:disabled{opacity:.5}.open{position:absolute;left:260px;top:520px;z-index:9999;background:pink;border:0;padding:10px}.panel{position:fixed;width:450px;max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);overflow:auto;overscroll-behavior:contain;z-index:2147483000;background:#fff;border:1px solid #ff8fb3;border-radius:6px;padding:10px;box-shadow:0 6px 18px #0002}[hidden]{display:none!important}.head,.row,.actions{display:flex;gap:6px;align-items:center}.head{justify-content:space-between}h3{margin:0;font-size:13px}.row,.actions{margin:8px 0;flex-wrap:wrap}.field{width:100%;height:30px;padding:5px 8px;border:1px solid #bbb;border-radius:4px}.status{white-space:pre-wrap;background:#fafafa;padding:6px;border-radius:4px;overflow-wrap:anywhere}.list{max-height:180px;overflow:auto;border:1px solid #ddd;border-radius:4px}.item{display:grid;grid-template-columns:minmax(0,1fr) minmax(105px,1fr) auto auto;gap:6px;align-items:center;padding:6px 8px;border-bottom:1px solid #eee}.item:last-child{border-bottom:0}.item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.danger{border-color:#e66;color:#b42318}.primary,.stop{background:pink;border:0}small{color:#666}</style>' +
        '<button class="open"></button><section class="panel" hidden><div class="head"><h3>9、按模板自动上传资质</h3><button class="close">关闭</button></div><div class="message">自动按模板末级类目上传 FCM、FCM DoC。</div><small class="mall"></small><div class="list-title"><b>已保存模板（0）</b></div><div class="list"></div><input class="name field" placeholder="模板名称（仅备注，例如：马克杯）" aria-label="模板名称"><input class="template field" placeholder="资质参考模板SPU，只填数字" aria-label="模板 SPU"><div class="row"><button class="read">读取模板</button><button class="new">新建模板</button></div><div class="status">保存模板时会自动读取两种资质；不需要填写目标 SPU。</div><div class="actions"><button class="save">保存模板</button><button class="enable primary">启用自动上传</button><button class="stop" hidden>停用自动上传</button></div><p>只上传 FCM（132）和 FCM DoC（1208）。已有文件或审核记录跳过；FCM 使用目标商品自己的实拍图。每个末级类目只能配置一个模板。</p><small>每轮完成后6小时再检查，刷新后5秒恢复。版本 ' + VERSION + '</small></section>';
        const $ = s => root.querySelector(s);
        const save = () => localStorage.setItem(key, JSON.stringify(config));
        function emit(message, type = 'detail') { window.dispatchEvent(new CustomEvent('goldabcd-noexe-log-event', { detail: { scriptName: SCRIPT_NAME, phase: 'detail', type, time: Date.now(), endpoint: '商品资质上传', endpointTitle: '商品资质上传', source: 'mallId=' + mall, message } })); }
        function position() { if ($('.panel').hidden) return; const p = panelPosition($('.open').getBoundingClientRect(), $('.panel').offsetWidth, $('.panel').offsetHeight, innerWidth, innerHeight); $('.panel').style.left = p.left + 'px'; $('.panel').style.top = p.top + 'px'; }
        function status(t) { $('.status').textContent = t; position(); }
        function renderList() {
            $('.list-title b').textContent = '已保存模板（' + config.templates.length + '）';
            $('.list').textContent = '';
            if (!config.templates.length) { const e = document.createElement('div'); e.textContent = '暂无模板'; e.style.cssText = 'padding:8px;color:#777;text-align:center'; $('.list').appendChild(e); return; }
            config.templates.forEach(item => {
                const row = document.createElement('div'); row.className = 'item';
                const name = document.createElement('span'); name.textContent = item.name; name.title = item.name;
                const spu = document.createElement('span'); spu.textContent = item.spu; spu.title = item.spu;
                const edit = document.createElement('button'); edit.textContent = '编辑'; edit.disabled = busy || config.enabled; edit.onclick = () => { editingName = item.name; $('.name').value = item.name; $('.template').value = item.spu; };
                const del = document.createElement('button'); del.textContent = '删除'; del.className = 'danger'; del.disabled = busy || config.enabled; del.onclick = () => { if (!confirm('确认删除模板：' + item.name + ' -> ' + item.spu + '？')) return; config.templates = config.templates.filter(x => x.name !== item.name); save(); renderList(); status('已删除模板：' + item.name); };
                row.append(name, spu, edit, del); $('.list').appendChild(row);
            });
        }
        function controls() { $('.open').textContent = '9、按模板自动上传资质（' + (config.enabled ? busy ? '已开启·运行中' : '已开启' : busy ? '正在暂停' : '已关闭') + '）'; $('.enable').hidden = config.enabled; $('.enable').disabled = busy || changed || !config.templates.length; $('.stop').hidden = !config.enabled && !busy; for (const s of ['.save', '.read', '.new', '.name', '.template']) $(s).disabled = busy || changed || config.enabled; }
        function assertContext() { if (mallId() !== mall || changed) throw Error('店铺已切换，请刷新页面后重新开启'); }
        async function request(path, body, write) { assertContext(); const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000); try { const res = await fetch(path, { method: 'POST', credentials: 'include', signal: controller.signal, headers: { accept: '*/*', 'content-type': 'application/json', mallid: mall }, body: JSON.stringify(body) }); if (!res.ok) { const e = Error('HTTP ' + res.status + (write ? '，上传结果不明' : '')); e.retryableRead = !write && [408,429,500,502,503,504].includes(res.status); throw e; } const data = await res.json(); if (!data || data.success !== true) throw Error(data && (data.errorMsg || data.error_msg) || '接口业务响应异常'); return data; } catch (e) { if (!write && (e.name === 'AbortError' || e instanceof TypeError)) e.retryableRead = true; throw e; } finally { clearTimeout(timeout); } }
        const worker = createWorker({ request, assertContext, stopped: () => stopped || leaving, progress: status, log: emit });
        function schedule(ms) { clearTimeout(timer); if (config.enabled && !changed && !leaving) timer = setTimeout(run, ms); }
        async function run() { if (busy || !config.enabled || leaving || changed) return; busy = true; stopped = false; controls(); try { const result = await worker.runMany(config.templates); const msg = '本轮完成：' + result.candidates + ' 个待上传商品，成功 ' + result.success + ' 项，跳过 ' + result.skipped + ' 项。6小时后再检查。'; status(msg); emit(msg); } catch (e) { if (!leaving && !stopped) { if (!e.retryableRead) { config.enabled = false; save(); } status((e.retryableRead ? '读取暂时失败，6小时后重试：' : '已暂停：') + e.message); emit(e.message, 'detail-error'); } } finally { busy = false; controls(); schedule(INTERVAL); } }
        async function readCurrent() { const spu = $('.template').value.trim(); const t = await worker.readTemplate(spu); status('模板类目：' + t.product.name + '（末级 ID ' + t.product.leaf + '）\nFCM：' + t.certs[132].inspectReportFiles.length + ' 份；FCM DoC：' + Object.values(t.certs[1208].multiLangProductCertFileMap).flat().length + ' 份'); return t; }
        $('.open').onclick = () => { $('.panel').hidden = !$('.panel').hidden; position(); }; $('.close').onclick = () => { $('.panel').hidden = true; }; $('.new').onclick = () => { editingName = ''; $('.name').value = ''; $('.template').value = ''; status('请输入模板名称和模板 SPU'); };
        $('.read').onclick = async () => { if (busy) return; busy = true; controls(); try { await readCurrent(); } catch (e) { status('读取模板失败：' + e.message); } finally { busy = false; controls(); } };
        $('.save').onclick = async () => { if (busy) return; const name = normalizeTemplateName($('.name').value, $('.template').value); const spu = $('.template').value.trim(); if (!safeSpu(spu)) { status('模板 SPU 无效'); return; } busy = true; controls(); try { const t = await worker.readTemplate(spu); const duplicate = config.templates.find(item => item.name !== editingName && item.spu === spu); if (duplicate) throw Error('该模板 SPU 已保存为：' + duplicate.name); config.templates = config.templates.filter(item => item.name !== editingName && item.name !== name); config.templates.push({ name, spu }); editingName = name; save(); renderList(); status('已保存模板：' + name + ' → ' + t.product.name + '（末级 ID ' + t.product.leaf + '）'); } catch (e) { status('保存模板失败：' + e.message); } finally { busy = false; controls(); } };
        $('.enable').onclick = () => { if (!config.templates.length) { status('请先保存至少一个模板'); return; } config.enabled = true; stopped = false; save(); run(); }; $('.stop').onclick = () => { stopped = true; config.enabled = false; clearTimeout(timer); save(); status('已停用；已发出的请求等待返回，不再提交下一项。'); controls(); };
        window.addEventListener('resize', position); window.addEventListener('scroll', position, true); window.addEventListener('pagehide', () => { leaving = true; stopped = true; clearTimeout(timer); }); setInterval(() => { if (!changed && mallId() !== mall) { changed = true; stopped = true; config.enabled = false; clearTimeout(timer); save(); status('店铺已切换，请刷新页面。'); controls(); } }, 1000);
        $('.mall').textContent = '当前店铺：' + mall; renderList(); if (raw && raw.version !== 3) status('已升级为多模板模式，旧模板已保留并备份。'); controls(); if (config.enabled) schedule(5000);
    }
    if (typeof module === 'object' && module.exports) module.exports = { normalizeConfig, normalizeTemplates, parseList, certDetail, pending, hasFiles, templateCert, uploadBody, matchesUpload, createWorker, panelPosition };
    else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
