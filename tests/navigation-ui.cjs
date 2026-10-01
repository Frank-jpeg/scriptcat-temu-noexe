// 使用真实的本地悬挂 HTTP 请求复现刷新取消 fetch，不连接 TEMU。
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const cases = [
  { name: '8', intervalMs: 7200000, waitText: '2 小时', fixture: 'area-browser.html', host: '#goldabcd-category-area-host', key: 'goldabcd_category_area_v1:area-test-mall',
    settings: { schemaVersion: 2, enabled: false, rules: { 100: { name: '帽子', area: 1 } } },
    writePath: '/editExpectReceiveArea', completed: () => fixture.writes.length > 0 },
  { name: '7', intervalMs: 60000, waitText: '1 分钟', fixture: 'price-browser.html', host: '#goldabcd-reject-price-host', key: 'goldabcd_auto_reject_v1:test-mall',
    writePath: '/no-bom/review', completed: () => fixture.rejected.size > 0 }
];

(async () => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/pending') {
      res.setHeader('Content-Type', 'application/json');
      res.write('{"success":'); // 响应未结束，由页面刷新取消。
      return;
    }
    const files = { '/area.js': 'temu-life-8-area.user.js', '/reject.js': 'temu-life-7-reject.user.js', '/price.js': 'temu-life-1-price.user.js' };
    const file = files[url.pathname] || ('tests/fixtures/' + (url.searchParams.has('area') ? 'area-browser.html' : 'price-browser.html'));
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(root, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const c of cases) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const dialogs = [], errors = [];
      page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.accept(); });
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => { window.nativeFetch = window.fetch.bind(window); });
      await page.goto('http://127.0.0.1:' + server.address().port + '/newon/product-select' + (c.name === '8' ? '?area' : ''));
      if (c.settings) {
        await page.evaluate(({ key, settings }) => localStorage.setItem(key, JSON.stringify(settings)), { key: c.key, settings: c.settings });
        await page.reload();
      }
      const host = page.locator(c.host);
      const enabled = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)).enabled, c.key);
      const hold = async mode => page.evaluate(({ mode, writePath }) => {
        const mockFetch = window.fetch;
        window.held = false;
        window.fetch = async (url, options) => {
          if (mode === 'read' || String(url).endsWith(writePath)) {
            window.held = true;
            return nativeFetch('/pending', { method: 'POST', body: options.body });
          }
          return mockFetch(url, options);
        };
      }, { mode, writePath: c.writePath });
      for (const mode of ['read', 'write']) {
        await hold(mode);
        await host.locator('.open').click();
        const pendingResponse = page.waitForResponse(response => response.url().endsWith('/pending'));
        await host.locator('.enable').click();
        await pendingResponse;
        await page.waitForFunction(() => window.held);
        assert.equal(await enabled(), true);
        await page.reload();
        assert.equal(await enabled(), true, c.name + ' 刷新取消 ' + mode + ' 请求不能关闭已保存开关');
        assert.deepEqual(dialogs, [], c.name + ' 刷新不应弹确认');
        assert.match(await host.locator('.open').innerText(), /已开启/);
        // 不点击启用，验证恢复计时后确实产生业务请求。
        await page.waitForFunction(c.completed, null, { timeout: 12000 });
        await host.locator('.open').click();
        await host.locator('.stop').click();
        await page.reload();
        assert.equal(await enabled(), false, '手动暂停后刷新必须保持关闭');
      }
      // 非导航导致的业务失败仍然保存停用。
      await page.evaluate(() => { window.fetch = async () => ({ ok: true, json: async () => ({ success: false, errorMsg: '模拟业务失败' }) }); });
      await host.locator('.open').click(); await host.locator('.enable').click();
      await host.locator('.status').filter({ hasText: '已暂停' }).waitFor();
      assert.equal(await enabled(), false);
      await page.reload();
      assert.match(await host.locator('.open').innerText(), /已关闭/);
      // 缓存页面返回时，必须等旧请求结束，不能把它的中断误判为新一轮失败。
      await page.evaluate(() => {
        const mockFetch = window.fetch;
        window.fetch = () => new Promise((resolve, reject) => {
          window.finishOldRequest = () => { window.fetch = mockFetch; reject(new TypeError('旧页面请求已取消')); };
        });
      });
      await host.locator('.open').click(); await host.locator('.enable').click();
      await page.waitForFunction(() => typeof window.finishOldRequest === 'function');
      await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        window.finishOldRequest();
      });
      await host.locator('.status').filter({ hasText: '已恢复' }).waitFor();
      assert.equal(await enabled(), true);
      await page.waitForFunction(c.completed, null, { timeout: 12000 });
      // 验证正常完成后还会自动安排下一轮（只快进测试页面的时钟）。
      await host.locator('.status').filter({ hasText: c.waitText }).waitFor();
      await host.locator('.stop').click();
      await page.clock.install();
      const before = await page.evaluate(() => fixture.calls ? fixture.calls.length : fixture.reads.length);
      await host.locator('.enable').click();
      await page.clock.runFor(100);
      await host.locator('.status').filter({ hasText: c.waitText }).waitFor();
      const afterFirst = await page.evaluate(() => fixture.calls ? fixture.calls.length : fixture.reads.length);
      assert.ok(afterFirst > before);
      await page.clock.fastForward(c.intervalMs - 1000);
      assert.equal(await page.evaluate(() => fixture.calls ? fixture.calls.length : fixture.reads.length), afterFirst, '间隔未到不能提前开始下一轮');
      await page.clock.fastForward(1000);
      assert.ok(await page.evaluate(() => fixture.calls ? fixture.calls.length : fixture.reads.length) > afterFirst);
      assert.deepEqual(errors, []);
      console.log(c.name + ' PASS: 查询中/写入中刷新无弹窗、开关保留、自动恢复、手动暂停及业务失败仍关闭、缓存返回、持续循环');
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections(); server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
