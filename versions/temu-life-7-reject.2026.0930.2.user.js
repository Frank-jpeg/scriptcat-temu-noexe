// ==UserScript==
// @name         上新生命周期-7-批量自动拒绝核价 自改版
// @namespace    https://www.goldabcd.com/
// @description  启用后每分钟自动拒绝核价次数大于等于指定值的待确认核价单，按店铺记住设置，无需EXE
// @author       TonyTonyYang / Frank-jpeg
// @match        https://agentseller.temu.com/newon/product-select*
// @version      2026.0930.2
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-7-reject.user.js
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-7-reject.user.js
// ==/UserScript==

(function () {
    'use strict';
    const VERSION = '2026.0930.2';
    // 保持日志事件标识稳定，兼容第 1 个已有的日志筛选。
    const SCRIPT_NAME = '上新生命周期-7-批量拒绝核价';
    const SETTINGS_PREFIX = 'goldabcd_auto_reject_v1:';
    const ROOT = 'https://agentseller.temu.com';
    const URLS = {
        fullList: ROOT + '/api/kiana/mms/robin/searchForChainSupplier',
        semiList: ROOT + '/api/kiana/mms/robin/searchForSemiSupplier',
        fullReject: ROOT + '/api/kiana/mms/magneto/api/price-review-order/no-bom/review',
        semiReject: ROOT + '/api/kiana/magnus/mms/price/bargain-no-bom/batch'
    };

    function thresholdValue(value) {
        const text = String(value).trim();
        const n = Number(text);
        if (!/^\d+$/.test(text) || !Number.isSafeInteger(n) || n < 1) {
            throw new Error('请输入大于等于 1 的整数；填 9 表示第 9 次及以上。');
        }
        return n;
    }

    function idValue(value) {
        if (typeof value === 'number' && !Number.isSafeInteger(value)) return '';
        if (typeof value !== 'number' && typeof value !== 'string') return '';
        return String(value).trim();
    }

    function fingerprint(item) {
        return JSON.stringify([item.productId, item.priceOrderId, item.times, item.skuIds.slice().sort()]);
    }

    function candidatesFrom(products, threshold, semi) {
        const items = [];
        for (const product of products) {
            for (const skc of product.skcList || []) {
                for (const review of skc.supplierPriceReviewInfoList || []) {
                    const times = Number(review.times);
                    const skus = review.productSkuList;
                    if (!Number.isSafeInteger(times) || times < threshold || !Array.isArray(skus) || !skus.length) continue;
                    // 不依据首个 SKU 推断整张核价单；任何已生效/作废 SKU 都不拒绝。
                    if (review.status != null && Number(review.status) !== 1) continue;
                    if (semi && Number(review.status) !== 1) continue;
                    if (skus.some(sku => sku.priceReviewStatus != null && Number(sku.priceReviewStatus) !== 1)) continue;
                    if (review.status == null && !skus.every(sku => Number(sku.priceReviewStatus) === 1)) continue;
                    const skuIds = skus.map(sku => idValue(sku.skuId));
                    const productId = idValue(product.productId);
                    const priceOrderId = idValue(review.priceOrderId);
                    if (!productId || !priceOrderId || skuIds.some(id => !id)) continue;
                    items.push({ productId, productName: String(product.productName || ''), priceOrderId, times,
                        skuIds: [...new Set(skuIds)], status: '待确认' });
                }
            }
        }
        return items;
    }

    function rejectPayload(item, semi) {
        if (!semi) return { priceOrderId: item.priceOrderId };
        return { itemRequests: [{ priceOrderId: item.priceOrderId, supplierResult: 3,
            items: item.skuIds.map(productSkuId => ({ productSkuId })) }] };
    }

    function pendingOrdersFrom(products) {
        const items = [];
        for (const product of products) {
            for (const skc of product.skcList || []) {
                for (const review of skc.supplierPriceReviewInfoList || []) {
                    const id = idValue(review.priceOrderId);
                    // 复查不使用次数/SKU 完整性筛选，避免将数据异常误判为拒绝成功。
                    const skus = Array.isArray(review.productSkuList) ? review.productSkuList : [];
                    const terminal = [2, 3].includes(Number(review.status));
                    if (id && (!terminal || skus.some(sku => Number(sku.priceReviewStatus) === 1))) items.push({ priceOrderId: id });
                }
            }
        }
        return items;
    }

    function createRunner(env) {
        const check = () => {
            env.assertContext();
            if (env.shouldStop()) throw new Error('已停止');
        };
        async function scan(threshold, semi, pendingOnly = false) {
            const found = new Map();
            const conflicts = new Set();
            const seenPages = new Set();
            const pageSize = 50;
            for (let page = 1; page <= 1000; page++) {
                check();
                const data = await env.request(semi ? URLS.semiList : URLS.fullList, {
                    priceReviewStatusList: [1], secondarySelectStatusList: [7], supplierTodoTypeList: [],
                    pageNum: page, pageSize
                }, false);
                check();
                const products = data.result && data.result.dataList;
                if (!Array.isArray(products)) throw new Error('查询响应缺少 dataList，未生成可执行清单。');
                if (!products.length) return [...found.values()];
                const pageKey = JSON.stringify(products.map(p => idValue(p.productId)));
                if (seenPages.has(pageKey)) throw new Error('接口重复返回同一页，扫描已停止，请稍后重试。');
                seenPages.add(pageKey);
                for (const item of pendingOnly ? pendingOrdersFrom(products) : candidatesFrom(products, threshold, semi)) {
                    const previous = found.get(item.priceOrderId);
                    if (!pendingOnly && previous && fingerprint(previous) !== fingerprint(item)) conflicts.add(item.priceOrderId);
                    if (conflicts.has(item.priceOrderId)) found.delete(item.priceOrderId);
                    else found.set(item.priceOrderId, item);
                }
                env.progress('已扫描第 ' + page + ' 页，符合条件 ' + found.size + ' 单');
                const total = Number(data.result.total);
                if (Number.isFinite(total) && total >= 0 && page * pageSize >= total) return [...found.values()];
                // 没有 total 时继续请求到空页，不把短页直接当作最后一页。
                await env.sleep(300);
            }
            throw new Error('扫描超过 1000 页，请缩小范围后重试。');
        }

        async function execute(preview, threshold, semi, recheck = true) {
            const result = { submitted: 0, verified: 0, skipped: 0, failed: 0, unknown: 0, error: '' };
            const submitted = [];
            try {
                if (recheck) env.progress('正在复查待处理清单…');
                const fresh = new Map((recheck ? await scan(threshold, semi) : preview).map(item => [item.priceOrderId, item]));
                for (const item of preview) {
                    check();
                    const current = fresh.get(item.priceOrderId);
                    if (!current || fingerprint(current) !== fingerprint(item)) {
                        item.status = '已跳过：状态、次数或 SKU 已变化';
                        result.skipped++;
                        env.changed(item);
                        continue;
                    }
                    item.status = '正在拒绝';
                    env.progress('正在拒绝核价单 ' + item.priceOrderId + '（第 ' + item.times + ' 次）');
                    env.changed(item);
                    try {
                        // 写请求发出后不因“停止”而中断，以免把已执行结果误判为未执行。
                        await env.request(semi ? URLS.semiReject : URLS.fullReject, rejectPayload(current, semi), true);
                        result.submitted++;
                        submitted.push(item);
                        item.status = '接口成功，待复查';
                        env.changed(item);
                    } catch (error) {
                        if (error.businessFailure) {
                            result.failed++;
                            item.status = '失败：' + error.message;
                        } else {
                            result.unknown++;
                            item.status = '结果不明，请到页面复查：' + error.message;
                        }
                        env.changed(item);
                        throw error; // 不自动重试写请求，保留剩余清单。
                    }
                    await env.sleep(800);
                }
                if (submitted.length) {
                    check();
                    env.progress('正在复查拒绝结果…');
                    const remaining = new Set((await scan(1, semi, true)).map(item => item.priceOrderId));
                    for (const item of submitted) {
                        if (!remaining.has(item.priceOrderId)) {
                            item.status = '已确认：不再待确认';
                            result.verified++;
                        } else item.status = '接口成功，仍待确认，请到页面复查';
                        env.changed(item);
                    }
                }
            } catch (error) {
                result.error = error.message;
            }
            for (const item of preview) {
                if (item.status === '待确认') item.status = '未执行';
            }
            return result;
        }
        return { scan, execute };
    }

    // 每轮结束后再安排下一轮，长任务不会重叠。停用会取消下一轮。
    function createAutoLoop(env, interval = 60000) {
        let enabled = false;
        let running = false;
        let timer = null;
        function schedule(delay) {
            timer = env.setTimer(async () => {
                timer = null;
                if (!enabled || running) return;
                running = true;
                env.changed();
                try { await env.run(); }
                catch (error) {
                    enabled = false;
                    env.error(error);
                } finally {
                    running = false;
                    if (enabled) { env.waiting(interval); schedule(interval); }
                    env.changed();
                }
            }, delay);
        }
        return {
            start(delay = 0) {
                if (enabled || running) return false;
                enabled = true;
                schedule(delay);
                env.changed();
                return true;
            },
            stop() {
                enabled = false;
                if (timer !== null) env.clearTimer(timer);
                timer = null;
                env.changed();
            },
            isEnabled: () => enabled,
            isRunning: () => running
        };
    }

    // Node 测试仅加载业务函数，不创建界面，不请求店铺。
    if (typeof module === 'object' && module.exports) {
        module.exports = { thresholdValue, candidatesFrom, fingerprint, rejectPayload, createRunner, createAutoLoop, URLS };
        return;
    }

    function init() {
        if (document.getElementById('goldabcd-reject-price-host')) return;
        const host = document.createElement('div');
        host.id = 'goldabcd-reject-price-host';
        host.dataset.version = VERSION;
        document.body.appendChild(host);
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `
            <style>
                :host{all:initial;font:14px/1.5 "Microsoft YaHei",sans-serif;color:#222}
                *{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer;border:1px solid #ccc;border-radius:5px;padding:7px 12px;background:#fff;color:#222}
                button:disabled{opacity:.45;cursor:default}button.primary{background:#b83d22;color:#fff;border-color:#b83d22}
                .open{position:absolute;left:260px;top:420px;z-index:9999;background:#ffe7bd;border:0;padding:10px;border-radius:0}
                .panel{position:fixed;top:12vh;right:22px;width:min(680px,calc(100vw - 30px));max-height:80vh;overflow:auto;z-index:2147483645;background:#fff;border:1px solid #ddd;border-radius:10px;box-shadow:0 12px 40px #0003;padding:18px}
                [hidden]{display:none!important}.head,.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.head{justify-content:space-between}h3{margin:0;font-size:17px}.row{margin:14px 0}
                input{width:85px}input,select{border:1px solid #bbb;border-radius:4px;padding:6px}.muted{color:#666;font-size:12px}.status{white-space:pre-wrap;background:#fff7ea;padding:10px;margin:12px 0;border-radius:5px}
                .table{max-height:40vh;overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;padding:8px;border-bottom:1px solid #eee;vertical-align:top;overflow-wrap:anywhere}th{position:sticky;top:0;background:#fafafa}td:first-child{max-width:210px}.pager{display:flex;gap:10px;justify-content:flex-end;align-items:center;margin-top:10px}
            </style>
            <button class="open">7、批量自动拒绝核价（未启用）</button>
            <section class="panel" hidden>
                <div class="head"><h3>7、批量自动拒绝核价</h3><button class="close" aria-label="收起">收起</button></div>
                <div class="mall muted"></div>
                <div class="row"><label>核价次数 ≥ <input type="number" min="1" step="1" value="9" aria-label="核价次数下限"></label><label>店铺类型 <select aria-label="店铺类型"><option value="full">全托</option><option value="semi">半托</option></select></label></div>
                <div class="muted">填 9 表示第 9 次及以上；只拒绝待卖家确认的核价单，不修改标题。</div>
                <div class="row"><button class="enable primary">保存并启用自动拒绝</button><button class="stop" disabled>停用自动拒绝</button></div>
                <div class="status" role="status" aria-live="polite">设置次数后启用；每轮自动扫描并拒绝，无需逐轮确认。</div>
                <div class="table"><table><thead><tr><th>商品 / SPU</th><th>核价单</th><th>次数</th><th>结果</th></tr></thead><tbody></tbody></table></div>
                <div class="pager"><button class="prev">上一页</button><span class="page"></span><button class="next">下一页</button></div>
                <div class="muted">启用后立即处理，每轮结束 1 分钟后再次检查；刷新会恢复已保存的启用状态。停用后不再发起下一单。运行日志可在第 1 个脚本的日志面板查看。</div>
            </section>`;
        const $ = selector => root.querySelector(selector);
        const ui = { panel: $('.panel'), threshold: $('input'), mode: $('select'), enable: $('.enable'),
            stop: $('.stop'), status: $('.status'), body: $('tbody') };
        let stopped = false;
        let activeContext = null;
        let rows = [];
        let tablePage = 0;
        let lastContext = null;
        let logCounter = 0;

        function currentMall() { return localStorage.getItem('agentseller-mall-info-id') || ''; }
        function configuredMall(mallId) {
            for (const key of ['goldabcd_noexe_config_v1', 'goldabcd_noexe_config_v1_local_backup']) {
                try {
                    const config = JSON.parse(localStorage.getItem(key) || 'null');
                    const mall = config && Array.isArray(config.malls) && config.malls.find(m => String(m.mallId) === mallId);
                    if (mall) return mall;
                } catch (_) { /* 可在面板手动选择类型；不写入或覆盖共享配置。 */ }
            }
            return null;
        }
        function loadSettings(mallId) {
            try {
                const saved = JSON.parse(localStorage.getItem(SETTINGS_PREFIX + mallId) || 'null');
                if (!saved) return null;
                return { threshold: thresholdValue(saved.threshold), semi: saved.semi === true, enabled: saved.enabled === true };
            } catch (_) { return null; }
        }
        function saveSettings(ctx, enabled) {
            localStorage.setItem(SETTINGS_PREFIX + ctx.mallId, JSON.stringify({ threshold: ctx.threshold, semi: ctx.semi, enabled }));
        }
        function refreshMall() {
            const id = currentMall();
            const mall = configuredMall(id);
            const saved = loadSettings(id);
            ui.threshold.value = saved ? saved.threshold : 9;
            ui.mode.value = (saved ? saved.semi : mall && mall.isSemiHosted) ? 'semi' : 'full';
            $('.mall').textContent = '当前店铺：' + (mall && mall.mallName ? mall.mallName + ' · ' : '') + (id || '未识别') +
                (mall ? '（已读取共享配置）' : '（未配置，默认全托；半托请切换类型）');
        }
        function context() {
            const mallId = currentMall();
            if (!mallId) throw new Error('未识别当前店铺，请刷新商品选择页。');
            return { mallId, threshold: thresholdValue(ui.threshold.value), semi: ui.mode.value === 'semi' };
        }
        function assertContext(ctx) {
            if (currentMall() !== ctx.mallId) throw new Error('店铺已切换，已停止；请刷新页面重新扫描。');
            if (!location.pathname.startsWith('/newon/product-select')) throw new Error('已离开商品选择页，操作停止。');
        }
        function log(message, type = 'detail', ctx = lastContext) {
            window.dispatchEvent(new CustomEvent('goldabcd-noexe-log-event', { detail: {
                scriptName: SCRIPT_NAME, phase: 'detail', type, time: Date.now(),
                endpoint: '批量拒绝核价', endpointTitle: '批量拒绝核价',
                source: ctx ? 'mallId=' + ctx.mallId : '', message
            } }));
        }
        function status(message) { ui.status.textContent = message; }
        function controls() {
            const enabled = loop.isEnabled();
            const running = loop.isRunning();
            ui.threshold.disabled = ui.mode.disabled = ui.enable.disabled = enabled || running;
            ui.stop.disabled = !enabled;
            $('.open').textContent = '7、批量自动拒绝核价（' + (enabled ? (running ? '已开启·运行中' : '已开启') : running ? '已关闭·正在停止' : '已关闭') + '）';
            $('.open').style.background = enabled ? '#d8f3dc' : '#ffe7bd';
        }
        function renderRows() {
            ui.body.replaceChildren();
            const pages = Math.max(1, Math.ceil(rows.length / 50));
            tablePage = Math.max(0, Math.min(tablePage, pages - 1));
            for (const item of rows.slice(tablePage * 50, (tablePage + 1) * 50)) {
                const tr = document.createElement('tr');
                for (const value of [item.productName + '\nSPU ' + item.productId, item.priceOrderId, item.times, item.status]) {
                    const td = document.createElement('td');
                    td.textContent = String(value);
                    tr.appendChild(td);
                }
                ui.body.appendChild(tr);
            }
            $('.page').textContent = (tablePage + 1) + ' / ' + pages + ' 页，共 ' + rows.length + ' 单';
            $('.prev').disabled = tablePage === 0;
            $('.next').disabled = tablePage >= pages - 1;
        }
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

        async function request(ctx, url, body, write) {
            assertContext(ctx);
            const id = SCRIPT_NAME + '-' + Date.now() + '-' + (++logCounter);
            const started = Date.now();
            const emit = detail => window.dispatchEvent(new CustomEvent('goldabcd-noexe-log-event', { detail: {
                scriptName: SCRIPT_NAME, id, url, endpoint: new URL(url).pathname,
                endpointTitle: write ? '提交拒绝核价' : '扫描核价单', source: 'mallId=' + ctx.mallId,
                time: Date.now(), ...detail
            } }));
            emit({ phase: 'start' });
            // 只对读请求设超时，写请求等待返回以保留真实结果。
            const controller = new AbortController();
            const timer = write ? null : setTimeout(() => controller.abort(), 30000);
            try {
                const response = await fetch(url, { method: 'POST', credentials: 'same-origin',
                    headers: { 'content-type': 'application/json', mallid: ctx.mallId },
                    body: JSON.stringify(body), ...(write ? {} : { signal: controller.signal }) });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const data = await response.json();
                if (!data || data.success !== true) {
                    const error = new Error(String(data && (data.errorMsg || data.error_msg || data.message) || '接口未确认成功'));
                    error.businessFailure = !!data && data.success === false;
                    throw error;
                }
                emit({ phase: 'finish', type: 'success', duration: Date.now() - started,
                    message: '店铺=' + ctx.mallId + (write ? '；核价单=' + (body.priceOrderId || body.itemRequests[0].priceOrderId) + '；接口成功，待复查' : '；第 ' + body.pageNum + ' 页') });
                return data;
            } catch (error) {
                emit({ phase: 'finish', type: error.businessFailure ? 'fail' : 'error',
                    duration: Date.now() - started, message: '店铺=' + ctx.mallId + '；' + error.message });
                throw error;
            } finally { if (timer) clearTimeout(timer); }
        }
        function runner(ctx) {
            return createRunner({ request: (url, data, write) => request(ctx, url, data, write), sleep,
                assertContext: () => assertContext(ctx), shouldStop: () => stopped, progress: status,
                changed: item => { renderRows(); log('SPU=' + item.productId + '；核价单=' + item.priceOrderId + '；第' + item.times + '次；' + item.status); } });
        }
        const loop = createAutoLoop({
            setTimer: (callback, ms) => setTimeout(callback, ms), clearTimer: id => clearTimeout(id),
            changed: controls,
            waiting: () => { status(ui.status.textContent + '\n已启用，1 分钟后自动检查下一轮。'); },
            error: error => {
                try { saveSettings(activeContext, false); } catch (_) { /* 页面仍然保持停用。 */ }
                if (stopped) { status('自动拒绝已停用。'); return; }
                status('自动拒绝已暂停：' + error.message + '\n处理后可重新启用。');
                log(error.message, 'error');
            },
            run: async () => {
                const ctx = activeContext;
                assertContext(ctx);
                lastContext = ctx;
                status('正在自动扫描核价次数 ≥ ' + ctx.threshold + ' 的待确认单…');
                const worker = runner(ctx);
                rows = await worker.scan(ctx.threshold, ctx.semi);
                tablePage = 0;
                renderRows();
                const result = await worker.execute(rows, ctx.threshold, ctx.semi, false);
                const message = '本轮接口成功 ' + result.submitted + ' 单（复查不再待确认 ' + result.verified +
                    ' 单）；跳过 ' + result.skipped + ' 单；失败 ' + result.failed + ' 单；结果不明 ' + result.unknown + ' 单。';
                renderRows();
                status((stopped ? '已停用。' : '') + message);
                log(message, result.error && !stopped ? 'error' : 'detail');
                if (result.error && !stopped) throw new Error(result.error);
            }
        });

        $('.open').addEventListener('click', () => {
            ui.panel.hidden = !ui.panel.hidden;
            if (!ui.panel.hidden && !loop.isEnabled() && !loop.isRunning()) refreshMall();
        });
        $('.close').addEventListener('click', () => { ui.panel.hidden = true; });
        $('.prev').addEventListener('click', () => { tablePage--; renderRows(); });
        $('.next').addEventListener('click', () => { tablePage++; renderRows(); });
        ui.enable.addEventListener('click', () => {
            if (loop.isEnabled() || loop.isRunning()) return;
            try {
                activeContext = context();
                assertContext(activeContext);
                saveSettings(activeContext, true);
                stopped = false;
                status('自动拒绝已启用，正在开始…');
                loop.start();
            } catch (error) { status(error.message); }
        });
        ui.stop.addEventListener('click', () => {
            stopped = true;
            loop.stop();
            try { saveSettings(activeContext, false); }
            catch (error) { status('已停用，但保存失败：' + error.message); return; }
            status(loop.isRunning() ? '正在停用；等待当前请求返回，不再提交下一单。' : '自动拒绝已停用。');
        });
        window.addEventListener('beforeunload', event => {
            if (loop.isRunning()) { event.preventDefault(); event.returnValue = ''; }
        });
        refreshMall();
        renderRows();
        controls();
        const saved = loadSettings(currentMall());
        if (saved && saved.enabled) {
            activeContext = context();
            status('已恢复自动拒绝设置，5 秒后开始。');
            loop.start(5000);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
