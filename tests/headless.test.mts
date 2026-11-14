/**
 * Headless-test med stubbar (jsdom + stub-GameContext). Kör: npx tsx tests/headless.test.mts
 * Simulerar motorn: svarar på new_game med zone_enter, flyttar hjälten, emit:ar events.
 */
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const dom = new JSDOM('<!doctype html><body><div id="plate"></div></body>', { url: 'http://localhost/', pretendToBeVisual: true });
const g = globalThis as unknown as Record<string, unknown>;
for (const k of [
  'window',
  'document',
  'HTMLElement',
  'HTMLInputElement',
  'Node',
  'KeyboardEvent',
  'Event',
  'localStorage',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]) {
  g[k] = (dom.window as unknown as Record<string, unknown>)[k];
}

const { EventBus } = await import('../src/core/EventBus');
const { DATA } = await import('../src/data/index');
const { MemoryStore } = await import('../src/core/storage');
const { AudioModule } = await import('../src/audio/AudioModule');
const { AudioEventBinder } = await import('../src/audio/AudioEventBinder');
const { SaveModule } = await import('../src/save/SaveModule');
const { SaveMigrator } = await import('../src/save/SaveMigrator');
const { MenuModule } = await import('../src/menu/MenuModule');
const { MapModule } = await import('../src/map/MapModule');
const { LocaleManager } = await import('../src/i18n/LocaleManager');
const { Rng } = await import('../src/core/Rng');
const { WorldStateService } = await import('../src/world/WorldStateService');
const { DEFAULT_CLOCK_TIME, snapshotAt } = await import('../src/world/GameClock');
import type { GameEvents } from '../src/core/events';
import type { GameContext, HeroState } from '../src/core/GameContext';

function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`saknas: ${what}`);
  return v;
}
import type { HeroGateway } from '../src/save/HeroGateway';
import { LocalStorageSaveBackend } from '../src/save/backend/LocalStorageSaveBackend';
import { SerializedSaveBackend } from '../src/save/backend/SerializedSaveBackend';
import { HeroLoader } from '../src/save/HeroLoader';
import type { AutoSaveService } from '../src/save/AutoSaveService';

const bus = new EventBus<GameEvents>();
const store = new MemoryStore();
// legacy-data för engångsmigrering
store.set('rk_inv_barbar', JSON.stringify({ inv: [{ base: 'langsvard' }], equip: {}, gold: 42 }));

// HeroState/ZoneView enligt #18
const zoneExtras = {
  circle: 45,
  colliders: [],
  runes: [
    { x: 10, y: 0, active: false },
    { x: -20, y: 5, active: false },
  ],
  portals: [],
  cleared: {},
};
const ctx: GameContext = {
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
  zone: { name: 'forest', areaId: 'startskogen', width: 44, height: 44, ...zoneExtras } as GameContext['zone'],
  session: { seed: 1, worldSeed: 1, killed: new Set() },
  data: DATA,
  rng: new Rng(1),
  worldState: new WorldStateService(),
  clock: snapshotAt(DEFAULT_CLOCK_TIME),
};
// Motorstub: hjälten är skrivbar bara här (som i Game), moduler ser Readonly<HeroState>
const H = ctx.hero as HeroState;
// Gateway-stub med samma semantik som Game.loadHero/getSnapshot (#18)
const gateway: HeroGateway = {
  setSaveBackend() {},
  loadHero(s) {
    Object.assign(H, s.hero);
    const g = s.game;
    H.stage = g?.stage ?? 0;
    H.runes = g?.runes ?? 0;
    H.city = g?.city ?? 'besatt';
    H.zone = g?.zone ?? 'forest';
    H.resumePos = g?.pos ? { ...g.pos } : null;
    H.playing = false;
    ctx.session.seed = g?.seed ?? 1;
    ctx.session.killed.clear();
    for (const id of g?.killed ?? []) ctx.session.killed.add(id);
    if (H.id) bus.emit('hero_loaded', { heroId: H.id });
  },
  getSnapshot() {
    return {
      hero: { id: H.id, name: H.name, cls: H.cls, level: H.level, xp: H.xp, gold: H.gold, inv: H.inv, equip: H.equip, fresh: H.fresh },
      game: {
        seed: ctx.session.seed,
        killed: [...ctx.session.killed],
        zone: H.zone,
        pos: { ...H.pos },
        stage: H.stage,
        runes: H.runes,
        city: H.city,
      },
    };
  },
};
// förväntan på motorn: huvudmenyn öppnas -> spelet pausas
bus.on('ui_open', ({ panel }) => {
  if (panel === 'menu') H.playing = false;
});
// motorstub: new_game -> bygg zon -> zone_enter (asynkront, som en riktig laddning)
const log: string[] = [];
bus.on('new_game', ({ seed }) => {
  log.push(`new_game:${seed}`);
  setTimeout(() => {
    const zone = H.zone;
    ctx.zone = { ...ctx.zone, name: zone };
    H.pos = H.resumePos ?? { x: 0, y: 0 };
    H.playing = true;
    bus.emit('zone_enter', { name: zone, areaId: zone === 'village' ? 'gamla_byn' : 'startskogen' });
  }, 20);
});

// --- ljud: event -> ljudnamn
const played: string[] = [];
let t = 0;
const binder = new AudioEventBinder({ play: (n) => played.push(n) }, () => t);
const offs = binder.bind(bus);
bus.emit('kill', { id: 'x', area: 'a', lvl: 1, champion: false, unique: false, boss: true });
bus.emit('loot_drop', { quality: 'rare' });
bus.emit('pickup', { itemId: 'i', first: true });
bus.emit('step', undefined);
t = 100;
bus.emit('step', undefined);
t = 500;
bus.emit('step', undefined);
assert.deepEqual(played, ['boss', 'drop_rare', 'pickup_first', 'step', 'step']);
offs.forEach((o) => o());

// --- moduler
const i18n = new LocaleManager({ dev: false });
const save = new SaveModule(gateway, new SerializedSaveBackend(new LocalStorageSaveBackend(store)), true, () => 123456789, i18n);
const audio = new AudioModule(save);
const menu = new MenuModule(save, i18n);
const map = new MapModule(save, i18n, () => document.body, false);
for (const m of [i18n, audio, save, menu, map]) m.init(ctx);
await save.ready;
await new Promise((r) => setTimeout(r, 30));

// M-mute
assert.equal(audio.volume.isMuted, false);
window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code: 'KeyM' }));
assert.equal(audio.volume.isMuted, true);
await new Promise((r) => setTimeout(r, 50));
assert.equal(store.get(`${LocalStorageSaveBackend.SETTING_PREFIX}mute`), '1');
assert.ok(document.querySelector('#plate .sfx-ctl'), 'volymreglage monterat');
assert.ok(document.querySelector('#plate .shadow-ctl'), 'skuggknapp monterat');
const shadowBtn = document.querySelector<HTMLButtonElement>('#plate .shadow-ctl button');
assert.equal(shadowBtn?.textContent, 'Skuggor');
assert.equal(shadowBtn?.getAttribute('aria-label'), 'Skuggor på');
assert.equal(shadowBtn?.getAttribute('aria-pressed'), 'true');
shadowBtn?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(shadowBtn?.textContent, 'Skuggor av');
assert.equal(shadowBtn?.getAttribute('aria-pressed'), 'false');
await new Promise((r) => setTimeout(r, 50));
assert.equal(store.get(`${LocalStorageSaveBackend.SETTING_PREFIX}shadows`), '0');

// engångsmigrering rk_inv_
const heroes = save.roster.list();
assert.equal(heroes.length, 1);
assert.equal(heroes[0]?.cls, 'barbar');
const migrated = must(save.roster.load(must(heroes[0], 'hjälte 0').id), 'migrerad hjälte');
assert.equal(migrated.hero.gold, 42);
assert.equal(migrated.hero.inv[0]?.base, 'rostig_kortsvard', 'gammalt startgear fixat');

// meny visas, validering
assert.equal(menu.isOpen, true);
assert.equal(document.querySelectorAll('.hslot').length, 8);
assert.match(save.roster.validName('x'), /2–16/);
assert.match(save.roster.validName('Barbaren'), /redan/);
assert.equal(save.roster.validName('Åsa_1'), '');

// Tab när menyn är öppen: släpps igenom
const tab = (): KeyboardEvent => new dom.window.KeyboardEvent('keydown', { key: 'Tab', cancelable: true }) as unknown as KeyboardEvent;
let ev = tab();
window.dispatchEvent(ev);
assert.equal(ev.defaultPrevented, false, 'Tab ska släppas igenom när menyn är öppen');

// skapa hjälte via UI
(document.getElementById('hmNewHero') as HTMLButtonElement).click();
const input = document.querySelector('.hero-name') as HTMLInputElement;
input.value = 'Ragnar';
(document.getElementById('hnOk') as HTMLButtonElement).click();
// skapandet går via async SaveBackend (serialiserad kö); vänta tills spelet startat i stället för en fast tid
for (let i = 0; i < 100 && !(ctx.hero.playing && !menu.isOpen); i++) await new Promise((r) => setTimeout(r, 20));
assert.equal(menu.isOpen, false);
assert.equal(ctx.hero.name, 'Ragnar');
assert.equal(ctx.hero.playing, true);
assert.ok(log.length === 1, 'new_game emit:at en gång');
assert.equal(store.get('rk_inv_riddare'), null, 'rk_inv_ skrivs inte längre');
const ragnarId = must(ctx.hero.id, 'hjälte-id');
assert.ok(store.get(`rpg_hero_${ragnarId}`), 'sparad vid start');

// spela: steg avslöjar fog, kill sparar via bussen (debounce)
H.pos = { x: 5, y: 5 };
bus.emit('step', undefined);
assert.ok(map.fogOfWar.isRevealed('forest', 5, 5));
H.gold = 99;
ctx.session.killed.add('m1');
bus.emit('kill', { id: 'm1', area: 'a', lvl: 1, champion: false, unique: false, boss: false });
await new Promise((r) => setTimeout(r, 200));
const saved = JSON.parse(must(store.get(`rpg_hero_${ragnarId}`), 'sparfil'));
assert.equal(saved.hero.gold, 99);
assert.deepEqual(saved.game.killed, ['m1']);
assert.deepEqual(saved.game.pos, [5, 5]);

// Tab under spel: växlar karta, preventDefault
ev = tab();
window.dispatchEvent(ev);
assert.equal(ev.defaultPrevented, true);
assert.equal(map.isOpen, true);
map.render(0);
ev = tab();
window.dispatchEvent(ev);
assert.equal(map.isOpen, false);

// fog sparas per hjälte-id vid zonbyte
map.flush();
await new Promise((r) => setTimeout(r, 30));
const fogSaved = JSON.parse(must(store.get(`rpg_hero_${ragnarId}`), 'sparfil efter fog'));
assert.ok(fogSaved.fog?.forest, 'fog i hjältefilen');

// tillbaka till menyn + fortsätt: återupptar position
menu.show();
assert.equal(ctx.hero.playing, false);
(document.getElementById('hmCont') as HTMLButtonElement).click();
await new Promise((r) => setTimeout(r, 60));
assert.deepEqual(ctx.hero.pos, { x: 5, y: 5 });
assert.equal(ctx.session.killed.has('m1'), true);

// radera med bekräftelse -> fog städas via hero_deleted
menu.show();
(document.querySelector(`.hslot[data-id="${ragnarId}"]`) as HTMLElement).click();
(document.getElementById('hmDel') as HTMLButtonElement).click();
assert.match(must(document.querySelector('.confirm span')?.textContent, 'bekräftelsetext'), /Radera Ragnar för alltid\?/);
(document.getElementById('hmYes') as HTMLButtonElement).click();
await new Promise((r) => setTimeout(r, 20));
assert.equal(store.get(`rpg_hero_${ragnarId}`), null);
assert.equal(store.get(`rpg_hero_${ragnarId}`), null);

// migrering: nyare version avvisas, v0 uppgraderas
const mig = new SaveMigrator();
assert.equal(mig.migrate({ version: 99, hero: { id: 'a' } }), null);
assert.equal(mig.migrate({ id: 'a', name: 'A', cls: 'barbar', seed: 5, killed: ['k'] })?.game?.seed, 5);

for (const m of [map, menu, save, audio]) m.dispose();

// --- HeroLoader: autosparning startar före väntan, och väntan hänger inte utan zone_enter
{
  const calls: string[] = [];
  const fakeAutosave = {
    isPlaying: false,
    end: () => calls.push('end'),
    begin: () => calls.push('begin'),
    saveNow: (why: string) => {
      calls.push(`save:${why}`);
      return Promise.resolve(true);
    },
  } as unknown as AutoSaveService;
  const noop: HeroGateway = { loadHero: () => undefined, getSnapshot: () => gateway.getSnapshot() };
  const rec = structuredClone(migrated);
  // 1) zonen redan laddad (ctx.zone.name === hero.zone), ingen zone_enter: löses direkt
  ctx.zone = { ...ctx.zone, name: ctx.hero.zone };
  let t0 = Date.now();
  await new HeroLoader(ctx, noop, fakeAutosave, () => 7, 5_000).start(rec, true);
  assert.ok(Date.now() - t0 < 1_000, 'HeroLoader ska inte vänta när zonen redan är laddad');
  assert.deepEqual(calls.slice(0, 3), ['end', 'begin', 'save:start']);
  // 2) zon ej laddad och ingen zone_enter: autosparning redan igång, timeout löser ut
  calls.length = 0;
  ctx.zone = { ...ctx.zone, name: '__ingen__' };
  t0 = Date.now();
  const p = new HeroLoader(ctx, noop, fakeAutosave, () => 7, 50).start(rec, true);
  assert.deepEqual(calls, ['end', 'begin', 'save:start'], 'start-sparning sker före väntan');
  await p;
  assert.ok(Date.now() - t0 < 1_000);
}

// --- arkitekturvakter: spar-logiken är DOM-fri, och inget Math.random i mina moduler
{
  const { readFileSync, readdirSync } = await import('node:fs');
  const src = (f: string): string => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  for (const f of [
    'save/SaveRepository.ts',
    'save/SaveMigrator.ts',
    'save/HeroRoster.ts',
    'save/AutoSaveService.ts',
    'save/HeroLoader.ts',
    'save/GlobalFoundMigration.ts',
    'save/convert.ts',
  ])
    assert.doesNotMatch(src(f), /\b(window|document|localStorage)\b/, `${f} ska vara DOM-fri`);
  for (const dir of ['audio', 'save', 'save/backend', 'map', 'menu'])
    for (const f of readdirSync(new URL(`../src/${dir}`, import.meta.url)).filter((n) => n.endsWith('.ts')))
      assert.doesNotMatch(src(`${dir}/${f}`), /Math\.random/, `${dir}/${f} använder Math.random`);
}

console.log('HEADLESS_OK');
