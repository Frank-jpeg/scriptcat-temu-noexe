// 模拟读网络错误/超时/服务不可用，以及写请求结果不明。所有请求由 fixture 拦截。
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

(async () => {
  const server = spawn(process.execPath, ['tests/browser-server.cjs']);
  let browser;
  try {
    const base = await new Promise((resolve, reject) => { server.stdout.once('data', d => resolve(String(d).trim())); server.once('error', reject); });
    browser = await chromium.launch({ headless: true });
    for (const name of ['8', '7']) {
      const interval = name === '8' ? 7200000 : 60000;
      const key = name === '8' ? 'goldabcd_category_area_v1:area-test-mall' : 'goldabcd_auto_reject_v1:test-mall';
      for (const mode of ['network', 'body-network', 'timeout', '503', 'write', 'auth', 'malformed', 'stop', ...(name === '7' ? ['verification'] : [])]) {
        const context = await browser.newContext();
        const page = await context.newPage();
        // 此测试只验证 7/8 的请求与定时器，隔离 fixture 附带的第 1 个脚本。
        await page.route('**/price.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.clock.install(); await page.clock.pauseAt(new Date());
        await page.goto(base + (name === '8' ? '?area' : ''));
        if (name === '8') {
          await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ schemaVersion: 2, enabled: false, rules: { 100: { name: '帽子', area: 1 } } })), key);
          await page.reload();
        }
        await page.evaluate(({ mode }) => {
          const mock = window.fetch;
          window.probe = { reads: 0, writes: 0 };
          window.fetch = async (url, options) => {
            const write = /editExpectReceiveArea|no-bom\/review/.test(String(url));
            probe[write ? 'writes' : 'reads']++;
            if (write && mode === 'write') throw new TypeError('Failed to fetch');
            if (!write && probe.reads > 1 && mode === 'verification') throw new TypeError('复查连接中断');
            if (!write && probe.reads === 1) {
              if (mode === 'network' || mode === 'stop') throw new TypeError('Failed to fetch');
              if (mode === 'body-network') return { ok: true, json: async () => { throw new TypeError('响应读取中断'); } };
              if (mode === 'timeout') return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
              if (mode === '503' || mode === 'auth') return { ok: false, status: mode === '503' ? 503 : 401 };
              if (mode === 'malformed') return { ok: true, json: async () => { throw new SyntaxError('bad json'); } };
            }
            return mock(url, options);
          };
        }, { mode });
        const host = page.locator(name === '8' ? '#goldabcd-category-area-host' : '#goldabcd-reject-price-host');
        await host.locator('.open').click(); await host.locator('.enable').click();
        await page.clock.fastForward(1);
        if (mode === 'timeout') await page.clock.fastForward(30001);
        if (mode === 'verification') { await page.clock.fastForward(1000); await page.clock.fastForward(1000); }
        const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)).enabled, key);
        if (['write', 'auth', 'malformed', 'verification'].includes(mode)) {
          await host.locator('.status').filter({ hasText: '已暂停' }).waitFor();
          assert.equal(await saved(), false);
          const before = await page.evaluate(() => probe);
          await page.clock.fastForward(interval);
          assert.deepEqual(await page.evaluate(() => probe), before, '不可恢复异常不自动重试');
        } else {
          await host.locator('.status').filter({ hasText: '保持开启' }).waitFor();
          assert.equal(await saved(), true);
          assert.equal(await page.evaluate(() => probe.writes), 0, '查询失败不能执行旧清单');
          if (mode === 'timeout') assert.match(await host.locator('.status').innerText(), /查询超时（30 秒）/);
          if (mode === 'stop') {
            await host.locator('.stop').click(); assert.equal(await saved(), false);
            await page.clock.fastForward(interval);
            assert.equal(await page.evaluate(() => probe.reads), 1, '等待期间停用取消下一轮');
          } else {
            await page.clock.fastForward(interval - 1000);
            assert.equal(await page.evaluate(() => probe.reads), 1, '不到间隔不得频繁重查');
            await page.clock.fastForward(1000);
            await page.waitForFunction(() => probe.writes > 0);
            assert.equal(await saved(), true, '网络恢复后自行扫描并继续运行');
          }
        }
        assert.deepEqual(errors, []);
        console.log(name + ' PASS: ' + mode);
        await context.close();
      }
    }
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
