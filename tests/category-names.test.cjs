const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lookupCategory, normalizeNameCache, normalizeSettings } = require('../temu-life-8-area.user.js');
const product = (path = [30972,30977]) => ({result:{dataList:[{productId:123,catIdList:path}]}});
const names = (nodes = [{catId:30977,catName:'旅行包、行李包',parentCatId:30972}]) => ({result:{categoryNodeVOS:nodes}});

test('首次精准查 SPU，再按父 ID 查一次名称；之后和刷新恢复后均命中缓存', async () => {
    const calls = [], cache = {};
    const request = async (endpoint, body, write) => {
        calls.push({endpoint,body,write});
        return endpoint.endsWith('searchForChainSupplier') ? product() : names();
    };
    const found = await lookupCategory(request, '123', cache);
    assert.deepEqual(found, {id:'30977',spu:'123',name:'旅行包、行李包',parent:''});
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], {endpoint:'/anniston-agent-seller/category/children/list',body:{parentCatId:30972},write:false});
    await lookupCategory(request, '123', cache);
    await lookupCategory(request, '123', normalizeNameCache(JSON.parse(JSON.stringify(cache))));
    assert.equal(calls.length, 4);
    assert.equal(calls.filter(call => call.endpoint.endsWith('/children/list')).length, 1);
});

test('同名不同 ID 不混淆；只保存目标，不把整个子级列表收进缓存', async () => {
    const cache = {};
    const found = await lookupCategory(async endpoint => endpoint.endsWith('searchForChainSupplier') ? product([34856,34857,34859]) :
        names([{catId:34858,catName:'帽子',parentCatId:34857},{catId:34859,catName:'帽子',parentCatId:34857}]), '123', cache);
    assert.equal(found.id, '34859');
    assert.deepEqual(Object.keys(cache), ['34859']);
});

test('根类目使用空请求体；不遍历类目树、不扫描全店', async () => {
    const calls = [];
    const found = await lookupCategory(async (endpoint,body) => {
        calls.push(body);
        return endpoint.endsWith('searchForChainSupplier') ? product([1]) : names([{catId:1,catName:'根类目',parentCatId:0}]);
    }, '123');
    assert.deepEqual(calls[1], {});
    assert.equal(calls.length, 2);
    assert.equal(found.name, '根类目');
});

test('名称接口失败、缺字段、错误 ID/父级或重复结果均不缓存；有效 ID 仍保留', async () => {
    const invalid = [new Error('HTTP 503'), {}, names([]), names([{catId:999,catName:'错的',parentCatId:30972}]),
        names([{catId:30977,catName:'错父级',parentCatId:1}]), names([{catId:30977,catName:'',parentCatId:30972}]),
        names([{catId:30977,catName:'甲',parentCatId:30972},{catId:30977,catName:'乙',parentCatId:30972}])];
    for (const value of invalid) {
        const cache = {};
        const found = await lookupCategory(async endpoint => {
            if (endpoint.endsWith('searchForChainSupplier')) return product();
            if (value instanceof Error) throw value;
            return value;
        }, '123', cache);
        assert.equal(found.id,'30977');
        assert.equal(found.name,'');
        assert.match(found.nameWarning,/名称查询失败/);
        assert.deepEqual(cache,{});
    }
});

test('SPU 或父级冲突时不请求名称；父级变化不复用旧缓存', async () => {
    let calls = 0;
    await assert.rejects(lookupCategory(async () => {
        calls++;
        return {result:{dataList:[{productId:123,catIdList:[1,30977]},{productId:123,catIdList:[2,30977]}]}};
    }, '123'), /父类目/);
    assert.equal(calls,1);
    const cache = {30977:{name:'过期',parentId:'1'}};
    const found = await lookupCategory(async endpoint => endpoint.endsWith('searchForChainSupplier') ? product() : names(), '123', cache);
    assert.equal(found.name,'旅行包、行李包');
    assert.equal(cache[30977].parentId,'30972');
});

test('已缓存名称补全旧规则，不改变备注、SPU、区域或开关；损坏缓存丢弃', () => {
    const cache = normalizeNameCache({30977:{name:'旅行包、行李包',parentId:30972},1:{name:'',parentId:0},2:{name:'坏父级',parentId:'xx'}});
    assert.deepEqual(Object.keys(cache), ['30977']);
    const settings = normalizeSettings({schemaVersion:2,enabled:true,rules:{30977:{name:'类目 ID 30977',spu:'123',label:'我的备注',area:2}}},cache);
    assert.equal(settings.enabled,true);
    assert.deepEqual(settings.rules[30977],{name:'旅行包、行李包',spu:'123',label:'我的备注',area:2,parent:''});
});
