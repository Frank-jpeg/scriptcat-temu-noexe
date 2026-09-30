// ==UserScript==
// @name         上新生命周期-7-批量拒绝核价 自改版
// @namespace    https://www.goldabcd.com/
// @description  手动拒绝核价次数大于等于指定值的待确认核价单，无需下载器EXE
// @author       TonyTonyYang / Frank-jpeg
// @match        https://agentseller.temu.com/newon/product-select*
// @version      2026.0930.1
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-7-reject.user.js
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-7-reject.user.js
// ==/UserScript==

(function () {
    'use strict';
    const VERSION = '2026.0930.1';
    const SCRIPT_NAME = '上新生命周期-7-批量拒绝核价';
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

        async function execute(preview, threshold, semi) {
            const result = { submitted: 0, verified: 0, skipped: 0, failed: 0, unknown: 0, error: '' };
            const submitted = [];
            try {
                env.progress('正在复查预览清单…');
                const fresh = new Map((await scan(threshold, semi)).map(item => [item.priceOrderId, item]));
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

    // Node 测试仅加载业务函数，不创建界面，不请求店铺。
    if (typeof module === 'object' && module.exports) {
        module.exports = { thresholdValue, candidatesFrom, fingerprint, rejectPayload, createRunner, URLS };
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
            <button class="open">7、批量拒绝核价</button>
            <section class="panel" hidden>
                <div class="head"><h3>7、批量拒绝核价</h3><button class="close" aria-label="收起">收起</button></div>
                <div class="mall muted"></div>
                <div class="row"><label>核价次数 ≥ <input type="number" min="1" step="1" value="9" aria-label="核价次数下限"></label><label>店铺类型 <select aria-label="店铺类型"><option value="full">全托</option><option value="semi">半托</option></select></label></div>
                <div class="muted">填 9 表示第 9 次及以上；只拒绝待卖家确认的核价单，不修改标题。</div>
                <div class="row"><button class="scan">扫描预览</button><button class="execute primary" disabled>确认拒绝</button><button class="stop" disabled>停止</button></div>
                <div class="status" role="status" aria-live="polite">先扫描，查看清单后再确认拒绝。</div>
                <div class="table"><table><thead><tr><th>商品 / SPU</th><th>核价单</th><th>次数</th><th>结果</th></tr></thead><tbody></tbody></table></div>
                <div class="pager"><button class="prev">上一页</button><span class="page"></span><button class="next">下一页</button></div>
                <div class="muted">停止后，已发出的请求会等待返回；结果不明时请到 TEMU 页面复查。运行日志可在第 1 个脚本的日志面板查看。</div>
            </section>`;
        const $ = selector => root.querySelector(selector);
        const ui = { panel: $('.panel'), threshold: $('input'), mode: $('select'), scan: $('.scan'),
            execute: $('.execute'), stop: $('.stop'), status: $('.status'), body: $('tbody') };
        let busy = false;
        let stopped = false;
        let preview = null;
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
        function refreshMall() {
            const id = currentMall();
            const mall = configuredMall(id);
            ui.mode.value = mall && mall.isSemiHosted ? 'semi' : 'full';
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
            ui.threshold.disabled = ui.mode.disabled = ui.scan.disabled = busy;
            ui.execute.disabled = busy || !preview || !preview.items.length;
            ui.stop.disabled = !busy || stopped;
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
        function invalidate() { preview = null; rows = []; tablePage = 0; renderRows(); controls(); }
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
        async function run(action) {
            if (busy) return;
            busy = true;
            stopped = false;
            controls();
            try { await action(); }
            catch (error) { status(stopped ? '已停止；已发出的请求不会撤销。' : error.message); log(error.message, 'error'); }
            finally { busy = false; controls(); renderRows(); }
        }

        $('.open').addEventListener('click', () => {
            ui.panel.hidden = !ui.panel.hidden;
            if (!ui.panel.hidden && !busy && !preview) refreshMall();
        });
        $('.close').addEventListener('click', () => { ui.panel.hidden = true; });
        $('.prev').addEventListener('click', () => { tablePage--; renderRows(); });
        $('.next').addEventListener('click', () => { tablePage++; renderRows(); });
        for (const input of [ui.threshold, ui.mode]) input.addEventListener('input', () => {
            invalidate(); status('条件已改变，请重新扫描。');
        });
        ui.stop.addEventListener('click', () => {
            stopped = true;
            preview = null;
            controls();
            status('正在停止；等待已发出的请求返回，期间请保持页面打开。');
        });
        ui.scan.addEventListener('click', () => run(async () => {
            invalidate();
            const ctx = context();
            lastContext = ctx;
            const items = await runner(ctx).scan(ctx.threshold, ctx.semi);
            preview = { ...ctx, items };
            rows = items;
            status('店铺 ' + ctx.mallId + ' · ' + (ctx.semi ? '半托' : '全托') + ' · 核价次数 ≥ ' + ctx.threshold +
                '\n找到 ' + items.length + ' 张待确认核价单。' + (items.length ? '查看清单后点击“确认拒绝”。' : '没有需要拒绝的核价单。'));
            log('扫描完成；次数 ≥ ' + ctx.threshold + '；' + items.length + ' 单');
        }));
        ui.execute.addEventListener('click', () => {
            if (busy || !preview || !preview.items.length) return;
            const snapshot = preview;
            if (!confirm('店铺 ' + snapshot.mallId + '（' + (snapshot.semi ? '半托' : '全托') + '）\n拒绝核价次数 ≥ ' + snapshot.threshold +
                ' 的 ' + snapshot.items.length + ' 张核价单？\n执行前会复查，发生变化的核价单跳过；不修改标题。')) return;
            run(async () => {
                preview = null; // 同一份预览不可重复执行。
                lastContext = snapshot;
                const result = await runner(snapshot).execute(snapshot.items, snapshot.threshold, snapshot.semi);
                const message = (result.error ? '操作结束：' + result.error : '本轮完成') + '\n接口成功 ' + result.submitted +
                    ' 单（复查不再待确认 ' + result.verified + ' 单）；跳过 ' + result.skipped +
                    ' 单；失败 ' + result.failed + ' 单；结果不明 ' + result.unknown + ' 单；未执行 ' + snapshot.items.filter(i => i.status === '未执行').length + ' 单。';
                status(message);
                log(message, result.error ? 'error' : 'detail');
            });
        });
        window.addEventListener('beforeunload', event => {
            if (busy) { event.preventDefault(); event.returnValue = ''; }
        });
        refreshMall();
        renderRows();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
