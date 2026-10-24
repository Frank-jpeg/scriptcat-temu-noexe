// ==UserScript==
// @name         上新生命周期-9-按模板自动上传资质
// @namespace    https://www.goldabcd.com/
// @description  按模板SPU末级类目自动上传FCM和FCM DoC资质，无需本地文件
// @author       Frank-jpeg
// @match        https://agentseller.temu.com/newon/product-select*
// @version      2026.1024.1
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-9-qualification.user.js
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-9-qualification.user.js
// ==/UserScript==

(function () {
    'use strict';
    const VERSION = '2026.1024.1';
    const SCRIPT_NAME = '上新生命周期-9-按模板自动上传资质';
    const PREFIX = 'goldabcd_qualification_v1:';
    const API = 'https://agentseller.temu.com';
    const CERTS = { fcm: { type: 132, name: 'FCM', label: '食品接触材料检测报告' }, doc: { type: 1208, name: 'FCM DoC', label: '欧盟食品接触材料符合性声明' } };
    const id = v => (typeof v === 'number' || typeof v === 'string') ? String(v).trim() : '';
    const safeSpu = v => /^[1-9]\d{4,20}$/.test(id(v));
    const uniq = a => [...new Set((a || []).map(id).filter(safeSpu))];
    const clone = v => JSON.parse(JSON.stringify(v));
    function mallId() { return localStorage.getItem('agentseller-mall-info-id') || ''; }
    function emit(message, type = 'detail') {
        window.dispatchEvent(new CustomEvent('goldabcd-noexe-log-event', { detail: { scriptName: SCRIPT_NAME, phase: 'detail', type, time: Date.now(), endpoint: '商品资质上传', endpointTitle: '商品资质上传', source: 'mallId=' + mallId(), message } }));
    }
    async function post(path, body) {
        const res = await fetch(API + path, { method: 'POST', credentials: 'include', headers: { accept: '*/*', 'content-type': 'application/json', mallid: mallId() }, body: JSON.stringify(body || {}) });
        let data; try { data = await res.json(); } catch (_) { throw new Error('接口响应不是 JSON（HTTP ' + res.status + '）'); }
        if (!res.ok || data.success === false) throw new Error(data.error_msg || data.errorMsg || data.message || ('HTTP ' + res.status));
        return data;
    }
    function walk(value, fn, seen = new Set()) {
        if (!value || typeof value !== 'object' || seen.has(value)) return; seen.add(value); fn(value);
        if (Array.isArray(value)) value.forEach(v => walk(v, fn, seen)); else Object.values(value).forEach(v => walk(v, fn, seen));
    }
    function findArrays(root, keys) { const out = []; walk(root, obj => { for (const k of keys) if (Array.isArray(obj[k]) && obj[k].length) out.push(obj[k]); }); return out; }
    function fileRows(detail) {
        const rows = []; walk(detail, obj => {
            for (const key of ['inspectReportFiles', 'inspect_report_files', 'productCertFileList', 'product_cert_file_list', 'fileList', 'file_list']) if (Array.isArray(obj[key])) rows.push(...obj[key]);
        });
        const seen = new Set(); return rows.map(x => ({ fileName: x.fileName || x.file_name || x.name, fileUrl: x.fileUrl || x.file_url || x.original_file_url || x.fileUrlWithSign })).filter(x => x.fileName && x.fileUrl && !seen.has(x.fileUrl) && seen.add(x.fileUrl));
    }
    function valueOf(detail, names) { let found; walk(detail, obj => { if (found !== undefined) return; for (const n of names) if (obj[n] !== undefined && obj[n] !== null) { found = obj[n]; break; } }); return found; }
    function normalizeProduct(data) {
        const rows = data && data.result && (data.result.productWithCertList || data.result.product_with_cert_list || data.result.productList || data.result.product_list) || [];
        const row = rows[0] || {}; const base = row.product_base_info || row.productBaseInfo || row;
        return { id: id(base.product_id || base.productId || row.product_id), name: base.leaf_category_name || base.leafCategoryName || '', cateIds: (base.cate_ids || base.cateIds || row.cate_ids || []).map(id), image: base.main_image_url || base.mainImageUrl || row.main_image_url || '', cert: row.product_cert_info_list || row.productCertInfoList || [] };
    }
    async function product(spu, certType) {
        const data = await post('/mms/arbok/product_cert/batch_upload/product_list', { page: 1, page_size: 10, cert_type: certType, product_ids: [spu] });
        const p = normalizeProduct(data); if (p.id !== spu || !p.cateIds.length) throw new Error('SPU ' + spu + ' 未返回有效类目'); return p;
    }
    async function detail(spu, certType) {
        const bodies = [{ product_id: spu, cert_type: certType }, { productId: Number(spu), certType }];
        let last; for (const body of bodies) { try { const data = await post('/mms/arbok/product_cert/query/detail', body); if (data && data.result) return data.result; } catch (e) { last = e; } }
        throw last || new Error('读取资质详情失败');
    }
    function certInfo(detail, type) {
        let result = { certType: type, files: [], docFiles: [], selected: undefined, fileUploadType: undefined, doc: undefined, energy: {} };
        result.files = fileRows(detail);
        result.selected = valueOf(detail, ['selectedCheckItems', 'selected_check_items']);
        result.fileUploadType = valueOf(detail, ['fileUploadType', 'file_upload_type']);
        result.doc = valueOf(detail, ['docPdfContentReq', 'doc_pdf_content_req']);
        const map = valueOf(detail, ['multiLangProductCertFileMap', 'multi_lang_product_cert_file_map']);
        result.docFiles = map && (map.en || map['en-US']) || [];
        result.energy = valueOf(detail, ['energyLabel', 'energy_label']) || {};
        return result;
    }
    function realPictures(p) {
        const urls = []; findArrays(p, ['realPictures', 'real_pictures', 'realPictureList', 'real_picture_list', 'imageList', 'image_list']).forEach(list => list.forEach(x => { const u = x && (x.imageUrl || x.image_url || x.url); if (u) urls.push(u); }));
        if (!urls.length && p.image) urls.push(p.image); return [...new Set(urls)].slice(0, 20).map(imageUrl => ({ imageUrl }));
    }
    function uploadBody(spu, p, c, kind) {
        const ext = { hitUploadGray: true, hitUploadMultiLanguageGary: true, marketServiceAutoSendAudit: false, hitMerchantEditClpGray: true };
        if (kind === 'fcm') return { productId: Number(spu), realPictures: realPictures(p), extendedInfo: ext, productCatCertReqList: [{ certType: 132, docPdfContentReq: c.doc, energyLabel: c.energy || {}, inspectReportFiles: c.files.map(x => ({ fileName: x.fileName, fileUrl: x.fileUrl })) }] };
        const files = c.docFiles.length ? c.docFiles : c.files;
        return { productId: Number(spu), extendedInfo: ext, productCatCertReqList: [{ certType: 1208, fileUploadType: c.fileUploadType || 1, docPdfContentReq: c.doc, multiLangProductCertFileMap: { en: files.map(x => ({ fileName: x.fileName || x.file_name, fileUrl: x.fileUrl || x.file_url })) }, selectedCheckItems: c.selected || {}, energyLabel: c.energy || {} }] };
    }
    function normalizeConfig(raw) { raw = raw && typeof raw === 'object' ? raw : {}; return { version: 1, template: safeSpu(raw.template) ? raw.template : '48477498749', targets: uniq(raw.targets), enabled: raw.enabled === true }; }
    function init() {
        if (document.getElementById('goldabcd-qualification-host')) return;
        const key = PREFIX + mallId(); let config; try { config = normalizeConfig(JSON.parse(localStorage.getItem(key) || 'null')); } catch (_) { config = normalizeConfig(null); }
        let busy = false, timer = null, stopped = false;
        const host = document.createElement('div'); host.id = 'goldabcd-qualification-host'; host.dataset.version = VERSION; document.body.appendChild(host); const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = ` <style>:host{all:initial;font:13px/1.45 Arial,"Microsoft YaHei",sans-serif;color:#111}*{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer;border:1px solid #bbb;border-radius:4px;padding:3px 8px;background:#fff}button:disabled{opacity:.5}.open{position:absolute;left:260px;top:520px;z-index:9999;background:pink;border:0;padding:10px}.panel{position:absolute;top:562px;left:260px;width:450px;max-height:calc(100vh - 30px);overflow:auto;z-index:10000;background:#fff;border:1px solid #ff8fb3;border-radius:6px;padding:10px;box-shadow:0 6px 18px #0002}[hidden]{display:none!important}.head,.row{display:flex;gap:6px;align-items:center}.head{justify-content:space-between}h3{margin:0;font-size:13px}.row{margin:7px 0}.template{flex:1}.targets{width:100%;height:75px;resize:vertical;border:1px solid #bbb;border-radius:4px;padding:5px}.primary,.stop{background:pink;border:0}.status{white-space:pre-wrap;background:#fafafa;padding:6px;border-radius:4px}.table{border:1px solid #ddd;border-radius:4px;max-height:120px;overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}td,th{padding:4px;border-bottom:1px solid #eee;text-align:left}small{color:#666}</style> <button class="open"></button><section class="panel" hidden><div class="head"><h3>9、按模板自动上传资质</h3><button class="close">收起</button></div><small class="mall"></small><div class="row"><input class="template" placeholder="模板 SPU" aria-label="模板 SPU"><button class="check">读取模板</button></div><div class="status">只上传 FCM、FCM DoC；使用模板文件，不需要本地上传。</div><div class="row"><textarea class="targets" placeholder="目标 SPU，一行一个或空格分隔" aria-label="目标 SPU"></textarea></div><div class="row"><button class="save">保存配置</button><button class="enable primary">开启自动上传</button><button class="stop" hidden>暂停</button></div><div class="table"><table><thead><tr><th>资质</th><th>状态</th><th>说明</th></tr></thead><tbody><tr><td>FCM</td><td class="fcm">未读取</td><td>132</td></tr><tr><td>FCM DoC</td><td class="doc">未读取</td><td>1208</td></tr></tbody></table></div><details><summary>使用说明</summary><p>模板按末级类目匹配目标商品；目标商品已上传的资质会跳过。开启后每轮结束 6 小时再检查。</p></details></section>`;
        const $ = s => root.querySelector(s); $('.mall').textContent = '当前店铺：' + (mallId() || '未识别');
        function save() { localStorage.setItem(key, JSON.stringify(config)); }
        function status(t) { $('.status').textContent = t; }
        function controls() { $('.open').textContent = '9、按模板自动上传资质（' + (config.enabled ? (busy ? '已开启·运行中' : '已开启') : '已关闭') + ')'; $('.enable').hidden = config.enabled || busy; $('.stop').hidden = !config.enabled && !busy; $('.save').disabled = config.enabled || busy; $('.check').disabled = config.enabled || busy; $('.template').disabled = config.enabled || busy; $('.targets').disabled = config.enabled || busy; $('.enable').disabled = busy || !safeSpu(config.template) || !config.targets.length; }
        function setRows(fcm, doc) { $('.fcm').textContent = fcm; $('.doc').textContent = doc; }
        async function runOnce() { if (busy) return; busy = true; stopped = false; controls(); try { const template = await product(config.template, 132); const targetSpus = config.targets; const tmplDetails = {}; for (const kind of ['fcm', 'doc']) { const cert = CERTS[kind]; const d = await detail(config.template, cert.type); tmplDetails[kind] = certInfo(d, cert.type); if (kind === 'fcm' && !tmplDetails[kind].files.length) throw new Error('模板没有 FCM 文件'); if (kind === 'doc' && !(tmplDetails[kind].docFiles.length || tmplDetails[kind].files.length)) throw new Error('模板没有 FCM DoC 文件'); setRows(kind === 'fcm' ? '已读取' : $('.fcm').textContent, kind === 'doc' ? '已读取' : $('.doc').textContent); } let ok = 0, skip = 0; for (const spu of targetSpus) { if (stopped) break; const target = await product(spu, 132); const targetDoc = await product(spu, 1208); target.cert = (target.cert || []).concat(targetDoc.cert || []); if (target.cateIds[target.cateIds.length - 1] !== template.cateIds[template.cateIds.length - 1]) { emit('SPU(' + spu + ') 与模板末级类目不一致，跳过', 'detail-error'); skip += 1; continue; } for (const kind of ['fcm', 'doc']) { if (stopped) break; const type = CERTS[kind].type; const existing = (target.cert || []).find(x => Number(x.cert_type || x.certType) === type); if (existing && [4, 6].includes(Number(existing.upload_status || existing.uploadStatus))) { emit('SPU(' + spu + ') 的' + CERTS[kind].name + '已存在，跳过'); skip += 1; continue; } await post('/bg-lich-mms/cert/product/upload', uploadBody(spu, target, tmplDetails[kind], kind)); emit('SPU(' + spu + ') ' + CERTS[kind].name + '上传成功'); ok += 1; } } status('本轮完成：成功 ' + ok + ' 项，跳过 ' + skip + ' 项'); } catch (e) { status('运行失败：' + e.message); emit('资质上传失败：' + e.message, 'detail-error'); config.enabled = false; save(); } finally { busy = false; controls(); } }
        $('.open').onclick = () => { $('.panel').hidden = !$('.panel').hidden; }; $('.close').onclick = () => { $('.panel').hidden = true; }; $('.save').onclick = () => { const t = $('.template').value.trim(); const targets = uniq($('.targets').value.split(/[\s,，]+/)); if (!safeSpu(t)) return status('模板 SPU 无效'); if (!targets.length) return status('请填写目标 SPU'); config.template = t; config.targets = targets; save(); status('配置已保存，可开启自动上传'); controls(); }; $('.check').onclick = async () => { try { const p = await product($('.template').value.trim(), 132); status('模板类目：' + p.name + '（末级 ID ' + p.cateIds.at(-1) + ')'); } catch (e) { status('读取模板失败：' + e.message); } }; $('.enable').onclick = () => { config.enabled = true; save(); runOnce(); timer = setInterval(runOnce, 6 * 60 * 60 * 1000); }; $('.stop').onclick = () => { stopped = true; config.enabled = false; save(); clearInterval(timer); status('已暂停'); controls(); }; $('.template').value = config.template; $('.targets').value = config.targets.join('\n'); controls(); if (config.enabled) setTimeout(runOnce, 5000);
    }
    if (typeof module === 'object' && module.exports) module.exports = { normalizeProduct, certInfo, uploadBody }; else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();


