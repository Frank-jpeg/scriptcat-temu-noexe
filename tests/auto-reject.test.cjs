const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAutoLoop, createRunner, candidatesFrom } = require('../temu-life-7-reject.user.js');

function setup(run) {
    const timers = new Map();
    const errors = [];
    let id = 0;
    const loop = createAutoLoop({ run, setTimer(callback, ms) { timers.set(++id, { callback, ms }); return id; },
        clearTimer(id) { timers.delete(id); }, changed() {}, waiting() {}, error(e) { errors.push(e.message); } });
    return { loop, timers, errors, fire() { const [id, timer] = timers.entries().next().value; timers.delete(id); return timer.callback(); } };
}

test('首次不自动启动；启用立即运行，之后每轮结束 60 秒继续，无需确认', async () => {
    let calls = 0;
    const h = setup(async () => { calls++; });
    assert.equal(h.timers.size, 0);
    assert.equal(h.loop.start(), true);
    assert.equal(h.loop.start(), false);
    assert.equal([...h.timers.values()][0].ms, 0);
    await h.fire();
    assert.equal(calls, 1);
    assert.equal([...h.timers.values()][0].ms, 60000);
    await h.fire();
    assert.equal(calls, 2);
    h.loop.stop();
    assert.equal(h.timers.size, 0);
});

test('刷新恢复可延迟 5 秒启动；停用取消等待', () => {
    const h = setup(async () => {});
    h.loop.start(5000);
    assert.equal([...h.timers.values()][0].ms, 5000);
    h.loop.stop();
    assert.equal(h.timers.size, 0);
    assert.equal(h.loop.isEnabled(), false);
});

test('长任务不重叠，运行期间停用后不会安排下一轮', async () => {
    let finish;
    const h = setup(() => new Promise(resolve => { finish = resolve; }));
    h.loop.start();
    const pending = h.fire();
    assert.equal(h.loop.isRunning(), true);
    assert.equal(h.timers.size, 0);
    h.loop.stop();
    assert.equal(h.loop.start(), false);
    finish();
    await pending;
    assert.equal(h.timers.size, 0);
    assert.equal(h.loop.isRunning(), false);
});

test('接口异常停用，不循环重试同一写请求；处理后可以重新启用', async () => {
    const h = setup(async () => { throw new Error('接口失败'); });
    h.loop.start();
    await h.fire();
    assert.equal(h.loop.isEnabled(), false);
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.errors, ['接口失败']);
    assert.equal(h.loop.start(), true);
});

test('自动轮次直接处理刚扫描的 ≥9 清单，无需人工预览或第二次扫描', async () => {
    const product = { productId: 'p9', skcList: [{ supplierPriceReviewInfoList: [{
        priceOrderId: 'o9', times: 9, status: 1, productSkuList: [{ skuId: 's9', priceReviewStatus: 1 }]
    }] }] };
    const calls = [];
    const runner = createRunner({ assertContext() {}, shouldStop: () => false, progress() {}, changed() {}, sleep: async () => {},
        request: async (url, body, write) => { calls.push({ url, body, write }); return write ? { success: true } : { success: true, result: { total: 0, dataList: [] } }; } });
    const result = await runner.execute(candidatesFrom([product], 9, false), 9, false, false);
    assert.equal(calls[0].write, true);
    assert.equal(calls[0].body.priceOrderId, 'o9');
    assert.equal(calls.length, 2); // 一次拒绝，一次结果复查。
    assert.equal(result.verified, 1);
});
