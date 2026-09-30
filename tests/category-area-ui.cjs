const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
(async () => {
  const server = spawn(process.execPath, ['tests/browser-server.cjs']);
  let browser;
  try {
    const base = await new Promise((resolve, reject) => { server.stdout.once('data', d => resolve(String(d).trim())); server.once('error', reject); });
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:1280,height:960}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'?area=1');
    const host=page.locator('#goldabcd-category-area-host');
    await host.locator('.open').click();
    for (const [spu,area] of [['111','1'],['222','2']]) {
      await host.locator('.spu').fill(spu); await host.locator('.load').click();
      await host.locator('.category').filter({hasText:'帽子'}).waitFor();
      await host.locator('.area').selectOption(area); await host.locator('.save-template').click();
    }
    assert.equal(await host.locator('tbody tr').count(),2);
    let reads=await page.evaluate(()=>fixture.reads);
    assert.equal(reads.length,2); assert.ok(reads.every(r=>r.productSpuIdList));
    assert.equal(await page.evaluate(()=>fixture.nameReads.length),2);
    assert.equal(await page.evaluate(()=>fixture.writes.length),0);
    await page.reload();await host.locator('.open').click();
    assert.equal(await host.locator('tbody tr').count(),2);
    await host.locator('.enable').click();
    await page.waitForFunction(()=>fixture.writes.length===2);
    await host.locator('.stop').click();
    await page.waitForFunction(()=>!document.querySelector('#goldabcd-category-area-host').shadowRoot.querySelector('.spu').disabled);
    const writes=await page.evaluate(()=>fixture.writes);
    assert.deepEqual(writes.map(w=>w.productSkcIdList),[['a'],['b']]);
    await host.locator('tbody tr').first().getByText('编辑',{exact:true}).click();
    await host.locator('.area').selectOption('2'); await host.locator('.save-template').click();
    assert.equal(await host.locator('tbody tr').count(),2);
    await host.locator('tbody tr').last().getByText('删除',{exact:true}).click();
    assert.equal(await host.locator('tbody tr').count(),1);
    await host.locator('.spu').fill('999'); await host.locator('.load').click();
    await host.locator('.status').filter({hasText:'未找到'}).waitFor();
    assert.equal(await host.locator('.save-template').isDisabled(),true);
    await host.locator('.new').click();
    await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(), 'temu-area-rules-preview.png')});
    await page.evaluate(()=>localStorage.setItem('goldabcd_category_area_v1:area-test-mall',JSON.stringify({enabled:true,activeTemplate:'甲',templates:[{name:'甲',rules:{100:{name:'帽子',area:1}}},{name:'乙',rules:{200:{name:'水杯',area:2}}}]})));
    await page.reload(); await host.locator('.open').click();
    assert.equal(await host.locator('tbody tr').count(),2);
    assert.match(await host.locator('.status').innerText(),/已暂停/);
    assert.ok(await page.evaluate(()=>localStorage.getItem('goldabcd_category_area_v1:area-test-mall:before-v2')));

    // Cache survived reload: SPU is still checked, but no name request is made.
    await host.locator('.spu').fill('111'); await host.locator('.load').click();
    await host.locator('.category').filter({hasText:'帽子'}).waitFor();
    assert.equal(await page.evaluate(()=>fixture.reads.length),1);
    assert.equal(await page.evaluate(()=>fixture.nameReads.length),0);
    await host.locator('.new').click();

    // Names that fail to load remain retryable and never prevent saving a valid category ID.
    await page.evaluate(()=>{fixture.failNames=true;});
    await host.locator('.spu').fill('333'); await host.locator('.load').click();
    await host.locator('.status').filter({hasText:'名称查询失败'}).waitFor();
    assert.equal(await host.locator('.save-template').isDisabled(),false);
    assert.match(await host.locator('.category').innerText(),/ID 300/);
    await page.evaluate(()=>{fixture.failNames=false;});
    await host.locator('.load').click();
    await host.locator('.category').filter({hasText:'水杯'}).waitFor();
    assert.equal(await page.evaluate(()=>fixture.nameReads.length),2);
    await host.locator('.save-template').click();
    await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(),'temu-area-name-cache-preview.png')});

    await page.evaluate(()=>localStorage.setItem('goldabcd_category_area_v1:area-test-mall',JSON.stringify({schemaVersion:2,enabled:false,rules:{100:{name:'类目 ID 100',label:'我的备注',spu:'111',area:2}}})));
    await page.reload(); await host.locator('.open').click();
    assert.match(await host.locator('tbody').innerText(),/帽子/);
    assert.match(await host.locator('tbody').innerText(),/我的备注/);
    assert.match(await host.locator('tbody').innerText(),/义乌/);
    assert.equal(await page.evaluate(()=>fixture.reads.length+fixture.nameReads.length+fixture.writes.length),0);
    assert.deepEqual(errors,[]);
    console.log('UI PASS: SPU精确查询、首次名称查询、刷新缓存命中、多规则执行、保存恢复、旧规则补名、编辑删除、名称失败与恢复、旧模板迁移');
  } finally { if(browser)await browser.close(); server.kill(); }
})().catch(e=>{console.error(e);process.exitCode=1});
