const { test } = require('node:test');
const assert = require('node:assert/strict');
const q = require('../temu-life-9-qualification.user.js');
const file = { file_name: 'report.pdf', original_file_url: 'https://example.test/report.pdf', file_url: 'https://example.test/report.pdf?sign=expired' };
const row = (id, leaf = 10856, status = 1) => ({ product_base_info: { product_id: id, cate_ids: [1,leaf], can_edit: true }, product_cert_info_list: [132,1208].map(cert_type => ({ cert_type, can_upload: true, upload_status: status, audit_status: status === 1 ? 1 : 2 })) });
const list = (rows, total = rows.length) => ({ success:true, result:{product_with_cert_list:rows,total} });
const cert = (type, template = false) => ({ cert_type: type, audit_status: template ? 4 : 1, inspect_report_files: template && type === 132 ? [file] : null, product_cert_files:null, real_pictures:[{image_url:'https://example.test/target.jpg'}], file_upload_type:1, multi_lang_product_cert_file_map: template && type === 1208 ? {en:[file]} : null, selected_check_items:{123:[456]} });
function harness(options = {}) {
  const calls = [], written = new Map();
  const rows = options.rows || [row(10000), row(10001), row(10002,999), row(10003,10856,4)];
  let stopped = false, changed = false;
  const worker = q.createWorker({ sleep:async()=>{}, stopped:()=>stopped, assertContext(){if(changed) throw Error('切店');},
    request:async(path,body,write)=>{
      calls.push({path,body,write});
      if (path.endsWith('/list')) return body.product_ids ? list([rows.find(r=>String(r.product_base_info.product_id)===body.product_ids[0])]) : list(rows.slice((body.page-1)*25,body.page*25),options.total ?? rows.length);
      if (path.endsWith('/detail')) {
        const c=cert(body.cert_type,body.product_id==='10000' || (options.templateIds || []).includes(body.product_id));
        if (options.existing && body.product_id!=='10000') c.product_cert_files=[file];
        if (options.noPictures && body.product_id!=='10000') c.real_pictures=[];
        const saved=written.get(body.product_id+':'+body.cert_type);
        if(saved && !options.verifyFail){if(body.cert_type===132)c.inspect_report_files=[file];else c.multi_lang_product_cert_file_map={en:[file]};}
        if(options.pause && body.product_id==='10001')stopped=true;
        if(options.switchMall && body.product_id==='10001')changed=true;
        return {success:true,result:{product_cert_info:c}};
      }
      assert.equal(path,'/bg-lich-mms/cert/product/upload');
      written.set(body.productId+':'+body.productCatCertReqList[0].certType,body);
      return {success:true,result:{success:!options.fail}};
    }});
  return {worker,calls,written};
}
test('自动扫描无需目标，精确类目，仅两资质，保留目标实拍图，使用原始文件URL', async()=>{
  const h=harness(), result=await h.worker.run('10000');
  assert.deepEqual(result,{candidates:1,processed:1,success:2,skipped:0});
  const writes=[...h.written.values()];
  assert.deepEqual(writes.map(b=>b.productCatCertReqList[0].certType),[132,1208]);
  assert.equal(writes[0].realPictures[0].imageUrl,'https://example.test/target.jpg');
  assert.equal(writes[0].productCatCertReqList[0].inspectReportFiles[0].fileUrl,file.original_file_url);
  assert.deepEqual(writes[1].productCatCertReqList[0].selectedCheckItems,{123:[456]});
  assert.ok(h.calls.some(c=>c.path.endsWith('/list')&&!c.body.product_ids));
});
test('分页读完才写；模板自身和已有状态跳过',async()=>{
 const rows=Array.from({length:51},(_,i)=>row(10000+i));const h=harness({rows});
 const r=await h.worker.run('10000',{limit:1});assert.equal(r.candidates,50);
 const firstWrite=h.calls.findIndex(c=>c.write);
 assert.equal(h.calls.slice(0,firstWrite).filter(c=>c.path.endsWith('/list')&&!c.body.product_ids).length,3);
});
test('已有文件不覆盖；无实拍图只跳过FCM',async()=>{
 const a=harness({existing:true});assert.equal((await a.worker.run('10000')).success,0);assert.equal(a.written.size,0);
 const b=harness({noPictures:true});assert.equal((await b.worker.run('10000')).success,1);assert.ok(b.written.has('10001:1208'));
});
test('暂停和切店在详情返回后阻止上传',async()=>{
 for(const option of [{pause:true},{switchMall:true}]){const h=harness(option);await assert.rejects(h.worker.run('10000'));assert.equal(h.written.size,0);}
});
test('双层失败和复查失败均停止，不重试写入',async()=>{
 for(const option of [{fail:true},{verifyFail:true}]){const h=harness(option);await assert.rejects(h.worker.run('10000'));assert.equal(h.calls.filter(c=>c.write).length,1);}
});
test('扫描截断、重复、超过窗口拒绝上传',async()=>{
 for(const option of [{total:10001},{total:40},{rows:[row(10000),row(10001),row(10001)]}]){const h=harness(option);await assert.rejects(h.worker.run('10000'));assert.equal(h.written.size,0);}
});
test('多模板共用完整扫描快照；重复末级类目模板拒绝启动', async()=>{
 const rows=[row(10000,10856),row(10001,20000),row(10002,20000),row(10003,30000)];
 const h=harness({rows,templateIds:['10001']});
 const result=await h.worker.runMany([{name:'马克杯',spu:'10000'},{name:'餐盘',spu:'10001'}],{limit:0});
 assert.equal(result.candidates,1);
 assert.equal(h.calls.filter(c=>c.path.endsWith('/list')&&!c.body.product_ids).length,1);
 const d=harness({rows,templateIds:['10001','10002']});
 await assert.rejects(d.worker.runMany([{name:'A',spu:'10001'},{name:'B',spu:'10002'}]),/同一末级类目/);
 assert.equal(d.written.size,0);
});
test('旧配置迁移保留模板但不自动扩大运行范围；多模板名称去重',()=>{
 assert.deepEqual(q.normalizeConfig({version:1,template:'12345',targets:['99999'],enabled:true}),{version:3,templates:[{name:'新奇马克杯',spu:'12345'}],enabled:false});
 assert.equal(q.normalizeConfig({version:3,templates:[{name:'帽子',spu:'12345'},{name:'帽子',spu:'67890'},{name:'坏',spu:'abc'}],enabled:true}).templates.length,1);
 assert.equal(q.normalizeConfig({version:3,templates:[{name:'帽子',spu:'12345'}],enabled:true}).enabled,true);
});
test('低窗口面板贴边向上调整，窄屏不溢出',()=>{
 for(const [vw,vh] of [[607,710],[375,400],[1280,720]]){const p=q.panelPosition({left:260,bottom:560},450,360,vw,vh);assert.ok(p.left>=8&&p.top>=8);assert.ok(p.left+Math.min(450,vw-16)<=vw-8);assert.ok(p.top+Math.min(360,vh-16)<=vh-8);}
});
