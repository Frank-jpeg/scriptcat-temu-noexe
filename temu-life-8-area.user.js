// ==UserScript==
// @name         上新生命周期-8-按类目自动设置到货区域 自改版
// @namespace    https://www.goldabcd.com/
// @description  按末级类目自动将期望到货区域设为广东或义乌，按店铺保存规则，无需EXE
// @author       TonyTonyYang / Frank-jpeg
// @match        https://agentseller.temu.com/newon/product-select*
// @version      2026.0930.1
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-8-area.user.js
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-8-area.user.js
// ==/UserScript==

(function () {
    'use strict';
    const VERSION = '2026.0930.1';
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
            rules[key] = { name: String(rule.name || key), parent: String(rule.parent || ''), area: Number(rule.area) };
        }
        return rules;
    }
    function normalizeSettings(value) {
        const templates = [];
        for (const template of Array.isArray(value && value.templates) ? value.templates : []) {
            const name = String(template && template.name || '').trim();
            if (!name || templates.some(item => item.name === name)) continue;
            templates.push({ name, rules: normalizeRules(template.rules) });
        }
        const activeTemplate = String(value && value.activeTemplate || '');
        const selected = templates.find(item => item.name === activeTemplate);
        const rules = selected ? normalizeRules(selected.rules) : {};
        return { enabled: !!(value && value.enabled === true && Object.keys(rules).length), templates, activeTemplate: selected ? activeTemplate : '', rules };
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
        module.exports = { normalizeSettings, uniqueItems, buildPlan, categoryList, createWorker };
        return;
    }

    function init() {
        if (document.getElementById('goldabcd-category-area-host')) return;
        const mallId = localStorage.getItem('agentseller-mall-info-id');
        const storageKey = STORAGE_PREFIX + mallId;
        let settings;
        try { settings = normalizeSettings(JSON.parse(localStorage.getItem(storageKey) || 'null')); }
        catch (_) { settings = normalizeSettings(null); }
        let enabled = false;
        let busy = false;
        let stopped = false;
        let timer = null;
        let items = [];
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
                <div class="row"><label>已保存模板 <select class="templates" aria-label="已保存模板"></select></label><button class="new">新建模板</button></div>
                <div class="row"><input class="template-name" placeholder="模板名称，例如：帽子广东、水杯义乌" aria-label="模板名称"><button class="save-template">保存模板</button></div>
                <div class="row"><button class="load">读取店铺类目</button><button class="enable primary">开始</button><button class="stop" disabled>暂停</button></div>
                <div class="muted">按末级类目 ID 匹配；未设置的类目不修改。开启后每轮结束 1 分钟自动检查，刷新会恢复开关。</div>
                <div class="row"><input class="search" placeholder="搜索类目名称或 ID" aria-label="搜索类目"></div>
                <div class="table"><table><thead><tr><th>末级类目 / ID</th><th>SKC 数量</th><th>期望到货区域</th></tr></thead><tbody></tbody></table></div>
                <div class="status" role="status" aria-live="polite">先读取类目，为需要处理的类目选择广东或义乌，保存为模板后点“开始”。</div>
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
            for (const selector of ['.templates', '.template-name', '.save-template', '.new']) $(selector).disabled = enabled || busy;
            $('.stop').disabled = !enabled && !busy;
            $('.open').textContent = '8、按类目自动设置到货区域（' + (enabled ? (busy ? '已开启·运行中' : '已开启') : busy ? (stopped ? '已关闭·正在暂停' : '已关闭·读取类目') : '已关闭') + '）';
            $('.open').style.background = enabled ? '#d8f3dc' : '#ffe7bd';
            root.querySelectorAll('tbody select').forEach(select => { select.disabled = enabled || busy; });
        }
        function render() {
            const body = $('tbody');
            body.replaceChildren();
            const search = $('.search').value.trim().toLowerCase();
            for (const cat of categoryList(items, settings.rules)) {
                if (search && !(cat.name + ' ' + cat.id).toLowerCase().includes(search)) continue;
                const tr = document.createElement('tr');
                const name = document.createElement('td');
                const title = document.createElement('div');
                title.textContent = cat.name;
                const detail = document.createElement('div');
                detail.className = 'muted';
                detail.textContent = 'ID ' + cat.id + (cat.parent ? ' · ' + cat.parent : '');
                name.append(title, detail);
                const count = document.createElement('td');
                count.textContent = String(cat.count);
                const cell = document.createElement('td');
                const select = document.createElement('select');
                select.dataset.catId = cat.id;
                select.setAttribute('aria-label', cat.name + ' ID ' + cat.id + ' 到货区域');
                for (const [value, label] of [['0', '不设置'], ['1', '广东'], ['2', '义乌']]) {
                    const option = document.createElement('option');
                    option.value = value; option.textContent = label; select.appendChild(option);
                }
                select.value = String(settings.rules[cat.id]?.area || 0);
                select.addEventListener('change', () => {
                    if (enabled || busy) return;
                    if (select.value === '0') delete settings.rules[cat.id];
                    else settings.rules[cat.id] = { name: cat.name, parent: cat.parent, area: Number(select.value) };
                    dirty = true; controls();
                    status('规则已修改，请先保存模板，再点“开始”。');
                });
                cell.appendChild(select); tr.append(name, count, cell); body.appendChild(tr);
            }
            controls();
        }
        async function request(endpoint, body, write) {
            assertContext();
            const controller = new AbortController();
            const timeout = write ? null : setTimeout(() => controller.abort(), 30000);
            try {
                const response = await fetch(API + endpoint, { method: 'POST', credentials: 'same-origin',
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
        function renderTemplates() {
            const select = $('.templates');
            select.replaceChildren();
            const blank = document.createElement('option');
            blank.value = ''; blank.textContent = '选择模板'; select.appendChild(blank);
            for (const template of settings.templates) {
                const option = document.createElement('option');
                option.value = template.name;
                option.textContent = template.name + '（' + Object.keys(template.rules).length + ' 个类目）';
                select.appendChild(option);
            }
            select.value = settings.activeTemplate;
            $('.template-name').value = settings.activeTemplate;
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
                    items = scanned.items;
                    render();
                    const result = await worker.apply(scanned.items, rules);
                    total += result.total; success += result.success;
                    if (scanned.truncated) {
                        const warning = AREAS[area] + '方向：待筛选 ' + scanned.total + ' 个，本轮最多查询 10000 个；' +
                            (result.success ? '已改商品将在下一轮退出查询，继续处理后续数据。' : '窗口内没有可推进商品，仍有未覆盖数据，不能判定全部完成。');
                        warnings.push(warning); log(warning);
                    }
                    if (result.error && !stopped) throw new Error(result.error + '；失败 ' + result.failed + '，结果不明 ' + result.unknown);
                }
                const message = (stopped ? '已暂停。\n' : '') + '模板「' + settings.activeTemplate + '」：本轮需修改 ' + total + ' 个 SKC，接口成功 ' + success + ' 个。';
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
        $('.new').addEventListener('click', () => {
            settings.activeTemplate = ''; settings.rules = {}; dirty = true;
            renderTemplates(); render(); status('选择类目区域，输入模板名称后保存。');
        });
        $('.templates').addEventListener('change', () => {
            const template = settings.templates.find(item => item.name === $('.templates').value);
            settings.activeTemplate = template ? template.name : '';
            settings.rules = normalizeRules(template && template.rules);
            dirty = false; renderTemplates(); render();
            try {
                save();
                status(template ? '已选择模板「' + template.name + '」，点“开始”自动运行。' : '请选择或新建模板。');
            } catch (error) { status('保存模板选择失败：' + error.message); }
        });
        $('.save-template').addEventListener('click', () => {
            const name = $('.template-name').value.trim();
            if (!name) { status('请输入模板名称'); return; }
            if (!Object.keys(settings.rules).length) { status('请至少为一个类目选择广东或义乌'); return; }
            const template = { name, rules: normalizeRules(settings.rules) };
            const index = settings.templates.findIndex(item => item.name === name);
            if (index < 0) settings.templates.push(template); else settings.templates[index] = template;
            settings.activeTemplate = name; settings.enabled = false;
            try { save(); dirty = false; renderTemplates(); controls(); status('模板已保存，点“开始”自动运行。'); }
            catch (error) { dirty = true; controls(); status('保存失败：' + error.message); }
        });
        $('.open').addEventListener('click', () => { $('.panel').hidden = !$('.panel').hidden; });
        $('.close').addEventListener('click', () => { $('.panel').hidden = true; });
        $('.search').addEventListener('input', render);
        $('.template-name').addEventListener('input', () => { dirty = true; controls(); });
        $('.load').addEventListener('click', async () => {
            if (enabled || busy) return;
            stopped = false; busy = true; controls();
            try {
                items = [];
                const warnings = [];
                // 分来源区域读取，避免就近推荐的类目被义乌的大列表挡住。
                for (const area of [1, 2, 3]) {
                    const scanned = await worker.scan([area]);
                    items.push(...scanned.items);
                    if (scanned.truncated) warnings.push((AREAS[area] || '就近推荐') + '区域总计 ' + scanned.total + '，本次读取前 10000 条');
                }
                render();
                status('读取完成：' + categoryList(items, {}).length + ' 个已读末级类目，' + uniqueItems(items).length + ' 个 SKC。请选择到货区域。' +
                    (warnings.length ? '\n' + warnings.join('；') + '。类目列表可能不完整。' : ''));
            } catch (error) { status(stopped ? '已停止读取。' : error.message); log(error.message, 'error'); }
            finally { busy = false; controls(); }
        });
        $('.enable').addEventListener('click', () => {
            if (enabled || busy) return;
            try {
                assertContext();
                if (dirty || !settings.activeTemplate || !Object.keys(settings.rules).length) throw new Error('请先保存并选择有效模板');
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
        renderTemplates();
        render();
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
