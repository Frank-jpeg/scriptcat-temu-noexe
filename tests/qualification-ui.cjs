const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})});
 try {
  const page=await browser.newPage({viewport:{width:607,height:710}});
  await page.route('https://agentseller.temu.com/**',r=>r.fulfill({contentType:'text/html',body:'<!DOCTYPE html><body>fixture</body>'}));
  await page.goto('https://agentseller.temu.com/newon/product-select');
  await page.clock.install();
  await page.evaluate(()=>{
   localStorage.setItem('agentseller-mall-info-id','123');
   localStorage.setItem('goldabcd_qualification_v1:123',JSON.stringify({version:1,template:'48477498749',enabled:true,targets:['47746411789']}));
   window.reads=0;window.logs=[];
   addEventListener('goldabcd-noexe-log-event',e=>logs.push(e.detail));
   window.fetch=async(url,opts)=>{
    reads++;const body=JSON.parse(opts.body);
    if(url.endsWith('/list'))return {ok:true,json:async()=>({success:true,result:{total:1,product_with_cert_list:[{product_base_info:{product_id:48477498749,cate_ids:[1,10856],leaf_category_name:'马克杯',can_edit:true},product_cert_info_list:[]}]}})};
    const file={file_name:'test.pdf',original_file_url:'https://example.test/test.pdf'};
    return {ok:true,json:async()=>({success:true,result:{product_cert_info:{cert_type:body.cert_type,inspect_report_files:body.cert_type===132?[file]:[],product_cert_files:[],file_upload_type:1,multi_lang_product_cert_file_map:{en:[file]}}}})};
   };
  });
  await page.addScriptTag({path:path.resolve('temu-life-9-qualification.user.js')});
  const host=page.locator('#goldabcd-qualification-host');await host.locator('.open').click();
  assert.equal(await host.locator('textarea').count(),0);
  assert.equal(await page.evaluate(()=>reads),0);
  assert.ok(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('goldabcd_qualification_v1:123:backup:'))));
  for(const size of [{width:607,height:710},{width:375,height:400},{width:1280,height:720}]){
   await page.setViewportSize(size);
   await page.evaluate(()=>dispatchEvent(new Event('resize')));
   const b=await host.locator('.panel').boundingBox();assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=size.width&&b.y+b.height<=size.height);
  }
  await host.locator('.enable').click();
  await host.locator('.status').filter({hasText:'本轮完成'}).waitFor();
  const first=await page.evaluate(()=>reads);assert.equal(first,4);
  await page.clock.fastForward(6*60*60*1000);
  await page.waitForFunction(n=>reads===n*2,first);
  assert.ok((await page.evaluate(()=>logs)).some(l=>l.scriptName.includes('-9-')));
  await host.locator('.stop').click();const stopped=await page.evaluate(()=>reads);
  await page.clock.fastForward(6*60*60*1000);assert.equal(await page.evaluate(()=>reads),stopped);
  await page.evaluate(()=>localStorage.setItem('agentseller-mall-info-id','456'));
  await page.clock.fastForward(1000);assert.equal(await host.locator('.enable').isDisabled(),true);
  console.log('PASS: 小屏边界、无目标输入、迁移备份、6小时循环、暂停、切店、日志事件');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
