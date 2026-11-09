/**
 * Loadingskärm (#132): progress 0..1, rk-done, CSS-fallback, BASE_URL /runornas-kall-laro/.
 * Kör: npx -y node@22 --import tsx --test tests/loading-screen.test.mts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mock, test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

const OVERLAY = `
  <div id="rk-loading" class="rk-has-art" style="--rk-p:0" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Laddar">
    <div class="rk-frame">
      <img class="rk-title-img" src="/runornas-kall-laro/assets/ui/loading/titel.webp" width="360" height="172" alt="Runornas kall" />
      <h1 class="rk-title">Runornas kall</h1>
      <p class="rk-sub" data-i18n="loading.hint">Världen vaknar</p>
      <div class="rk-runsten" aria-hidden="true"><div class="rk-runsten-fill"></div></div>
      <div class="rk-bar"><div class="rk-bar-fill"></div></div>
      <div class="rk-pct"><b data-rk-pct>0</b> %</div>
    </div>
  </div>
  <div id="app"></div>
  <div id="fade"></div>`;

function mount(html = OVERLAY): { dom: JSDOM; loading: HTMLElement } {
  const dom = new JSDOM(`<!doctype html><body style="background:#0d0f12">${html}</body>`, {
    url: 'https://user.github.io/runornas-kall-laro/',
    pretendToBeVisual: true,
  });
  const g = globalThis as unknown as Record<string, unknown>;
  const win = dom.window as unknown as Record<string, unknown>;
  for (const k of [
    'window',
    'document',
    'HTMLElement',
    'HTMLImageElement',
    'Node',
    'Image',
    'Event',
    'localStorage',
    'requestAnimationFrame',
  ]) {
    g[k] = win[k];
  }
  const loading = dom.window.document.getElementById('rk-loading');
  if (!loading) throw new Error('#rk-loading saknas');
  return { dom, loading };
}

test('index.html lägger overlay före app/fade och CSS i head, med Pages-bas', async () => {
  const html = read('index.html');
  const loadingAt = html.indexOf('id="rk-loading"');
  const appAt = html.indexOf('id="app"');
  const fadeAt = html.indexOf('id="fade"');
  const headEnd = html.indexOf('</head>');
  const cssAt = html.indexOf('assets/ui/loading/loading.css');
  assert.ok(loadingAt > 0 && appAt > loadingAt && fadeAt > loadingAt);
  assert.ok(cssAt > 0 && cssAt < headEnd, 'loading.css ska länkas i head');
  assert.match(html, /href="%BASE_URL%assets\/ui\/loading\/loading\.css"/);
  assert.match(html, /src="%BASE_URL%assets\/ui\/loading\/titel\.webp"/);
  assert.match(html, /background:\s*#0d0f12/);
  assert.match(html, /data-i18n="loading\.hint">Världen vaknar/);
  assert.match(read('src/style.css'), /background:\s*#0d0f12/);

  const pages = html.replaceAll('%BASE_URL%', '/runornas-kall-laro/');
  assert.match(pages, /href="\/runornas-kall-laro\/assets\/ui\/loading\/loading\.css"/);
  assert.match(pages, /src="\/runornas-kall-laro\/assets\/ui\/loading\/titel\.webp"/);
  const dom = new JSDOM(pages, { url: 'https://user.github.io/runornas-kall-laro/index.html' });
  const { loadingArtDirectory, loadingAssetUrl } = await import('../src/ui/loadingScreen');
  assert.equal(loadingArtDirectory(dom.window.document), '/runornas-kall-laro/assets/ui/loading/');
  assert.equal(loadingAssetUrl('runa.webp', '/runornas-kall-laro/'), '/runornas-kall-laro/assets/ui/loading/runa.webp');
  assert.equal(loadingAssetUrl('titel.webp', '/runornas-kall-laro'), '/runornas-kall-laro/assets/ui/loading/titel.webp');
  assert.equal(`${loadingArtDirectory(dom.window.document)}runsten.webp`, '/runornas-kall-laro/assets/ui/loading/runsten.webp');
});

test('CSS-list och runsten delar --rk-p', () => {
  const css = read('public/assets/ui/loading/loading.css');
  assert.match(css, /#rk-loading \.rk-bar-fill\{[^}]*width:\s*calc\(var\(--rk-p\) \* 100%\)/);
  assert.match(css, /#rk-loading \.rk-runsten-fill\{[^}]*height:\s*calc\(var\(--rk-p\) \* 100%\)/);
  assert.match(css, /#rk-loading\.rk-done\{opacity:\s*0/);
  assert.match(css, /transition:\s*opacity \.45s ease/);
  for (const file of ['runa.webp', 'runsten.webp', 'stenram.webp', 'progress_track.webp', 'progress_fill.webp']) {
    assert.match(css, new RegExp(file.replace('.', '\\.')));
  }
});

test('viktad resursprogress är 0..1 och når 1 när faserna är klara', async () => {
  const { WeightedLoadProgress, fraction, clamp01 } = await import('../src/render/loadProgress');
  assert.equal(clamp01(-0.2), 0);
  assert.equal(clamp01(1.4), 1);
  assert.equal(clamp01(Number.NaN), 0);
  assert.equal(fraction(0, 4), 0);
  assert.equal(fraction(1, 4), 0.25);
  assert.equal(fraction(4, 4), 1);
  assert.equal(fraction(8, 4), 1);
  assert.equal(fraction(0, 0), 1);

  const progress = new WeightedLoadProgress({ tiles: 4, monsters: 4 });
  const seen: number[] = [];
  progress.subscribe((ratio) => seen.push(ratio));
  assert.deepEqual(seen, [0]);
  progress.setPhase('missing', 1);
  progress.setPhase('tiles', Number.NaN);
  assert.equal(progress.ratio, 0);
  progress.setPhase('tiles', fraction(1, 4));
  progress.setPhase('tiles', fraction(2, 4));
  progress.setPhase('tiles', 1);
  progress.setPhase('monsters', 0.5);
  progress.setPhase('monsters', 1);
  assert.deepEqual(seen, [0, 0.125, 0.25, 0.5, 0.75, 1]);
  for (let i = 1; i < seen.length; i++) {
    const prev = seen[i - 1];
    const cur = seen[i];
    assert.ok(prev !== undefined && cur !== undefined && cur >= prev, `dip vid ${i}`);
  }
  progress.seal();
  assert.equal(progress.ratio, 1);
  assert.equal(seen.at(-1), 1);
});

test('startup-vikter följer riktiga steg och varje setPhase-fas har vikt', async () => {
  const { startupLoadWeights, TILES, DECOR } = await import('../src/render/Assets');
  const { HERO_SHEET_STEPS } = await import('../src/render/HeroSprites');
  const { KNIGHT_EQUIP_INDEX_STEPS, KNIGHT_EQUIP_SHEET_STEPS } = await import('../src/render/KnightEquipmentSprites');
  const { worldFigureLoadSteps } = await import('../src/render/WorldFigureSprites');
  const weights = startupLoadWeights();
  assert.equal(weights.tiles, TILES.length);
  assert.equal(weights.decor, DECOR.length + 2);
  assert.equal(weights.hero, HERO_SHEET_STEPS + KNIGHT_EQUIP_INDEX_STEPS + KNIGHT_EQUIP_SHEET_STEPS);
  assert.equal(HERO_SHEET_STEPS, 15);
  assert.equal(weights.worldFigures, worldFigureLoadSteps());
  assert.equal(worldFigureLoadSteps(), 24);
  assert.equal(weights.bg, 7);
  assert.equal(weights.icons, 1);
  assert.equal(weights.npcs, 14);
  assert.ok(weights.monsters >= 30);

  const equip = JSON.parse(read('public/assets/2d/sprites/hero/utrustning/riddare_utrustning.json')) as {
    anims: Record<string, { filer: Record<string, string> }>;
  };
  let sheets = 0;
  for (const spec of Object.values(equip.anims)) sheets += Object.keys(spec.filer).length;
  assert.equal(sheets, KNIGHT_EQUIP_SHEET_STEPS);

  const npc = JSON.parse(read('public/assets/2d/sprites/npc/npc.json')) as { npc: Record<string, unknown> };
  assert.equal(Object.keys(npc.npc).length + 1, weights.npcs);

  const monsters = JSON.parse(read('public/assets/2d/sprites/monster/index.json')) as { sheets: string[] };
  assert.ok(monsters.sheets.length >= 1);

  const src = read('src/render/Assets.ts');
  const used = new Set([...src.matchAll(/setPhase\('([A-Za-z]+)'/g)].map((m) => m[1]));
  for (const phase of Object.keys(weights)) assert.ok(used.has(phase), `saknar setPhase('${phase}')`);
  for (const phase of used) assert.ok(weights[phase as keyof typeof weights] > 0, phase);
});

test('setLoadingProgress skriver --rk-p, aria-valuenow och data-rk-pct tillsammans', async () => {
  const { loading } = mount();
  const { setLoadingProgress } = await import('../src/ui/loadingScreen');
  setLoadingProgress(loading, 0);
  assert.equal(loading.style.getPropertyValue('--rk-p'), '0');
  assert.equal(loading.getAttribute('aria-valuenow'), '0');
  assert.equal(loading.querySelector('[data-rk-pct]')?.textContent, '0');

  setLoadingProgress(loading, 0.42);
  assert.equal(loading.style.getPropertyValue('--rk-p'), '0.42');
  assert.equal(loading.getAttribute('aria-valuenow'), '42');
  assert.equal(loading.querySelector('[data-rk-pct]')?.textContent, '42');

  setLoadingProgress(loading, 1);
  assert.equal(loading.getAttribute('aria-valuenow'), '100');
  setLoadingProgress(loading, 2);
  assert.equal(loading.style.getPropertyValue('--rk-p'), '1');
  setLoadingProgress(loading, Number.NaN);
  assert.equal(loading.getAttribute('aria-valuenow'), '0');
  assert.equal(loading.querySelector('[data-rk-pct]')?.textContent, '0');
});

test('verklig fasrapport driver samma tal till list och runsten via --rk-p', async () => {
  const { loading } = mount();
  const { setLoadingProgress } = await import('../src/ui/loadingScreen');
  const { WeightedLoadProgress } = await import('../src/render/loadProgress');
  const { startupLoadWeights } = await import('../src/render/Assets');
  const progress = new WeightedLoadProgress(startupLoadWeights());
  const ratios: number[] = [];
  progress.subscribe((ratio) => {
    ratios.push(ratio);
    setLoadingProgress(loading, ratio);
  });
  assert.equal(loading.getAttribute('aria-valuenow'), '0');
  progress.setPhase('tiles', 1);
  const mid = progress.ratio;
  assert.ok(mid > 0 && mid < 1);
  assert.equal(loading.style.getPropertyValue('--rk-p'), String(mid));
  assert.equal(loading.getAttribute('aria-valuenow'), String(Math.round(mid * 100)));
  assert.equal(loading.querySelector('[data-rk-pct]')?.textContent, String(Math.round(mid * 100)));
  progress.seal();
  assert.equal(progress.ratio, 1);
  assert.equal(loading.getAttribute('aria-valuenow'), '100');
  assert.equal(loading.style.getPropertyValue('--rk-p'), '1');
  for (let i = 1; i < ratios.length; i++) {
    const prev = ratios[i - 1];
    const cur = ratios[i];
    assert.ok(prev !== undefined && cur !== undefined && cur >= prev);
  }
});

test('rk-done tas bort efter opacity-transition, inte av barnens transition, och vid timeout', async () => {
  const { loading } = mount();
  const { dismissLoadingOverlay } = await import('../src/ui/loadingScreen');
  dismissLoadingOverlay(loading, 450);
  assert.equal(loading.classList.contains('rk-done'), true);
  assert.equal(loading.getAttribute('aria-valuenow'), '100');
  dismissLoadingOverlay(loading, 450);
  const bar = loading.querySelector('.rk-bar-fill');
  assert.ok(bar);
  bar.dispatchEvent(new Event('transitionend', { bubbles: true }));
  assert.equal(loading.isConnected, true);

  const widthEnd = new Event('transitionend');
  Object.defineProperty(widthEnd, 'propertyName', { value: 'width' });
  loading.dispatchEvent(widthEnd);
  assert.equal(loading.isConnected, true);

  loading.dispatchEvent(new Event('transitionend'));
  assert.equal(loading.isConnected, false);
  assert.equal(document.getElementById('rk-loading'), null);

  const again = mount();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    dismissLoadingOverlay(again.loading, 450);
    assert.equal(again.loading.isConnected, true);
    mock.timers.tick(499);
    assert.equal(again.loading.isConnected, true);
    mock.timers.tick(1);
    assert.equal(again.loading.isConnected, false);
  } finally {
    mock.timers.reset();
  }
});

test('trasig grafik tar bort rk-has-art så Cinzel och CSS-listen används', async () => {
  const { loading } = mount();
  const { bindLoadingArtFallback, LOADING_ART_FILES } = await import('../src/ui/loadingScreen');
  const title = loading.querySelector<HTMLImageElement>('img.rk-title-img');
  assert.ok(title);
  Object.defineProperty(title, 'complete', { configurable: true, get: () => false });
  Object.defineProperty(title, 'naturalWidth', { configurable: true, get: () => 0 });
  const probes: HTMLImageElement[] = [];
  bindLoadingArtFallback(
    loading,
    (file) => `/runornas-kall-laro/assets/ui/loading/${file}`,
    () => {
      const img = document.createElement('img');
      probes.push(img);
      return img;
    },
  );
  assert.deepEqual(
    probes.map((img) => img.getAttribute('src')),
    LOADING_ART_FILES.map((file) => `/runornas-kall-laro/assets/ui/loading/${file}`),
  );
  assert.equal(loading.classList.contains('rk-has-art'), true);
  probes[1]?.dispatchEvent(new Event('error'));
  assert.equal(loading.classList.contains('rk-has-art'), false);

  const restored = mount();
  const title2 = restored.loading.querySelector('img.rk-title-img');
  assert.ok(title2);
  Object.defineProperty(title2, 'complete', { configurable: true, get: () => false });
  bindLoadingArtFallback(
    restored.loading,
    (file) => `/runornas-kall-laro/assets/ui/loading/${file}`,
    () => document.createElement('img'),
  );
  assert.equal(restored.loading.classList.contains('rk-has-art'), true);
  title2.dispatchEvent(new Event('error'));
  assert.equal(restored.loading.classList.contains('rk-has-art'), false);
});

test('loading.hint och loading.aria på svenska och engelska, med fallback', async () => {
  const { LocaleManager } = await import('../src/i18n/LocaleManager');
  const { applyLoadingLocale, LOADING_HINT_FALLBACK, LOADING_ARIA_FALLBACK, primeLoadingLocale } = await import('../src/ui/loadingScreen');
  const backend = {
    async getSetting() {
      return null;
    },
    async setSetting() {},
  };
  const i18n = new LocaleManager({ dev: false });
  await i18n.bindSettings(backend as never);
  assert.equal(i18n.t('loading.hint'), 'Världen vaknar');
  assert.equal(i18n.t('loading.aria'), 'Laddar');
  await i18n.setLocale('en');
  assert.equal(i18n.t('loading.hint'), 'The world awakens');
  assert.equal(i18n.t('loading.aria'), 'Loading');

  const { dom, loading } = mount();
  applyLoadingLocale(dom.window.document, (key) => key);
  assert.equal(loading.querySelector('[data-i18n="loading.hint"]')?.textContent, LOADING_HINT_FALLBACK);
  assert.equal(loading.getAttribute('aria-label'), LOADING_ARIA_FALLBACK);
  applyLoadingLocale(dom.window.document, () => '   ');
  assert.equal(loading.querySelector('[data-i18n="loading.hint"]')?.textContent, LOADING_HINT_FALLBACK);

  dom.window.localStorage.setItem('rpg_setting_rpg_locale', 'en');
  const early = new LocaleManager({ dev: false });
  await primeLoadingLocale(early, dom.window.document);
  assert.equal(loading.querySelector('[data-i18n="loading.hint"]')?.textContent, 'The world awakens');
  assert.equal(loading.getAttribute('aria-label'), 'Loading');

  dom.window.localStorage.setItem('rpg_setting_rpg_locale', 'zz');
  const broken = new LocaleManager({ dev: false });
  await primeLoadingLocale(broken, dom.window.document);
  assert.equal(loading.querySelector('[data-i18n="loading.hint"]')?.textContent, LOADING_HINT_FALLBACK);
});

test('menyn målas innan rk-done, sedan tas overlayen bort', async () => {
  const queue: FrameRequestCallback[] = [];
  const raf = (cb: FrameRequestCallback): number => {
    queue.push(cb);
    return queue.length;
  };
  const { dom } = mount();
  globalThis.requestAnimationFrame = raf;
  dom.window.requestAnimationFrame = raf;

  const { EventBus } = await import('../src/core/EventBus');
  const { DATA } = await import('../src/data/index');
  const { Rng } = await import('../src/core/Rng');
  const { MemoryStore } = await import('../src/core/storage');
  const { LocaleManager } = await import('../src/i18n/LocaleManager');
  const { SaveModule } = await import('../src/save/SaveModule');
  const { MenuModule } = await import('../src/menu/MenuModule');
  const { LocalStorageSaveBackend } = await import('../src/save/backend/LocalStorageSaveBackend');
  const { SerializedSaveBackend } = await import('../src/save/backend/SerializedSaveBackend');
  const { WorldStateService } = await import('../src/world/WorldStateService');
  const { DEFAULT_CLOCK_TIME, snapshotAt } = await import('../src/world/GameClock');
  type GameEvents = import('../src/core/events').GameEvents;
  type GameContext = import('../src/core/GameContext').GameContext;
  type HeroGateway = import('../src/save/HeroGateway').HeroGateway;

  const bus = new EventBus<GameEvents>();
  const ctx = {
    bus,
    hero: {
      id: null,
      name: '',
      cls: 'riddare',
      level: 1,
      xp: 0,
      gold: 0,
      hp: 1,
      maxHp: 1,
      pos: { x: 0, y: 0 },
      inv: [],
      equip: {},
      stage: 0,
      runes: 0,
      city: 'besatt',
      zone: 'forest',
      facing: 0,
      playing: false,
      resumePos: null,
      fresh: false,
    },
    zone: {
      name: 'forest',
      areaId: 'startskogen',
      width: 44,
      height: 44,
      circle: 45,
      colliders: [],
      runes: [],
      portals: [],
      cleared: {},
    },
    session: { seed: 1, worldSeed: 1, killed: new Set<string>() },
    data: DATA,
    rng: new Rng(1),
    worldState: new WorldStateService(),
    clock: snapshotAt(DEFAULT_CLOCK_TIME),
  } as GameContext;
  const gateway: HeroGateway = {
    setSaveBackend() {},
    loadHero() {},
    getSnapshot: () => ({ hero: { ...ctx.hero }, game: null }),
  };
  const i18n = new LocaleManager({ dev: false });
  const save = new SaveModule(gateway, new SerializedSaveBackend(new LocalStorageSaveBackend(new MemoryStore())), true, () => 1, i18n);
  const menu = new MenuModule(save, i18n);
  i18n.init(ctx);
  save.init(ctx);
  menu.init(ctx);
  await save.ready;
  const loading = document.getElementById('rk-loading');
  assert.ok(loading, 'overlayen ligger kvar tills menyn målats');
  assert.equal(loading.classList.contains('rk-done'), false);
  assert.equal(menu.isOpen, true);
  assert.equal(document.querySelectorAll('.hslot').length, 8);
  assert.equal(loading.querySelector('[data-i18n="loading.hint"]')?.textContent, 'Världen vaknar');
  assert.equal(loading.getAttribute('aria-label'), 'Laddar');

  const flush = (): void => {
    const batch = queue.splice(0, queue.length);
    for (const cb of batch) cb(0);
  };
  flush();
  assert.equal(loading.classList.contains('rk-done'), false, 'första rAF är inte paint');
  flush();
  assert.equal(loading.classList.contains('rk-done'), true);
  assert.equal(loading.getAttribute('aria-valuenow'), '100');
  loading.dispatchEvent(new Event('transitionend'));
  assert.equal(document.getElementById('rk-loading'), null);
  assert.equal(menu.isOpen, true);
  assert.equal(document.querySelectorAll('.hslot').length, 8);
  menu.dispose();
  save.dispose();
  i18n.dispose();
});

test('utan målad meny tas overlayen ändå bort efter rk-done', async () => {
  const { dom, loading } = mount();
  const { dismissLoadingWhenMenuReady } = await import('../src/ui/loadingScreen');
  dismissLoadingWhenMenuReady(false, dom.window.document);
  assert.equal(loading.classList.contains('rk-done'), true);
  assert.equal(loading.isConnected, true);
  loading.dispatchEvent(new dom.window.Event('transitionend'));
  assert.equal(dom.window.document.getElementById('rk-loading'), null);
});

test('byggt index.html pekar på /runornas-kall-laro/ om dist finns', () => {
  const dist = join(root, 'dist/index.html');
  if (!existsSync(dist)) return;
  const html = readFileSync(dist, 'utf8');
  const loadingAt = html.indexOf('id="rk-loading"');
  const appAt = html.indexOf('id="app"');
  const fadeAt = html.indexOf('id="fade"');
  assert.ok(loadingAt > 0 && loadingAt < appAt && loadingAt < fadeAt);
  assert.match(html, /href="\/runornas-kall-laro\/assets\/ui\/loading\/loading\.css"/);
  assert.match(html, /src="\/runornas-kall-laro\/assets\/ui\/loading\/titel\.webp"/);
  assert.equal(existsSync(join(root, 'dist/assets/ui/loading/loading.css')), true);
  assert.equal(existsSync(join(root, 'dist/assets/ui/loading/titel.webp')), true);
  assert.match(html, /background:\s*#0d0f12/);
});
