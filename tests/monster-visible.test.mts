/**
 * Räknar aktiva monster nära hjälten mot vite preview med bas /runornas-kall-laro/.
 * Misslyckas om det är tomt eller nästan tomt vid start och efter ungefär 10 s gång.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { campFirePos } from '../src/world/bigWorld/campMonsterField';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = [join(root, 'shots'), '/workspace/laro/shots'];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function run(cmd: string, args: string[], ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: 'inherit' });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${cmd} tog för lång tid`));
    }, ms);
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} avslutades med ${code}`));
    });
  });
}

/** Tar bort ANSI-färgkoder så att loggrader som "Local:" går att matcha även när Vite färglägger utskriften i CI. */
function stripAnsi(text: string): string {
  return text.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*[A-Za-z]', 'g'), '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chromiumMissing(): boolean {
  try {
    return !existsSync(chromium.executablePath());
  } catch {
    return true;
  }
}

function isMissingBrowserError(err: unknown): boolean {
  const msg = String(err);
  return /executable does(?:n't| not) exist|browserType\.launch|Looks like Playwright/i.test(msg);
}

/**
 * Väntar tills vite preview svarar på url:en.
 * Loggen används bara som felsökningsunderlag, och ANSI strippas så "Local:" syns även med färger.
 */
async function waitForPreview(child: ReturnType<typeof spawn>, url: string, ms: number): Promise<void> {
  let buf = '';
  let exited: number | null = null;
  const onData = (chunk: Buffer): void => {
    buf += stripAnsi(chunk.toString());
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.once('exit', (code) => {
    exited = code ?? 1;
  });

  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (exited !== null) {
      throw new Error(`vite preview avslutades (${exited}): ${buf.slice(-500)}`);
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {
      /* preview lyssnar inte än */
    }
    await sleep(200);
  }
  const hint = buf.includes('Local:') ? 'loggen innehöll Local: men HTTP svarade inte' : 'ingen Local:-rad efter ANSI-rensning';
  throw new Error(`timeout väntade på ${url} (${hint}): ${buf.slice(-500)}`);
}

type Probe = { total: number; near: number; textured: number; quiz: boolean; hx: number; hy: number };

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const bag = globalThis as unknown as {
      __game?: {
        state: {
          hero: { pos: { x: number; y: number } };
          monsters: {
            dead: number;
            pos: { x: number; y: number };
            view?: { sprite?: { visible?: boolean; texture?: { width?: number } } };
          }[];
        } | null;
      };
    };
    const w = bag.__game?.state;
    if (!w) return { total: 0, near: 0, textured: 0, quiz: false, hx: 0, hy: 0 };
    const h = w.hero.pos;
    let near = 0;
    let textured = 0;
    for (const m of w.monsters) {
      if (m.dead) continue;
      const d = Math.hypot(m.pos.x - h.x, m.pos.y - h.y);
      if (d > 40) continue;
      near += 1;
      const width = m.view?.sprite?.texture?.width ?? 0;
      if (m.view?.sprite?.visible !== false && width > 16) textured += 1;
    }
    const quiz = document.querySelector('#rk-learn-quiz:not(.hidden)');
    return { total: w.monsters.length, near, textured, quiz: !!quiz, hx: h.x, hy: h.y };
  });
}

/**
 * Går längs en båge runt elden, innanför vargarnas ring.
 * Frågerutan öppnas nästan vid beröring, så målet hålls en bit från närmaste monster.
 */
async function steer(page: Page, fire: { x: number; y: number }, angle: number): Promise<void> {
  await page.evaluate(
    ({ fx, fy, ang }) => {
      const bag = globalThis as unknown as {
        __game?: {
          state: {
            hero: { pos: { x: number; y: number } };
            monsters: { dead: number; pos: { x: number; y: number } }[];
          } | null;
        };
        __smoke?: { moveHeroBy(dx: number, dy: number): void };
      };
      const w = bag.__game?.state;
      const smoke = bag.__smoke;
      if (!w || !smoke) return;
      const h = w.hero.pos;
      const radius = 8;
      let tx = fx + Math.cos(ang) * radius;
      let ty = fy + Math.sin(ang) * radius;
      let clearance = 80;
      for (const m of w.monsters) {
        if (m.dead) continue;
        clearance = Math.min(clearance, Math.hypot(m.pos.x - tx, m.pos.y - ty));
      }
      if (clearance < 6) {
        tx = fx + Math.cos(ang + Math.PI) * 4;
        ty = fy + Math.sin(ang + Math.PI) * 4;
      }
      smoke.moveHeroBy(tx - h.x, ty - h.y);
    },
    { fx: fire.x, fy: fire.y, ang: angle },
  );
}

if (chromiumMissing()) {
  console.log(
    'Hoppar över monster-visible.test.mts: Playwright Chromium saknas i den här miljön. Installera med: npx playwright install chromium',
  );
  process.exit(0);
}

if (!existsSync(join(root, 'dist/index.html'))) {
  console.log('dist saknas, bygger innan preview');
  await run('npx', ['vite', 'build'], 180000);
}

function stopPreview(child: ReturnType<typeof spawn>): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* redan stoppad */
    }
  }
}

const port = await freePort();
const previewEnv = { ...process.env };
if (process.env.FORCE_COLOR !== '1') {
  previewEnv.NO_COLOR = '1';
  previewEnv.FORCE_COLOR = '0';
}
const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
  env: previewEnv,
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
let exitCode = 0;
try {
  const origin = `http://127.0.0.1:${port}/runornas-kall-laro/`;
  await waitForPreview(preview, origin, 45000);
  const base = `${origin}?smoke=1`;
  try {
    browser = await chromium.launch({
      args: [
        '--use-gl=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    });
  } catch (err) {
    if (isMissingBrowserError(err)) {
      console.log(
        `Hoppar över monster-visible.test.mts: Playwright Chromium kunde inte startas (${String(err).split('\n')[0]}). Installera med: npx playwright install --with-deps chromium`,
      );
    } else {
      throw err;
    }
  }
  if (browser) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const misses: string[] = [];
    page.on('response', (r) => {
      if (r.status() >= 400 && r.url().includes('/runornas-kall-laro/')) misses.push(`${r.status()} ${r.url()}`);
    });
    page.on('pageerror', (e) => misses.push(String(e)));
    await page.goto(base, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('#hmNewHero', { timeout: 60000 });
    await page.click('#hmNewHero');
    await page.fill('.hero-name', 'Mira');
    await page.click('#hnOk');
    await page.waitForFunction(() => document.documentElement.dataset.zone === 'forest', null, { timeout: 90000 });
    await page.waitForFunction(
      () => {
        const bag = globalThis as unknown as { __game?: { state?: { monsters?: unknown[] } } };
        return (bag.__game?.state?.monsters?.length ?? 0) >= 8;
      },
      null,
      { timeout: 20000 },
    );
    await page.waitForTimeout(800);
    for (const dir of shots) mkdirSync(dir, { recursive: true });
    const start = await probe(page);
    console.log('monster vid start', start);
    assert.equal(start.quiz, false, 'frågerutan ska inte täcka lägret direkt');
    assert.ok(start.near >= 6, `för få monster nära start: ${start.near} (totalt ${start.total})`);
    assert.ok(start.textured >= 4, `monster saknar synlig sprite (texturer ${start.textured}). 404: ${misses.slice(0, 8).join(' | ')}`);
    for (const dir of shots) await page.screenshot({ path: join(dir, 'monster-start.png') });

    await page.bringToFront();
    const fire = campFirePos();
    const t0 = Date.now();
    let path = 0;
    let prev = { x: start.hx, y: start.hy };
    let ang = Math.atan2(start.hy - fire.y, start.hx - fire.x);
    while (Date.now() - t0 < 10000) {
      ang += 0.45;
      await steer(page, fire, ang);
      await page.waitForTimeout(400);
      const step = await probe(page);
      path += Math.hypot(step.hx - prev.x, step.hy - prev.y);
      prev = { x: step.hx, y: step.hy };
    }
    await page.waitForTimeout(400);
    const walked = await probe(page);
    console.log('monster efter gång', walked, 'gick', path.toFixed(1));
    assert.ok(path >= 12, `hjälten gick bara ${path.toFixed(1)} enheter på 10 s`);
    assert.ok(walked.near >= 5, `för få monster efter gång: ${walked.near} (totalt ${walked.total})`);
    assert.ok(walked.textured >= 3, `sprite saknas efter gång (${walked.textured})`);
    assert.equal(walked.quiz, false, 'gången ska visa världen, inte frågerutan');
    for (const dir of shots) await page.screenshot({ path: join(dir, 'monster-walk.png') });
    const assetMiss = misses.filter((m) => m.includes('/assets/') || m.includes('monster'));
    assert.equal(assetMiss.length, 0, `saknade filer under bas-sökvägen: ${assetMiss.slice(0, 8).join(' | ')}`);
    console.log('monster-visible.test.mts: ok');
  }
} catch (err) {
  exitCode = 1;
  console.error(err);
} finally {
  await Promise.race([browser?.close(), new Promise((r) => setTimeout(r, 4000))]);
  stopPreview(preview);
  preview.stdout?.destroy();
  preview.stderr?.destroy();
  process.exit(exitCode);
}
