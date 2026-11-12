import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { MemoryStore } from '../src/core/storage';
import {
  DEFAULT_ENEMY_THEME_ID,
  ENEMY_THEME_STORAGE_KEY,
  ENEMY_THEMES,
  enemyThemeById,
  getActiveEnemyTheme,
  isEnemyThemeId,
  mergeEnemyTable,
  readEnemyTheme,
  setActiveEnemyTheme,
  themeFigureLabel,
  themeSheetFor,
  themedMonsterTitle,
  writeEnemyTheme,
} from '../src/entities/enemyThemes';
import type { LocaleManager } from '../src/i18n/LocaleManager';
import { completeAnimSet } from '../src/render/Assets';
import { FIGURE_HEIGHT_HUMAN_M, worldHeightMForMonster } from '../src/render/figureWorldHeights';
import type { Anim } from '../src/render/spriteAnim';
import { buildEnemyThemePicker } from '../src/menu/enemyThemePicker';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const THEME_IDS = [
  'trasdocka',
  'gycklare',
  'robotpudel',
  'styltgangare',
  'ballongblob',
  'akrobatkub',
  'knutte',
  'linnea',
  'rasmus',
  'kaxig_mastare',
] as const;

const LABELS: Record<(typeof THEME_IDS)[number], string> = {
  trasdocka: 'Trasdocka',
  gycklare: 'Gycklare',
  robotpudel: 'Robotpudel',
  styltgangare: 'Styltgångare',
  ballongblob: 'Ballongblob',
  akrobatkub: 'Akrobatkub',
  knutte: 'Knutte',
  linnea: 'Linnea',
  rasmus: 'Rasmus',
  kaxig_mastare: 'Kaxig mästare',
};

const BANNED = ['ragatha', 'tadc', 'the amazing digital circus', 'cobra kai', 'hawk', 'pomni', 'kaufmo', 'zooble', 'gangle', 'kinger'];

function assertClean(text: string, label: string): void {
  assert.equal(text.includes('—'), false, `${label} har tankstreck`);
  assert.equal(text.includes('–'), false, `${label} har långt bindestreck`);
  const lower = text.toLowerCase();
  for (const word of BANNED) assert.equal(lower.includes(word), false, `${label} innehåller ${word}`);
}

assert.equal(DEFAULT_ENEMY_THEME_ID, 'vanliga');
assert.equal(enemyThemeById('vanliga').id, 'vanliga');
assert.equal(enemyThemeById('finns-inte').id, 'vanliga');
assert.equal(enemyThemeById('').id, 'vanliga');
assert.equal(isEnemyThemeId('digital_cirkus'), true);
assert.equal(isEnemyThemeId('karatedojo'), true);
assert.equal(isEnemyThemeId('hawk'), false);
assert.equal(isEnemyThemeId(null), false);
assert.deepEqual(
  ENEMY_THEMES.map((t) => t.id),
  ['vanliga', 'digital_cirkus', 'karatedojo'],
);

const store = new MemoryStore();
assert.equal(readEnemyTheme(store), 'vanliga');
writeEnemyTheme(store, 'inte-ett-tema');
assert.equal(store.get(ENEMY_THEME_STORAGE_KEY), null);
writeEnemyTheme(store, 'digital_cirkus');
assert.equal(readEnemyTheme(store), 'digital_cirkus');
assert.equal(store.get(ENEMY_THEME_STORAGE_KEY), JSON.stringify('digital_cirkus'));
writeEnemyTheme(store, 'cobra');
assert.equal(store.get(ENEMY_THEME_STORAGE_KEY), JSON.stringify('digital_cirkus'));
store.set(ENEMY_THEME_STORAGE_KEY, JSON.stringify('hawk'));
assert.equal(readEnemyTheme(store), 'vanliga');
store.set(ENEMY_THEME_STORAGE_KEY, 'trasigt{');
assert.equal(readEnemyTheme(store), 'vanliga');
store.set(ENEMY_THEME_STORAGE_KEY, 'karatedojo');
assert.equal(readEnemyTheme(store), 'karatedojo');

const vanliga = enemyThemeById('vanliga');
assert.equal(themeSheetFor(vanliga, 'skogsvarg', { boss: true, elite: 'champion' }, 'boss'), 'skogsvarg');
assert.equal(themeSheetFor(vanliga, 'benkungen_valdemar', { boss: true }, 'b'), 'benkungen_valdemar');

const circus = enemyThemeById('digital_cirkus');
assert.equal(circus.figures.length, 6);
const circusSeen = new Set<string>();
const stable = themeSheetFor(circus, 'skogsvarg', {}, 'samma-salt');
assert.equal(themeSheetFor(circus, 'skogsvarg', { boss: true }, 'samma-salt'), stable);
for (let i = 0; i < 240; i++) {
  const sheet = themeSheetFor(circus, 'skogsvarg', {}, `cirkus-${i}`);
  assert.ok(circus.figures.includes(sheet), sheet);
  circusSeen.add(sheet);
}
assert.deepEqual([...circusSeen].sort(), [...circus.figures].sort());
const circusBoss = themeSheetFor(circus, 'grabjornen_ulvhild', { boss: true }, 'boss-salt');
assert.ok(circus.figures.includes(circusBoss));
assert.notEqual(circusBoss, 'kaxig_mastare');

const karate = enemyThemeById('karatedojo');
assert.equal(karate.subtitle, 'Skorpionklubben');
assert.deepEqual([...karate.figures], ['knutte', 'linnea', 'rasmus']);
const karateSeen = new Set<string>();
const pupil = themeSheetFor(karate, 'skogsvarg', {}, 'elev');
assert.equal(themeSheetFor(karate, 'skogsvarg', { elite: 'minion' }, 'elev'), pupil);
assert.ok(karate.figures.includes(pupil));
for (let i = 0; i < 90; i++) {
  const sheet = themeSheetFor(karate, 'vargbest', { elite: 'minion' }, `elev-${i}`);
  assert.ok(karate.figures.includes(sheet), sheet);
  assert.notEqual(sheet, 'kaxig_mastare');
  karateSeen.add(sheet);
}
assert.deepEqual([...karateSeen].sort(), [...karate.figures].sort());
for (const flags of [{ boss: true }, { underboss: true }, { elite: 'champion' as const }, { elite: 'unik' as const }]) {
  assert.equal(themeSheetFor(karate, 'skogsvarg', flags, 'a'), 'kaxig_mastare');
  assert.equal(themeSheetFor(karate, 'skogsvarg', flags, 'annan'), 'kaxig_mastare');
}
assert.equal(themeSheetFor(karate, 'grabjornen_ulvhild', {}, 'z'), 'kaxig_mastare');
assert.equal(themeSheetFor(karate, 'korpmodern', {}, 'z'), 'kaxig_mastare');
assert.equal(themeSheetFor(karate, 'benkungen_valdemar', { elite: 'minion' }, 'z'), 'kaxig_mastare');
assert.equal(themeSheetFor(circus, 'kattflickan_monster', { boss: true }, 'x'), 'kattflickan_monster');
assert.equal(themeSheetFor(karate, 'gnistan_monster', { elite: 'champion' }, 'y'), 'gnistan_monster');
assert.equal(themeSheetFor(karate, 'valpen_monster', {}, 'z'), 'valpen_monster');
assert.equal(themeSheetFor(circus, 'grisan_monster', { underboss: true }, 'w'), 'grisan_monster');

const base = [{ enemy: 'skogsvarg', weight: 3 }];
const copied = mergeEnemyTable(base, vanliga);
assert.notEqual(copied, base);
assert.equal(copied[0]?.enemy, 'skogsvarg');
assert.equal(copied[0]?.weight, 3);
assert.equal((vanliga.extras ?? []).length, 4);
assert.equal(copied.length, base.length + (vanliga.extras ?? []).length);
const extraIds = copied.slice(1).map((row) => row.enemy);
for (const id of ['kattflickan_monster', 'gnistan_monster', 'valpen_monster', 'grisan_monster']) {
  assert.ok(extraIds.includes(id), id);
}
copied.push({ enemy: 'vargbest', weight: 1 });
assert.equal(base.length, 1);
assert.equal(base[0]?.enemy, 'skogsvarg');
assert.equal(base[0]?.weight, 3);
const withExtra = mergeEnemyTable(base, { extras: [{ enemy: 'ny', weight: 2 }] });
assert.deepEqual(withExtra, [
  { enemy: 'skogsvarg', weight: 3 },
  { enemy: 'ny', weight: 2 },
]);
assert.equal(base.length, 1);

for (const id of THEME_IDS) assert.equal(themeFigureLabel(id), LABELS[id]);
const labelBlob = THEME_IDS.map((id) => themeFigureLabel(id)).join('\n');
const themeBlob = ENEMY_THEMES.map((t) => `${t.name} ${t.subtitle ?? ''}`).join('\n');
assertClean(labelBlob, 'figurnamn');
assertClean(themeBlob, 'temanamn');

const sv = JSON.parse(readFileSync(join(root, 'src/i18n/locales/sv.json'), 'utf8')) as { menu: Record<string, string> };
const en = JSON.parse(readFileSync(join(root, 'src/i18n/locales/en.json'), 'utf8')) as { menu: Record<string, string> };
assert.equal(sv.menu.choose_enemy_theme, 'Välj fiender');
assert.equal(sv.menu.enemy_theme_vanliga, 'Vanliga (standard)');
assert.equal(sv.menu.enemy_theme_digital_cirkus, 'Digital cirkus');
assert.equal(sv.menu.enemy_theme_karatedojo, 'Karatedojo');
assert.equal(sv.menu.enemy_theme_skorpionklubben, 'Skorpionklubben');
assert.equal(en.menu.choose_enemy_theme, 'Choose enemies');
assert.equal(en.menu.enemy_theme_vanliga, 'Usual (default)');
assert.equal(en.menu.enemy_theme_digital_cirkus, 'Digital Circus');
assert.equal(en.menu.enemy_theme_karatedojo, 'Karate Dojo');
assert.equal(en.menu.enemy_theme_skorpionklubben, 'Scorpion Club');
for (const key of [
  'choose_enemy_theme',
  'enemy_theme_vanliga',
  'enemy_theme_digital_cirkus',
  'enemy_theme_karatedojo',
  'enemy_theme_skorpionklubben',
]) {
  assertClean(sv.menu[key] ?? '', `sv ${key}`);
  assertClean(en.menu[key] ?? '', `en ${key}`);
}

setActiveEnemyTheme('digital_cirkus');
assert.equal(getActiveEnemyTheme().id, 'digital_cirkus');
assert.equal(themedMonsterTitle('gycklare', 'Skogsvarg', null), 'Gycklare');
assert.equal(themedMonsterTitle('knutte', 'Skogsvarg', 'Nattulven'), 'Nattulven, Knutte');
assert.equal(themedMonsterTitle('skogsvarg', 'Skogsvarg', null), 'Skogsvarg');
setActiveEnemyTheme('okänt');
assert.equal(getActiveEnemyTheme().id, 'vanliga');
assert.equal(themedMonsterTitle('skogsvarg', 'Skogsvarg', 'Nattulven'), 'Nattulven');
assert.equal(themedMonsterTitle('skogsvarg', 'Skogsvarg', null), 'Skogsvarg');
setActiveEnemyTheme('vanliga');

const idle = { tag: 'idle' } as unknown as Anim;
const gang = { tag: 'walk' } as unknown as Anim;
const filled = completeAnimSet({ idle, gang });
assert.equal(filled.attack, gang);
assert.equal(filled.dod, idle);
assert.equal(filled.idle, idle);
assert.equal(filled.gang, gang);
assert.equal(filled.run, gang);

for (const id of ['knutte', 'linnea', 'rasmus', 'gycklare', 'trasdocka', 'akrobatkub']) {
  assert.equal(worldHeightMForMonster(id, 'bestar'), FIGURE_HEIGHT_HUMAN_M);
}
const stilts = worldHeightMForMonster('styltgangare', 'ododa');
assert.ok(stilts >= 2 && stilts <= 2.2, `styltgångare ${stilts}`);
assert.ok(worldHeightMForMonster('robotpudel', 'bestar') < 1);
assert.ok(worldHeightMForMonster('ballongblob', 'bestar') < FIGURE_HEIGHT_HUMAN_M);
assert.ok(worldHeightMForMonster('robotpudel', 'bestar') > 0.5);
assert.ok(worldHeightMForMonster('ballongblob', 'bestar') > 0.5);
const master = worldHeightMForMonster('kaxig_mastare', 'ododa', false);
const masterStrong = worldHeightMForMonster('kaxig_mastare', 'ododa', true);
assert.ok(master > FIGURE_HEIGHT_HUMAN_M);
assert.ok(masterStrong > master);
assert.ok(masterStrong < 2.4);

const index = JSON.parse(readFileSync(join(root, 'public/assets/2d/sprites/monster/index.json'), 'utf8')) as {
  sheets: string[];
  eightDir: string[];
};
function assertSortedUnique(list: string[], label: string): void {
  const seen = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const id = list[i];
    assert.equal(typeof id, 'string', label);
    assert.equal(seen.has(id ?? ''), false, `${label} dubblett ${id}`);
    if (id) seen.add(id);
    if (i > 0) assert.ok((list[i - 1] ?? '') < (id ?? ''), `${label} osorterad vid ${id}`);
  }
}
assertSortedUnique(index.sheets, 'sheets');
assertSortedUnique(index.eightDir, 'eightDir');
for (const id of THEME_IDS) {
  assert.ok(index.sheets.includes(id), `sheets saknar ${id}`);
  assert.ok(index.eightDir.includes(id), `eightDir saknar ${id}`);
}

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/' });
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
g.HTMLElement = dom.window.HTMLElement;
g.HTMLButtonElement = dom.window.HTMLButtonElement;
g.localStorage = dom.window.localStorage;
dom.window.localStorage.removeItem(ENEMY_THEME_STORAGE_KEY);
const menuText: Record<string, string> = {
  'menu.choose_enemy_theme': 'Välj fiender',
  'menu.enemy_theme_vanliga': 'Vanliga (standard)',
  'menu.enemy_theme_digital_cirkus': 'Digital cirkus',
  'menu.enemy_theme_karatedojo': 'Karatedojo',
  'menu.enemy_theme_skorpionklubben': 'Skorpionklubben',
};
const i18n = { t: (key: string) => menuText[key] ?? key } as unknown as LocaleManager;
const picker = buildEnemyThemePicker(i18n);
assert.equal(picker.querySelector('.enemy-theme-label')?.textContent, 'Välj fiender');
const buttons = [...picker.querySelectorAll('button')];
assert.equal(buttons.length, 3);
assert.equal(buttons[0]?.dataset.theme, 'vanliga');
assert.equal(buttons[0]?.classList.contains('sel'), true);
assert.equal(buttons[1]?.dataset.theme, 'digital_cirkus');
assert.equal(buttons[2]?.dataset.theme, 'karatedojo');
assert.match(picker.textContent ?? '', /Vanliga \(standard\)/);
assert.match(picker.textContent ?? '', /Digital cirkus/);
assert.match(picker.textContent ?? '', /Karatedojo/);
assert.match(picker.textContent ?? '', /Skorpionklubben/);
assertClean(picker.textContent ?? '', 'väljare');
buttons[2]?.click();
assert.equal(readEnemyTheme({ get: (k) => dom.window.localStorage.getItem(k), set() {}, remove() {}, keys: () => [] }), 'karatedojo');
assert.equal(buttons[2]?.classList.contains('sel'), true);
assert.equal(buttons[0]?.classList.contains('sel'), false);
assert.equal(buttons[2]?.getAttribute('aria-pressed'), 'true');

console.log('enemy-themes.test.mts: ok');
