const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lookupCategory, normalizeSettings, uniqueItems, buildPlan, categoryList, createWorker } = require('../temu-life-8-area.user.js');
const item = (skc, cat = '100', area = 3, canEdit = true) => ({ productSkcId: skc, leafCatId: cat, leafCatName: '帽子', cat4Name: '服装', expectReceiveAreaConfigType: area, canEditExpectReceiveArea: canEdit });
const rules = { 100: { name: '帽子', area: 1 }, 200: { name: '帽子', area: 2 } };
function worker(request, other = {}) {
    return createWorker({ request, assertContext() {}, stopped: () => false, sleep: async () => {}, progress() {}, log() {}, ...other });
}

test('按类目 ID 匹配，同名不同 ID 不混淆；未配置、已符合、不可编辑跳过', () => {
    const plan = buildPlan([item('a'), item('b', '200'), item('c', '300'), item('d', '100', 1), item('e', '100', 3, false)], rules);
    assert.deepEqual(plan[1].map(i => i.productSkcId), ['a']);
    assert.deepEqual(plan[2].map(i => i.productSkcId), ['b']);
    assert.equal(categoryList([item('a'), item('b', '200')], {}).length, 2);
});

test('重复 SKC 只修改一次；不同类目或权限的冲突快照排除', () => {
    assert.equal(uniqueItems([item('a'), item('a')]).length, 1);
    assert.equal(uniqueItems([item('a'), item('a', '200'), item('a')]).length, 0);
    assert.equal(uniqueItems([item('a'), item('a', '100', 3, false)]).length, 0);
});

test('旧模板合并，冲突优先原选中模板，迁移暂停；新版恢复所有规则', () => {
    const saved = normalizeSettings({ enabled: true, activeTemplate: '甲', templates: [
        { name: '甲', rules: { 100: { name: '帽子', area: 1 } } },
        { name: '乙', rules: { 100: { name: '帽子', area: 2 }, 200: { name: '水杯', area: 2 } } }
    ] });
    assert.equal(saved.enabled, false);
    assert.equal(saved.rules[100].area, 1);
    assert.equal(saved.rules[200].area, 2);
    const restored = normalizeSettings({ ...saved, enabled: true });
    assert.equal(restored.enabled, true);
    assert.equal(Object.keys(restored.rules).length, 2);
    assert.equal(normalizeSettings({ schemaVersion: 2, enabled: true, rules: {} }).enabled, false);
});

test('代表 SPU 只精确查询一次，不翻页不全店扫描', async () => {
    const calls = [];
    const found = await lookupCategory(async (...args) => {
        calls.push(args);
        return { success: true, result: { dataList: [{ productId: 123, catIdList: [9, 100], catNameList: ['服装', '帽子'] }] } };
    }, '123');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][1].productSpuIdList, [123]);
    assert.equal(calls[0][2], false);
    assert.deepEqual(found, { id: '100', spu: '123', name: '帽子', parent: '服装' });
});

test('无效编号不查询；返回其他 SPU、无类目及冲突类目拒绝保存', async () => {
    await assert.rejects(lookupCategory(() => { throw Error('不应调用'); }, 'abc'), /有效商品/);
    for (const rows of [[], [{productId: 124, catIdList:[100]}], [{productId:123}],
        [{productId:123,catIdList:[100]}, {productId:123,catIdList:[200]}]]) {
        await assert.rejects(lookupCategory(async () => ({result:{dataList:rows}}), '123'));
    }
});

test('没有类目名称时不冒充商品名称；备注与 SPU 可恢复', async () => {
    const found = await lookupCategory(async () => ({result:{dataList:[{productId:123,productName:'商品标题',catIdList:[100]}]}}), '123');
    assert.equal(found.name, '');
    const restored = normalizeSettings({schemaVersion:2,rules:{100:{name:'帽子',label:'我的备注',spu:'123',area:2}}});
    assert.equal(restored.rules[100].spu, '123');
    assert.equal(restored.rules[100].label, '我的备注');
});

test('类目列表保留模板中暂时无商品的规则，名称来自接口并显示所属类目', () => {
    const cats = categoryList([item('a'), item('a')], rules);
    assert.equal(cats.find(c => c.id === '100').count, 1);
    assert.equal(cats.find(c => c.id === '100').parent, '服装');
    assert.equal(cats.find(c => c.id === '200').count, 0);
});

test('查询使用指定来源区域，扫描只读', async () => {
    const calls = [];
    const w = worker(async (endpoint, body, write) => {
        calls.push({ endpoint, body, write });
        return { success: true, result: { total: 1, items: [item('a')] } };
    });
    const result = await w.scan([2, 3]);
    assert.deepEqual(calls[0].body.expectReceiveAreaConfigTypeList, [2, 3]);
    assert.equal(calls[0].write, false);
    assert.equal(result.truncated, false);
});

test('10000 查询窗口：不请求第 201 页，明确返回 truncated', async () => {
    let maxPage = 0;
    const w = worker(async (_, body) => {
        maxPage = body.pageNumber;
        assert.ok(body.pageNumber * body.pageSize <= 10000);
        return { success: true, result: { total: 13188, items: Array.from({ length: 50 }, (_, i) => item(String((body.pageNumber - 1) * 50 + i))) } };
    });
    const result = await w.scan([2, 3]);
    assert.equal(maxPage, 200);
    assert.equal(result.items.length, 10000);
    assert.equal(result.truncated, true);
    assert.equal(result.total, 13188);
});

test('正好 10000 条不是截断；重复页面与缺失字段不当作成功', async () => {
    const w = worker(async (_, body) => ({ success: true, result: { total: 10000, items: [item(String(body.pageNumber))] } }));
    assert.equal((await w.scan()).truncated, false);
    await assert.rejects(worker(async () => ({ success: true, result: { total: 51, items: [item('same')] } })).scan(), /重复/);
    await assert.rejects(worker(async () => ({ success: true, result: {} })).scan(), /列表/);
});

test('按目标区域分组，每批最多 50 个，使用上游写入字段', async () => {
    const calls = [];
    const w = worker(async (endpoint, body, write) => { calls.push({ endpoint, body, write }); return { success: true }; });
    const result = await w.apply([...Array.from({ length: 51 }, (_, i) => item('gd-' + i)), item('yw', '200')], rules);
    assert.equal(result.success, 52);
    assert.deepEqual(calls.map(c => c.body.productSkcIdList.length), [50, 1, 1]);
    assert.deepEqual(calls.map(c => c.body.exceptReceiveAreaConfigType), [1, 1, 2]);
    assert.ok(calls.every(c => c.write && c.endpoint === 'editExpectReceiveArea'));
});

test('失败或结果不明停止提交，不把未成功批次计入成功', async () => {
    for (const businessFailure of [false, true]) {
        let calls = 0;
        const w = worker(async () => { calls++; throw Object.assign(new Error('接口失败'), { businessFailure }); });
        const result = await w.apply(Array.from({ length: 51 }, (_, i) => item('a' + i)), rules);
        assert.equal(calls, 1);
        assert.equal(result.success, 0);
        assert.equal(result.failed, businessFailure ? 50 : 0);
        assert.equal(result.unknown, businessFailure ? 0 : 50);
    }
});

test('暂停等待当前写请求返回，下一批不再发送', async () => {
    let stopped = false, finish, calls = 0;
    const w = worker(async () => { calls++; await new Promise(resolve => { finish = resolve; }); return { success: true }; }, { stopped: () => stopped });
    const running = w.apply(Array.from({ length: 51 }, (_, i) => item('a' + i)), rules);
    stopped = true; finish();
    const result = await running;
    assert.equal(result.success, 50);
    assert.equal(calls, 1);
    assert.match(result.error, /停用/);
});

test('切店时读写都停止', async () => {
    let calls = 0;
    const w = worker(async () => { calls++; }, { assertContext() { throw new Error('店铺变化'); } });
    await assert.rejects(w.scan(), /店铺/);
    assert.match((await w.apply([item('a')], rules)).error, /店铺/);
    assert.equal(calls, 0);
});
