const { test } = require('node:test');
const assert = require('node:assert/strict');
const { thresholdValue, candidatesFrom, rejectPayload, createRunner, URLS } = require('../temu-life-7-reject.user.js');

function product(id = 'p1', times = 9, status = 1) {
    return { productId: id, productName: '<商品>', skcList: [{ supplierPriceReviewInfoList: [{
        priceOrderId: 'order-' + id, times, status,
        productSkuList: [{ skuId: 'sku-' + id, priceReviewStatus: status }]
    }] }] };
}
const response = (products, total = products.length) => ({ success: true, result: { dataList: products, total } });
function fixture(request, extra = {}) {
    return createRunner({ request, assertContext() {}, shouldStop: () => false,
        sleep: async () => {}, progress() {}, changed() {}, ...extra });
}

test('阈值是 ≥：9 包含 9 和 10，排除 8；只接受正整数', () => {
    assert.equal(thresholdValue('9'), 9);
    for (const value of ['', '0', '-1', '1.2', 'NaN', 'Infinity', '1e2', '9007199254740992']) {
        assert.throws(() => thresholdValue(value));
    }
    assert.deepEqual(candidatesFrom([product('8', 8), product('9', 9), product('10', 10)], 9, false).map(i => i.times), [9, 10]);
});

test('已生效、作废、混合 SKU 状态、缺少 SKU/ID、无效次数不进入队列', () => {
    const mixed = product('mixed');
    mixed.skcList[0].supplierPriceReviewInfoList[0].productSkuList.push({ skuId: 'ok', priceReviewStatus: 2 });
    const empty = product('empty');
    empty.skcList[0].supplierPriceReviewInfoList[0].productSkuList = [];
    const unsafe = product('unsafe');
    unsafe.skcList[0].supplierPriceReviewInfoList[0].priceOrderId = Number.MAX_SAFE_INTEGER + 2;
    for (const semi of [false, true]) {
        assert.equal(candidatesFrom([product('active', 9, 2), product('void', 9, 3), product('bad', NaN), mixed, empty, unsafe], 9, semi).length, 0);
    }
});

test('全托和半托拒绝参数沿用上游；不包含价格、标题或自动报价字段', () => {
    const item = candidatesFrom([product()], 9, false)[0];
    assert.deepEqual(rejectPayload(item, false), { priceOrderId: 'order-p1' });
    assert.deepEqual(rejectPayload(item, true), { itemRequests: [{ priceOrderId: 'order-p1', supplierResult: 3, items: [{ productSkuId: 'sku-p1' }] }] });
});

test('分页扫描去重，不调用写接口；无 total 时读到空页', async () => {
    const requests = [];
    const pages = [[product()], [product(), product('p2')], []];
    const runner = fixture(async (url, body, write) => {
        requests.push({ url, body, write });
        return { success: true, result: { dataList: pages[body.pageNum - 1] } };
    });
    assert.equal((await runner.scan(9, true)).length, 2);
    assert.equal(requests.length, 3);
    assert.ok(requests.every(r => !r.write && r.url === URLS.semiList));
});

test('同一核价单出现冲突快照时排除，不任意选择某一版本', async () => {
    const pages = [[product(), product('a')], [product('p1', 10), product('b')], []];
    const runner = fixture(async (_, body) => ({ success: true, result: { dataList: pages[body.pageNum - 1] } }));
    assert.deepEqual((await runner.scan(9, false)).map(i => i.productId), ['a', 'b']);
});

test('重复分页和畸形响应终止扫描', async () => {
    const duplicate = fixture(async () => response([product()], 500));
    await assert.rejects(duplicate.scan(9, false), /重复/);
    await assert.rejects(fixture(async () => ({ success: true, result: {} })).scan(9, false), /dataList/);
});

for (const semi of [false, true]) test((semi ? '半托' : '全托') + '执行只使用未变化的预览条目，忽略新出现的条目并复查结果', async () => {
    const preview = candidatesFrom([product('same'), product('changed'), product('gone')], 9, semi);
    const writes = [];
    let reads = 0;
    const runner = fixture(async (url, body, write) => {
        if (write) { writes.push({ url, body }); return { success: true }; }
        return ++reads === 1 ? response([product('same'), product('changed', 10), product('new')]) : response([]);
    });
    const result = await runner.execute(preview, 9, semi);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].url, semi ? URLS.semiReject : URLS.fullReject);
    assert.equal(result.submitted, 1);
    assert.equal(result.verified, 1);
    assert.equal(result.skipped, 2);
    assert.equal(result.error, '');
});

test('接口成功但仍待确认，不计为复查成功；缺失次数/SKU 也不得误报成功', async () => {
    const preview = candidatesFrom([product()], 9, false);
    let reads = 0;
    const incomplete = product();
    incomplete.skcList[0].supplierPriceReviewInfoList[0].times = undefined;
    incomplete.skcList[0].supplierPriceReviewInfoList[0].productSkuList = [];
    const runner = fixture(async (_, __, write) => write ? { success: true } : response([++reads === 1 ? product() : incomplete]));
    const result = await runner.execute(preview, 9, false);
    assert.equal(result.submitted, 1);
    assert.equal(result.verified, 0);
    assert.match(preview[0].status, /仍待确认/);
});

for (const businessFailure of [true, false]) test((businessFailure ? '业务失败' : '网络结果不明') + '不计成功、不自动重试，保留未执行单', async () => {
    let writes = 0;
    const preview = candidatesFrom([product('a'), product('b')], 9, false);
    const runner = fixture(async (_, __, write) => {
        if (!write) return response([product('a'), product('b')]);
        writes++;
        throw Object.assign(new Error('失败'), { businessFailure });
    });
    const result = await runner.execute(preview, 9, false);
    assert.equal(writes, 1);
    assert.equal(result.submitted, 0);
    assert.equal(result.failed, businessFailure ? 1 : 0);
    assert.equal(result.unknown, businessFailure ? 0 : 1);
    assert.equal(preview[1].status, '未执行');
});

test('停止等待当前写请求返回，之后不发送下一单', async () => {
    let stopped = false;
    let finishWrite;
    let writes = 0;
    const preview = candidatesFrom([product('a'), product('b')], 9, false);
    const runner = fixture(async (_, __, write) => {
        if (!write) return response([product('a'), product('b')]);
        writes++;
        await new Promise(resolve => { finishWrite = resolve; });
        return { success: true };
    }, { shouldStop: () => stopped });
    let completed = false;
    const running = runner.execute(preview, 9, false).then(result => { completed = true; return result; });
    while (!finishWrite) await new Promise(resolve => setImmediate(resolve));
    stopped = true;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, false);
    finishWrite();
    const result = await running;
    assert.equal(result.submitted, 1);
    assert.equal(writes, 1);
    assert.equal(preview[1].status, '未执行');
});

test('扫描停止或切店，不产生写请求', async () => {
    let called = false;
    const stopped = fixture(async () => { called = true; }, { shouldStop: () => true });
    await assert.rejects(stopped.scan(9, false), /停止/);
    const changed = fixture(async () => { called = true; }, { assertContext() { throw new Error('店铺已切换'); } });
    await assert.rejects(changed.scan(9, false), /店铺/);
    assert.equal(called, false);
});
