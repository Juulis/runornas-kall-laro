/** Headless skärmbild: gång + sprint i skogen. Kör efter npm run pages. */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const dist = resolve('dist');
const out = resolve('/opt/cursor/artifacts/hero-walk-run.png');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (!url.startsWith('/runornas-kall-laro/')) return void res.writeHead(404).end();
  let p = join(dist, url.slice('/runornas-kall-laro/'.length));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
  createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/runornas-kall-laro/`;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => document.documentElement.dataset.zone === 'forest', { timeout: 15000 });
await page.keyboard.down('KeyW');
await page.waitForTimeout(400);
await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(600);
await page.screenshot({ path: out, fullPage: false });
await browser.close();
server.close();
console.log('Screenshot:', out);
