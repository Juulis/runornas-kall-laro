// Röktest av Pages-artefakten: servera dist/ under /runornas-kall-laro/ och verifiera 2D-spelet på roten.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const dist = resolve(process.argv[2] ?? 'dist');
/** plain = produktionsbygge. full = capture-hook + prestandabudget. */
const smokeMode = process.env.SMOKE_MODE === 'plain' ? 'plain' : 'full';
const captureBuild = smokeMode === 'full';
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.jpg': 'image/jpeg',
};
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

const fail = [];
if (!existsSync(join(dist, 'index.html'))) fail.push('roten saknar index.html');
if (existsSync(join(dist, 'game.js'))) fail.push('roten innehåller legacy game.js (3D ska inte deployas)');
if (!existsSync(join(dist, 'assets'))) fail.push('roten saknar assets/ (Vite-bygget)');

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function readMetrics(page) {
  return page.evaluate(() => {
    const cap = window.__game?.captureBigWorldMetrics?.();
    if (cap) return { ...cap, heroChunk: document.documentElement.dataset.heroChunk ?? '' };
    const d = document.documentElement.dataset;
    return {
      groundReady: d.groundReady === '1',
      displayObjects: Number(d.groundObjects ?? 0),
      renderTextures: Number(d.renderTextures ?? 0),
      groundPixel: d.groundPixel === '1',
      heroWx: Number(d.heroWx ?? 0),
      heroWy: Number(d.heroWy ?? 0),
      heroChunk: d.heroChunk ?? '',
    };
  });
}

async function visit(path, check, startGame = false) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && r.url().startsWith(base) && errs.push(`${r.status()} ${r.url()}`));
  await page.goto(base + path, { waitUntil: 'load' });
  if (startGame) await startNewGame(page);
  else await page.waitForTimeout(6000);
  const ok = await page.evaluate(check);
  if (!ok) errs.push('spelet startade inte (kontroll misslyckades)');
  console.log(`${path || '/'}: ${errs.length ? 'FEL' : 'OK'}`);
  for (const e of errs) fail.push(`${path || '/'}: ${e}`);
  await page.close();
}

async function startNewGame(page, heroName = 'Rök') {
  await page.waitForSelector('#hmNewHero', { timeout: 30000 });
  await page.click('#hmNewHero');
  await page.waitForSelector('.hero-name', { timeout: 10000 });
  await page.fill('.hero-name', heroName);
  await page.click('#hnOk');
  await page.waitForSelector('#app canvas', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.hero-menu')?.classList.contains('hidden'), null, { timeout: 90000 });
  await page.waitForFunction(() => document.documentElement.dataset.zone === 'forest', null, { timeout: 90000 });
}

const gameReady = async () => {
  const d = document.documentElement.dataset;
  if (!document.querySelector('#app canvas') || d.zone !== 'forest' || !document.querySelector('#hud')) return false;
  if (d.bigWorld !== '1') return false;
  if (d.runes !== '3') return false;
  const cm = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  document.querySelector('#app canvas').dispatchEvent(cm);
  const alt = new KeyboardEvent('keydown', { key: 'Alt', code: 'AltLeft', bubbles: true, cancelable: true });
  window.dispatchEvent(alt);
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', code: 'AltLeft', bubbles: true, cancelable: true }));
  const labels = document.querySelector('#lootLabels');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  const zOn = labels?.classList.contains('on');
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', code: 'KeyZ', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  const zOff = !labels?.classList.contains('on');
  return cm.defaultPrevented && alt.defaultPrevented && zOn && zOff;
};

await visit('', gameReady, true);

async function runChunkStreamTest(page, modeLabel) {
  const chunkErrs = [];
  page.on('pageerror', (e) => chunkErrs.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && chunkErrs.push(m.text()));
  const chunkUrl = captureBuild ? base : `${base}?smoke=1`;
  await page.goto(chunkUrl, { waitUntil: 'load' });
  await startNewGame(page, 'Chunk');

  async function waitGroundReady(ms = 120000) {
    await page.waitForFunction(
      () => window.__game?.captureBigWorldMetrics?.()?.groundReady === true || document.documentElement.dataset.groundReady === '1',
      null,
      { timeout: ms, polling: 200 },
    );
  }

  try {
    await waitGroundReady();
  } catch {
    chunkErrs.push('mark blev inte klar (groundReady)');
  }

  const startProbe = await readMetrics(page);
  const startChunk = startProbe.heroChunk || '0,0';
  const wxBefore = startProbe.heroWx;

  if (captureBuild) {
    const chunkSpan = 128;
    const teleported = await page.evaluate(
      ({ x, y, span }) => {
        if (!window.__smoke?.teleportWorld) return false;
        window.__smoke.teleportWorld(x + span * 1.5, y);
        return true;
      },
      { x: startProbe.heroWx, y: startProbe.heroWy, span: chunkSpan },
    );
    if (!teleported) chunkErrs.push('teleportWorld saknas (capture-bygge)');
    try {
      await page.waitForFunction(
        (prev) => {
          const c = document.documentElement.dataset.heroChunk;
          return !!c && c !== prev;
        },
        startChunk,
        { timeout: 30000, polling: 200 },
      );
    } catch {
      chunkErrs.push('chunkbyte: heroChunk ändrades inte efter teleport');
    }
  } else {
    let crossed = false;
    for (let attempt = 0; attempt < 48 && !crossed; attempt++) {
      await page.evaluate(() => window.__smoke?.moveHeroBy(48, 0));
      try {
        await page.waitForFunction(
          (prev) => {
            const c = document.documentElement.dataset.heroChunk;
            return !!c && c !== prev;
          },
          startChunk,
          { timeout: 8000, polling: 250 },
        );
        crossed = true;
      } catch {
        /* långsam gång på CI — fortsätt nudge */
      }
    }
    if (!crossed) chunkErrs.push('chunkbyte: heroChunk ändrades inte (plain moveHeroBy)');
  }

  try {
    await waitGroundReady(90000);
  } catch {
    chunkErrs.push('mark blev inte klar efter chunkbyte (groundReady)');
  }

  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__smoke?.moveHeroBy(24, 0));
  await page.waitForTimeout(1500);
  const wxAfter = Number((await readMetrics(page)).heroWx);
  if (Math.abs(wxAfter - wxBefore) < 0.5) chunkErrs.push('ingen rörelse efter chunkbyte');

  let chunkProbe;
  if (captureBuild) {
    chunkProbe = await page.evaluate(async () => {
      const read = () => {
        const cap = window.__game?.captureBigWorldMetrics?.();
        if (cap) return cap;
        const d = document.documentElement.dataset;
        return {
          groundReady: d.groundReady === '1',
          displayObjects: Number(d.groundObjects ?? 0),
          renderTextures: Number(d.renderTextures ?? 0),
          groundPixel: d.groundPixel === '1',
        };
      };
      const m = read();
      const fpsSamples = [];
      for (let s = 0; s < 5; s++) {
        let frames = 0;
        const t0 = performance.now();
        await new Promise((resolve) => {
          const loop = () => {
            frames++;
            if (performance.now() - t0 >= 1000) return resolve(undefined);
            requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        });
        fpsSamples.push(frames);
      }
      fpsSamples.sort((a, b) => a - b);
      return {
        groundPixel: m?.groundPixel,
        textures: m?.renderTextures ?? 0,
        objects: m?.displayObjects ?? 0,
        fpsMedian: fpsSamples[2] ?? fpsSamples[0] ?? 0,
      };
    });
    if (!chunkProbe.groundPixel) chunkErrs.push('pixelprov såg ingen mark');
    if (chunkProbe.textures > 50) chunkErrs.push(`för många RT: ${chunkProbe.textures}`);
    if (chunkProbe.objects > 30_000) chunkErrs.push(`för många byggda mark-objekt: ${chunkProbe.objects}`);
    if (chunkProbe.fpsMedian < 2) chunkErrs.push(`låg median-fps: ${chunkProbe.fpsMedian}`);
  } else {
    chunkProbe = await page.evaluate(async () => {
      const read = () => {
        const cap = window.__game?.captureBigWorldMetrics?.();
        if (cap) return cap;
        const d = document.documentElement.dataset;
        return {
          groundReady: d.groundReady === '1',
          displayObjects: Number(d.groundObjects ?? 0),
          renderTextures: Number(d.renderTextures ?? 0),
          groundPixel: d.groundPixel === '1',
        };
      };
      const m = read();
      const fpsSamples = [];
      for (let s = 0; s < 5; s++) {
        let frames = 0;
        const t0 = performance.now();
        await new Promise((resolve) => {
          const loop = () => {
            frames++;
            if (performance.now() - t0 >= 1000) return resolve(undefined);
            requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        });
        fpsSamples.push(frames);
      }
      fpsSamples.sort((a, b) => a - b);
      return {
        ...m,
        fpsMedian: fpsSamples[2] ?? fpsSamples[0] ?? 0,
      };
    });
    if (!chunkProbe.groundReady) chunkErrs.push('plain: groundReady saknas efter chunkbyte');
    if (!chunkProbe.groundPixel) chunkErrs.push('plain: groundPixel saknas efter chunkbyte');
    const objects = chunkProbe.displayObjects ?? chunkProbe.objects ?? 0;
    if (objects <= 0) chunkErrs.push('plain: inga mark-objekt mätta');
    if ((chunkProbe.fpsMedian ?? 0) < 2) chunkErrs.push(`plain: låg median-fps: ${chunkProbe.fpsMedian}`);
  }

  console.log(`chunk-stream (${modeLabel}): ${JSON.stringify({ ...chunkProbe, startChunk })}`);
  return chunkErrs;
}

{
  const chunkPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = await runChunkStreamTest(chunkPage, smokeMode);
  if (captureBuild) {
    const heroId = await chunkPage.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('rpg_hero_'));
      const last = keys.sort().pop();
      if (!last) return null;
      try {
        const raw = JSON.parse(localStorage.getItem(last) || 'null');
        return raw?.game?.worldSeed != null ? { id: raw.hero?.id, worldSeed: raw.game.worldSeed } : null;
      } catch {
        return null;
      }
    });
    if (!heroId?.worldSeed) errs.push('autospar saknar worldSeed i localStorage');
    else {
      const ws0 = heroId.worldSeed;
      await chunkPage.reload({ waitUntil: 'load' });
      await chunkPage.waitForSelector('#hmNewHero', { timeout: 30000 });
      await chunkPage.click('#hmCont');
      await chunkPage.waitForFunction(() => document.documentElement.dataset.zone === 'forest', null, { timeout: 90000 });
      const ws1 = await chunkPage.evaluate((id) => {
        const raw = JSON.parse(localStorage.getItem(`rpg_hero_${id}`) || 'null');
        return raw?.game?.worldSeed ?? null;
      }, heroId.id);
      if (ws1 !== ws0) errs.push(`worldSeed ändrades efter Fortsätt: ${ws0} -> ${ws1}`);
    }
  }
  if (errs.length) fail.push(...errs.map((e) => `chunk: ${e}`));
  await chunkPage.close();
}

for (const legacyPath of ['next/', 'legacy-3d/']) {
  const page = await browser.newPage();
  await page.goto(base + legacyPath, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const ok = new URL(page.url()).pathname.endsWith('/runornas-kall-laro/') || new URL(page.url()).pathname === '/runornas-kall-laro/';
  console.log(`${legacyPath}: ${ok ? 'OK (omdirigerad)' : 'FEL'}`);
  if (!ok) fail.push(`${legacyPath} omdirigerar inte till roten`);
  await page.close();
}

await browser.close();
server.close();
if (fail.length) {
  console.error('Röktest misslyckades:\n- ' + fail.join('\n- '));
  process.exit(1);
}
console.log('Röktest OK');
