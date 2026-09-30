// ==UserScript==
// @name         上新生命周期-8-按类目自动设置到货区域 自改版
// @namespace    https://www.goldabcd.com/
// @description  按末级类目自动将期望到货区域设为广东或义乌，按店铺保存规则，无需EXE
// @author       TonyTonyYang / Frank-jpeg
// @match        https://agentseller.temu.com/newon/product-select*
// @version      2026.0930.2
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-8-area.user.js
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-8-area.user.js
// ==/UserScript==

(function () {
    'use strict';
    const VERSION = '2026.0930.2';
    const SCRIPT_NAME = '上新生命周期-8-按类目自动设置到货区域';
    const STORAGE_PREFIX = 'goldabcd_category_area_v1:';
    const API = 'https://agentseller.temu.com/mms/turbo/supplier/pick/out/config/';
    const AREAS = { 1: '广东', 2: '义乌' };

    function id(value) {
        if (typeof value === 'number' && !Number.isSafeInteger(value)) return '';
        return typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
    }

    function normalizeRules(value) {
        const rules = {};
        for (const [key, rule] of Object.entries(value || {})) {
            if (!/^\d+$/.test(key) || !rule || ![1, 2].includes(Number(rule.area))) continue;
            rules[key] = { name: String(rule.name || key), parent: String(rule.parent || ''), area: Number(rule.area), spu: id(rule.spu), label: String(rule.label || '') };
        }
        return rules;
    }
    function normalizeSettings(value) {
        let rules = {};
        const legacy = value && value.schemaVersion !== 2 && Array.isArray(value.templates);
        if (legacy) {
            for (const template of value.templates) Object.assign(rules, normalizeRules(template && template.rules));
            const selected = value.templates.find(template => template && template.name === value.activeTemplate);
            if (selected) Object.assign(rules, normalizeRules(selected.rules));
        } else rules = normalizeRules(value && value.rules);
        return { schemaVersion: 2, enabled: !!(!legacy && value && value.enabled === true && Object.keys(rules).length), rules };
    }

    async function lookupCategory(request, value) {
        const spu = id(value);
        if (!/^[1-9]\d*$/.test(spu) || !Number.isSafeInteger(Number(spu))) throw new Error('请输入有效商品 SPU（纯数字，不是 SKC）');
        const data = await request('/api/kiana/mms/robin/searchForChainSupplier', {
            pageNum: 1, pageSize: 50, supplierTodoTypeList: [], productSpuIdList: [Number(spu)]
        }, false);
        const rows = data && data.result && data.result.dataList;
        if (!Array.isArray(rows)) throw new Error('查询结果缺少商品列表');
        if (!rows.length) throw new Error('当前店铺未找到此 SPU，请确认编号');
        if (rows.some(row => id(row.productId) !== spu)) throw new Error('接口返回的 SPU 不匹配，未添加类目');
        const cats = rows.map(row => {
            const path = Array.isArray(row.catIdList) ? row.catIdList : [];
            const catId = id(path[path.length - 1]);
            if (!/^[1-9]\d*$/.test(catId)) throw new Error('商品没有有效末级类目 ID');
            const names = Array.isArray(row.catNameList) ? row.catNameList : [];
            // 名称字段可能缺失；不能把商品标题或备注冒充平台类目名。
            const name = String(names.length === path.length ? names[names.length - 1] || '' : '');
            return { id: catId, spu, name, parent: names.length === path.length ? names.slice(0, -1).join(' > ') : '' };
        });
        if (cats.some(cat => cat.id !== cats[0].id)) throw new Error('同一 SPU 返回多个末级类目，未添加');
        return cats[0];
    }

    function uniqueItems(items) {
        const found = new Map();
        const conflicts = new Set();
        for (const item of items) {
            const key = id(item.productSkcId);
            if (!key) continue;
            const previous = found.get(key);
            if (previous && [id(previous.leafCatId), previous.expectReceiveAreaConfigType, previous.canEditExpectReceiveArea].join('|') !==
                [id(item.leafCatId), item.expectReceiveAreaConfigType, item.canEditExpectReceiveArea].join('|')) conflicts.add(key);
            if (conflicts.has(key)) found.delete(key);
            else found.set(key, item);
        }
        return [...found.values()];
    }

    function buildPlan(items, rules) {
        const groups = { 1: [], 2: [] };
        for (const item of uniqueItems(items)) {
            const rule = rules[id(item.leafCatId)];
            const target = rule && Number(rule.area);
            if (![1, 2].includes(target) || item.canEditExpectReceiveArea !== true) continue;
            if (![1, 2, 3].includes(Number(item.expectReceiveAreaConfigType))) continue;
            if (Number(item.expectReceiveAreaConfigType) === target) continue;
            groups[target].push(item);
        }
        return groups;
    }

    function categoryList(items, rules) {
        const cats = new Map(Object.entries(rules).map(([key, rule]) => [key, { id: key, name: rule.name, parent: rule.parent || '', count: 0 }]));
        for (const item of uniqueItems(items)) {
            const key = id(item.leafCatId);
            if (!/^\d+$/.test(key)) continue;
            if (!cats.has(key)) cats.set(key, { id: key, name: String(item.leafCatName || key), parent: String(item.cat4Name || ''), count: 0 });
            const cat = cats.get(key);
            if (item.leafCatName) cat.name = String(item.leafCatName);
            if (item.cat4Name) cat.parent = String(item.cat4Name);
            cat.count++;
        }
        return [...cats.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id));
    }

    function createWorker(env) {
        function check() {
            env.assertContext();
            if (env.stopped()) throw new Error('已停用');
        }
        async function scan(types = [1, 2, 3]) {
            const items = [];
            let total = 0;
            const seen = new Set();
            for (let page = 1; page <= 200; page++) {
                check();
                const data = await env.request('pageQuerySkcPickOutConfig', {
                    pageNumber: page, pageSize: 50, expectReceiveAreaConfigTypeList: types
                }, false);
                check();
                const list = data.result && data.result.items;
                if (!Array.isArray(list)) throw new Error('查询结果缺少商品列表');
                if (!list.length) return { items, total, truncated: total > items.length };
                total = Number(data.result.total);
                if (!Number.isFinite(total) || total < 0) throw new Error('查询结果缺少有效总数');
                const signature = JSON.stringify(list.map(item => id(item.productSkcId)));
                if (seen.has(signature)) throw new Error('查询重复返回同一页，请稍后重新启用');
                seen.add(signature);
                items.push(...list);
                env.progress('读取第 ' + page + ' 页，已查询 ' + items.length + ' 个 SKC');
                if (page * 50 >= total) return { items, total, truncated: false };
                await env.sleep(300);
            }
            return { items, total, truncated: total > items.length };
        }
        async function apply(items, rules) {
            const plan = buildPlan(items, rules);
            const result = { total: plan[1].length + plan[2].length, success: 0, failed: 0, unknown: 0, error: '' };
            try {
                for (const area of [1, 2]) {
                    for (let start = 0; start < plan[area].length; start += 50) {
                        check();
                        const batch = plan[area].slice(start, start + 50);
                        env.progress('正在设置' + AREAS[area] + '：本批 ' + batch.length + ' 个 SKC');
                        try {
                            await env.request('editExpectReceiveArea', {
                                exceptReceiveAreaConfigType: area, productSkcIdList: batch.map(item => id(item.productSkcId))
                            }, true);
                            result.success += batch.length;
                            env.log('设置' + AREAS[area] + '接口成功：' + batch.length + ' 个 SKC；' + batch.map(item => id(item.productSkcId)).join(','));
                        } catch (error) {
                            if (error.businessFailure) result.failed += batch.length;
                            else result.unknown += batch.length;
                            throw error;
                        }
                        await env.sleep(2000);
                    }
                }
            } catch (error) { result.error = error.message; }
            return result;
        }
        return { scan, apply };
    }

    if (typeof module === 'object' && module.exports) {
        module.exports = { lookupCategory, normalizeSettings, uniqueItems, buildPlan, categoryList, createWorker };
        return;
    }

    function init() {
        if (document.getElementById('goldabcd-category-area-host')) return;
        const mallId = localStorage.getItem('agentseller-mall-info-id');
        const storageKey = STORAGE_PREFIX + mallId;
        let settings;
        let migrated = false;
        try {
            const raw = localStorage.getItem(storageKey);
            const previous = JSON.parse(raw || 'null');
            migrated = !!(previous && previous.schemaVersion !== 2 && Array.isArray(previous.templates));
            if (migrated && !localStorage.getItem(storageKey + ':before-v2')) localStorage.setItem(storageKey + ':before-v2', raw);
            settings = normalizeSettings(previous);
            if (migrated) localStorage.setItem(storageKey, JSON.stringify(settings));
        }
        catch (_) { settings = normalizeSettings(null); }
        let enabled = false;
        let busy = false;
        let stopped = false;
        let timer = null;
        let draft = null;
        let editingId = '';
        let dirty = false;
        const host = document.createElement('div');
        host.id = 'goldabcd-category-area-host';
        host.dataset.version = VERSION;
        document.body.appendChild(host);
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `
            <style>
                :host{all:initial;font:14px/1.5 "Microsoft YaHei",sans-serif;color:#222}*{box-sizing:border-box}
                button,input,select{font:inherit}button{cursor:pointer;border:1px solid #ccc;border-radius:5px;padding:7px 12px;background:white;color:#222}button:disabled{opacity:.45;cursor:default}
                .open{position:absolute;left:260px;top:460px;z-index:9999;background:#ffe7bd;border:0;padding:10px;border-radius:0}
                .panel{position:fixed;top:10vh;right:22px;width:min(700px,calc(100vw - 30px));max-height:82vh;overflow:auto;z-index:2147483645;background:white;border:1px solid #ddd;border-radius:10px;padding:18px;box-shadow:0 12px 40px #0003}
                [hidden]{display:none!important}.head,.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.head{justify-content:space-between}h3{font-size:17px;margin:0}.row{margin:12px 0}.muted{font-size:12px;color:#666}.primary{background:#246e48;color:white;border-color:#246e48}
                input,select{border:1px solid #ccc;border-radius:4px;padding:6px}input{width:100%}.status{white-space:pre-wrap;background:#f2f7f4;padding:10px;margin:12px 0;border-radius:5px}.table{max-height:42vh;overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:8px;text-align:left;border-bottom:1px solid #eee}th{position:sticky;top:0;background:#fafafa}td:first-child{overflow-wrap:anywhere}
            </style>
            <button class="open">8、按类目自动设置到货区域（已关闭）</button>
            <section class="panel" hidden>
                <div class="head"><h3>8、按类目自动设置到货区域</h3><button class="close">收起</button></div>
                <div class="mall muted"></div>
                <div class="row"><strong class="saved-count">已保存规则</strong><span class="muted">全部规则一起运行</span></div>
                <div class="table"><table><thead><tr><th>备注 / 商品 SPU</th><th>末级类目</th><th>到货区域</th><th>操作</th></tr></thead><tbody></tbody></table></div>
                <div class="row"><input class="template-name" placeholder="备注（可选，例如帽子）" aria-label="备注"></div>
                <div class="row"><input class="spu" placeholder="代表商品 SPU，纯数字" aria-label="代表商品 SPU"><button class="load">查询类目</button></div>
                <div class="category muted">填写代表商品 SPU 后查询，只查这个商品。</div>
                <div class="row"><label>到货区域 <select class="area" aria-label="到货区域"><option value="1">广东</option><option value="2">义乌</option></select></label><button class="save-template">保存规则</button><button class="new">清空 / 新增</button></div>
                <div class="row"><button class="enable primary">开始全部规则</button><button class="stop" disabled>暂停</button></div>
                <div class="muted">代表 SPU 只用于确定类目；运行后处理该类目的商品。未配置的类目不修改。每轮结束 1 分钟自动检查，刷新恢复开关。</div>
                <div class="status" role="status" aria-live="polite">输入 SPU → 查询类目 → 选择到货区域 → 保存规则。可添加多条，再统一开始。</div>
                <div class="muted">已符合规则或不可编辑的商品会跳过。更改规则请先暂停；这里只修改期望到货区域，不代表实际仓库分配。</div>
            </section>`;
        const $ = selector => root.querySelector(selector);
        $('.mall').textContent = '当前店铺：' + (mallId || '未识别');
        function status(text) { $('.status').textContent = text; }
        function log(message, type = 'detail') {
            window.dispatchEvent(new CustomEvent('goldabcd-noexe-log-event', { detail: {
                scriptName: SCRIPT_NAME, phase: 'detail', type, time: Date.now(),
                endpoint: '按类目设置到货区域', endpointTitle: '按类目设置到货区域', source: 'mallId=' + mallId, message
            } }));
        }
        function assertContext() {
            if (!mallId || localStorage.getItem('agentseller-mall-info-id') !== mallId) throw new Error('店铺已变化，请刷新页面');
            if (!location.pathname.startsWith('/newon/product-select')) throw new Error('已离开上新生命周期页面');
        }
        function save() { localStorage.setItem(storageKey, JSON.stringify(settings)); }
        function controls() {
            $('.load').disabled = enabled || busy;
            $('.enable').disabled = enabled || busy || dirty || !Object.keys(settings.rules).length;
            for (const selector of ['.spu', '.area', '.template-name', '.save-template', '.new']) $(selector).disabled = enabled || busy;
            $('.stop').disabled = !enabled && !busy;
            $('.open').textContent = '8、按类目自动设置到货区域（' + (enabled ? (busy ? '已开启·运行中' : '已开启') : busy ? (stopped ? '已关闭·正在暂停' : '已关闭·读取类目') : '已关闭') + '）';
            $('.open').style.background = enabled ? '#d8f3dc' : '#ffe7bd';
            root.querySelectorAll('tbody button').forEach(button => { button.disabled = enabled || busy; });
            $('.save-template').disabled = enabled || busy || !draft;
        }
        function clearEditor() {
            draft = null; editingId = ''; dirty = false;
            $('.spu').value = ''; $('.template-name').value = ''; $('.area').value = '1';
            $('.category').textContent = '填写代表商品 SPU 后查询，只查这个商品。';
            controls();
        }
        function showCategory() {
            $('.category').textContent = draft ? (draft.name || '接口未返回类目名称') + ' · ID ' + draft.id +
                (draft.parent ? ' · ' + draft.parent : '') : '请查询商品类目';
        }
        function render() {
            const body = $('tbody'); body.replaceChildren();
            $('.saved-count').textContent = '已保存规则（' + Object.keys(settings.rules).length + '）';
            for (const [catId, rule] of Object.entries(settings.rules)) {
                const tr = document.createElement('tr');
                for (const text of [ (rule.label || rule.name) + '\nSPU：' + (rule.spu || '旧规则未记录'),
                    rule.name + '\nID ' + catId + (rule.parent ? '\n' + rule.parent : ''), AREAS[rule.area]]) {
                    const td = document.createElement('td'); td.textContent = text; td.style.whiteSpace = 'pre-wrap'; tr.appendChild(td);
                }
                const actions = document.createElement('td');
                const edit = document.createElement('button'); edit.textContent = '编辑';
                edit.addEventListener('click', () => {
                    if (enabled || busy) return;
                    draft = { id: catId, name: rule.name, parent: rule.parent, spu: rule.spu }; editingId = catId; dirty = true;
                    $('.spu').value = rule.spu; $('.template-name').value = rule.label; $('.area').value = String(rule.area);
                    showCategory(); controls(); status('编辑后点击“保存规则”。');
                });
                const remove = document.createElement('button'); remove.textContent = '删除';
                remove.addEventListener('click', () => {
                    if (enabled || busy) return;
                    const next = { ...settings, rules: { ...settings.rules } }; delete next.rules[catId];
                    try { assertContext(); localStorage.setItem(storageKey, JSON.stringify(next)); settings = next; clearEditor(); render(); status('规则已删除。'); }
                    catch (error) { status('保存失败：' + error.message); }
                });
                actions.append(edit, remove); tr.append(actions); body.appendChild(tr);
            }
            controls();
        }
        async function request(endpoint, body, write) {
            assertContext();
            const controller = new AbortController();
            const timeout = write ? null : setTimeout(() => controller.abort(), 30000);
            try {
                const response = await fetch(endpoint.startsWith('/') ? 'https://agentseller.temu.com' + endpoint : API + endpoint, { method: 'POST', credentials: 'same-origin',
                    headers: { 'content-type': 'application/json', mallid: mallId }, body: JSON.stringify(body),
                    ...(write ? {} : { signal: controller.signal }) });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const data = await response.json();
                if (!data || data.success !== true) {
                    const error = new Error(String(data && (data.errorMsg || data.error_msg || data.message) || '接口未确认成功'));
                    error.businessFailure = data && data.success === false;
                    throw error;
                }
                return data;
            } finally { if (timeout) clearTimeout(timeout); }
        }
        const worker = createWorker({ request, assertContext, stopped: () => stopped,
            sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), progress: status, log });
        function pause(error) {
            enabled = false;
            settings.enabled = false;
            try { save(); } catch (_) { /* 仍停用当前页面。 */ }
            status(stopped ? '已停用。' : '已暂停：' + error.message + '\n处理后可重新启用。');
            if (!stopped) log(error.message, 'error');
        }
        async function cycle() {
            timer = null;
            if (!enabled || busy) return;
            busy = true; controls();
            let total = 0, success = 0;
            const warnings = [];
            try {
                // 每个方向只查询不在目标区域的商品；成功修改的商品下一轮退出来源集合。
                for (const area of [1, 2]) {
                    if (stopped) break;
                    const rules = Object.fromEntries(Object.entries(settings.rules).filter(([, rule]) => rule.area === area));
                    if (!Object.keys(rules).length) continue;
                    const scanned = await worker.scan([1, 2, 3].filter(value => value !== area));
                    const result = await worker.apply(scanned.items, rules);
                    total += result.total; success += result.success;
                    if (scanned.truncated) {
                        const warning = AREAS[area] + '方向：待筛选 ' + scanned.total + ' 个，本轮最多查询 10000 个；' +
                            (result.success ? '已改商品将在下一轮退出查询，继续处理后续数据。' : '窗口内没有可推进商品，仍有未覆盖数据，不能判定全部完成。');
                        warnings.push(warning); log(warning);
                    }
                    if (result.error && !stopped) throw new Error(result.error + '；失败 ' + result.failed + '，结果不明 ' + result.unknown);
                }
                const message = (stopped ? '已暂停。\n' : '') + '全部规则：本轮需修改 ' + total + ' 个 SKC，接口成功 ' + success + ' 个。';
                status(message + (warnings.length ? '\n' + warnings.join('\n') : ''));
                log(message);
            } catch (error) { pause(error); }
            finally {
                busy = false; controls();
                if (enabled) {
                    status($('.status').textContent + '\n已开启，1 分钟后再次自动检查。');
                    timer = setTimeout(cycle, 60000);
                }
            }
        }
        $('.new').addEventListener('click', () => { clearEditor(); status('填写代表商品 SPU，查询类目后选择区域并保存。'); });
        $('.save-template').addEventListener('click', () => {
            if (enabled || busy || !draft) return;
            const rules = { ...settings.rules };
            if (editingId && editingId !== draft.id) delete rules[editingId];
            const replaced = !!rules[draft.id];
            rules[draft.id] = { name: draft.name || ('类目 ID ' + draft.id), parent: draft.parent, spu: draft.spu,
                label: $('.template-name').value.trim(), area: Number($('.area').value) };
            const next = { schemaVersion: 2, enabled: false, rules };
            try {
                assertContext(); localStorage.setItem(storageKey, JSON.stringify(next)); settings = next;
                clearEditor(); render(); status((replaced ? '同一类目的规则已更新。' : '规则已保存。') + '可以继续添加，或开始全部规则。');
            } catch (error) { status('保存失败：' + error.message); }
        });
        $('.open').addEventListener('click', () => { $('.panel').hidden = !$('.panel').hidden; });
        $('.close').addEventListener('click', () => { $('.panel').hidden = true; });
        $('.spu').addEventListener('input', () => { draft = null; dirty = true; showCategory(); controls(); });
        for (const selector of ['.template-name', '.area']) $(selector).addEventListener('input', () => { dirty = true; controls(); });
        $('.load').addEventListener('click', async () => {
            if (enabled || busy) return;
            stopped = false; busy = true; draft = null; dirty = true; controls();
            status('正在查询这个 SPU 的类目…');
            try {
                const found = await lookupCategory(request, $('.spu').value);
                assertContext();
                if (stopped) throw new Error('已停止查询');
                draft = found; showCategory();
                status(found.name ? '类目已查到，请选择到货区域并保存。' : '已查到类目 ID，但接口未返回名称；可填写备注后保存，匹配仍使用该 ID。');
            } catch (error) { showCategory(); status(error.message); }
            finally { busy = false; controls(); }
        });
        $('.enable').addEventListener('click', () => {
            if (enabled || busy) return;
            try {
                assertContext();
                if (dirty || !Object.keys(settings.rules).length) throw new Error('请先保存规则或清空未保存的编辑');
                settings.enabled = true;
                save();
                enabled = true; stopped = false;
                cycle();
            } catch (error) { settings.enabled = false; status(error.message); }
        });
        $('.stop').addEventListener('click', () => {
            stopped = true; enabled = false; settings.enabled = false;
            if (timer !== null) clearTimeout(timer);
            timer = null;
            try { save(); } catch (error) { log('保存停用状态失败：' + error.message, 'error'); }
            status(busy ? '正在暂停，等待当前请求返回，不再提交下一批。' : '已暂停自动设置。');
            controls();
        });
        window.addEventListener('beforeunload', event => {
            if (busy) { event.preventDefault(); event.returnValue = ''; }
        });
        render();
        if (migrated) status('旧模板已合并为规则列表，当前已暂停。同类目冲突优先保留原选中模板；请核对区域后开始。');
        if (settings.enabled) {
            enabled = true;
            status('已恢复开启状态，5 秒后按保存的类目规则自动设置。');
            timer = setTimeout(cycle, 5000);
            controls();
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
