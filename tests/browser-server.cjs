// 本机模拟页面。所有 TEMU 请求由 fixture 拦截，不读取真实登录态或修改店铺。
// node tests/browser-server.cjs
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = {
    '/newon/product-select': path.join(__dirname, 'fixtures/price-browser.html'),
    '/price.js': path.join(root, 'temu-life-1-price.user.js'),
    '/reject.js': path.join(root, 'temu-life-7-reject.user.js')
};
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!files[pathname]) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(fs.readFileSync(files[pathname]));
});
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port + '/newon/product-select'));
