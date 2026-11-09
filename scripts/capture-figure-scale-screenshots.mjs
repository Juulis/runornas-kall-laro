/**
 * Skärmdumpar: hjälte bredvid NPC (by) och varg + skelett (skog).
 * Kör: VITE_CAPTURE_HOOK=true npm run build && node scripts/capture-figure-scale-screenshots.mjs [outDir]
 */
import { existsSync, mkdirSync } from 'node:fs';
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const dist = resolve('dist');
const outDir = resolve(process.argv[2] ?? '/opt/cursor/artifacts/screenshots');
mkdirSync(outDir, { recursive: true });

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
};

if (!existsSync(join(dist, 'index.html'))) {
  console.error('Kör VITE_CAPTURE_HOOK=true npm run build först');
  process.exit(1);
}

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

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function waitZone(page, zone) {
  await page.waitForFunction((z) => document.documentElement.dataset.zone === z, zone, { timeout: 45000 });
  await page.waitForTimeout(1500);
}

async function startNewGame(page) {
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForSelector('#hmNewHero', { timeout: 30000 });
  await page.click('#hmNewHero');
  await page.waitForSelector('.hero-name', { timeout: 10000 });
  await page.fill('.hero-name', 'Skala');
  await page.click('#hnOk');
  await page.waitForSelector('#app canvas', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.hero-menu')?.classList.contains('hidden'), null, { timeout: 30000 });
}

async function pinShowcase(page) {
  return page.evaluate(() => {
    const g = window.__game;
    if (!g?.world) return false;
    const w = g.world;
    const f = g.factory;
    if (!f) return false;
    const { x, y } = w.hero.pos;
    w.monsters.slice().forEach((m) => {
      w.objects.removeChild(m.view);
      m.view.destroy({ children: true });
    });
    w.monsters.length = 0;
    f.create(w, 'skogsvarg', { x: x + 2.2, y: y + 0.4 }, 1, null);
    f.create(w, 'skelett_krigare', { x: x - 2.2, y: y + 0.4 }, 1, null);
    for (const m of w.monsters) {
      m.view.dir = 1;
      m.view.play('idle');
    }
    w.hero.view.dir = 5;
    w.hero.view.play('idle');
    return true;
  });
}

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));

await startNewGame(page);
await waitZone(page, 'forest');
await page.evaluate(() => {
  window.__game?.enterZone('village');
});
await waitZone(page, 'village');
await page.waitForTimeout(2000);
await page.screenshot({ path: join(outDir, 'figure-scale-village.png'), fullPage: false });

await page.evaluate(() => {
  window.__game?.enterZone('forest', { x: 0, y: 4 });
});
await waitZone(page, 'forest');
const ok = await pinShowcase(page);
if (!ok) {
  console.error('Kunde inte placera showcase (kräver dev __game)');
  process.exit(1);
}
await page.waitForTimeout(800);
await page.screenshot({ path: join(outDir, 'figure-scale-forest.png'), fullPage: false });

await browser.close();
server.close();
console.log('Sparade:', join(outDir, 'figure-scale-village.png'), join(outDir, 'figure-scale-forest.png'));
