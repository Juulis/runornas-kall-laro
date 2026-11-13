/**
 * Alla tiles och dekor ska vara registrerade, men bara startup-grupperna räknas i startvikten.
 * Kör: npx tsx tests/assets-tiles-dekor.test.mts
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Texture } from 'pixi.js';
import {
  AssetStore,
  DECOR,
  DECOR_GROUPS,
  decorForBiome,
  decorForGroup,
  STARTUP_DECOR,
  STARTUP_TILES,
  startupLoadWeights,
  TILE_GROUPS,
  TILES,
  tilesForBiome,
} from '../src/render/Assets';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tileDir = join(root, 'public/assets/2d/tiles');
const decorDir = join(root, 'public/assets/2d/dekor');

function pngIds(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.png'))
    .map((name) => name.slice(0, -'.png'.length))
    .sort();
}

const tileFiles = pngIds(tileDir);
const decorFiles = pngIds(decorDir);
const animFiles = decorFiles.filter((id) => id.endsWith('_anim'));
const decorPngs = decorFiles.filter((id) => id !== 'lista_saknade' && !id.endsWith('_anim'));
const tileSet = new Set<string>(TILES);
const decorSet = new Set<string>(DECOR);
const startupTiles = new Set<string>(STARTUP_TILES);
const startupDecor = new Set<string>(STARTUP_DECOR);

assert.equal(tileFiles.length, 132);
assert.equal(decorPngs.length, 89);
assert.equal(TILES.length, tileSet.size, 'TILES ska inte ha dubbletter');
assert.equal(DECOR.length, decorSet.size, 'DECOR ska inte ha dubbletter');

for (const id of tileFiles) assert.ok(tileSet.has(id), `tile-png saknas i TILES: ${id}`);
for (const id of TILES) {
  assert.ok(tileFiles.includes(id), `TILES pekar på saknad fil: ${id}.png`);
}

for (const id of decorPngs) assert.ok(decorSet.has(id), `dekor-png saknas i DECOR: ${id}`);
for (const id of DECOR) {
  assert.ok(decorPngs.includes(id), `DECOR pekar på saknad fil: ${id}.png`);
  assert.equal(id.endsWith('_anim'), false, id);
}
assert.equal(decorSet.has('lista_saknade'), false);
for (const id of animFiles) assert.equal(decorSet.has(id), false, `${id} ska ligga i decorAnims`);

const meta = JSON.parse(readFileSync(join(decorDir, 'dekor.json'), 'utf8')) as Record<
  string,
  { w?: unknown; h?: unknown; anchor?: unknown }
>;
for (const id of DECOR) {
  const entry = meta[id];
  assert.ok(entry, `dekor.json saknar ${id}`);
  assert.equal(typeof entry.w, 'number', id);
  assert.equal(typeof entry.h, 'number', id);
  assert.ok(Array.isArray(entry.anchor) && entry.anchor.length === 2, id);
  assert.equal(typeof entry.anchor[0], 'number', id);
  assert.equal(typeof entry.anchor[1], 'number', id);
}

const todayTiles = [
  'gras_1',
  'gras_2',
  'gras_3',
  'gras_4',
  'gras_blommor_1',
  'gras_blommor_2',
  'gras_till_kullersten',
  'gras_till_kullersten_2',
  'gras_till_kullersten_ov',
  'gras_till_lera',
  'gras_till_lera_ov',
  'gras_till_lera_oh',
  'gras_till_lera_oh_2',
  'gras_till_lera_nh',
  'gras_till_lera_nv',
  'gras_till_skogsbotten',
  'lera_1',
  'lera_2',
  'lera_3',
  'kullersten',
  'kullersten_mossig',
  'mossa_1',
  'mossa_2',
  'aska',
  'ruin_grus',
  'skogsbotten_lov',
  'skogsbotten_ormbunke',
  'skogsbotten_barr_1',
  'skogsbotten_barr_2',
  'skogsbotten_till_kullersten',
  'skogsbotten_till_kullersten_2',
  'skogsbotten_till_kullersten_ov',
  'skogsbotten_till_kullersten_ov_2',
  'skogsbotten_till_kullersten_oh',
  'skogsbotten_till_kullersten_nh',
  'skogsbotten_till_kullersten_nv',
  'skogsbotten_till_lera',
  'stengolv_sprucket_1',
  'stengolv_sprucket_2',
];
const todayDecor = [
  'dod_ek',
  'gran',
  'gran_ung',
  'stubbe',
  'ormbunkar',
  'runsten',
  'stenhog',
  'ruinmur',
  'ruinmur_horn',
  'ruinmur_rasad',
  'rod_portal',
  'vindfalle',
  'buske',
  'bjork',
  'gras_tuva',
  'pelare',
  'pelare_liggande',
  'talt',
  'vedtrave',
  'sittstock',
  'gravkors_bjork',
  'anslagstavla',
  'barnsang',
  'eldstad_kall',
];
assert.deepEqual([...STARTUP_TILES].sort(), [...todayTiles].sort());
assert.equal(STARTUP_TILES.length, 39);
assert.deepEqual([...STARTUP_DECOR].sort(), [...todayDecor].sort());
for (const id of STARTUP_TILES) assert.ok(tileSet.has(id));
for (const id of STARTUP_DECOR) assert.ok(decorSet.has(id));
assert.ok(STARTUP_DECOR.length <= 27, 'startup-dekor får bara växa med några enstaka inom 15 %');

const weights = startupLoadWeights();
assert.equal(weights.tiles, STARTUP_TILES.length);
assert.equal(weights.decor, STARTUP_DECOR.length + 2);
assert.ok(weights.tiles <= 39 * 1.15);
assert.ok(weights.decor <= 26 * 1.15);
assert.ok(weights.tiles < TILES.length);

assert.ok(TILE_GROUPS.trask.includes('myr_1'));
assert.equal(startupTiles.has('myr_1'), false);
assert.ok(tilesForBiome('trask').includes('myr_1'));
assert.ok(tilesForBiome('trask').includes('myr_aska_blandning'));
assert.ok(tilesForBiome('trask').includes('myr_till_mossa_nh'));
assert.ok(tilesForBiome('skog').includes('myr_till_mossa_nh'));
assert.ok(tilesForBiome('skog').includes('ljung_till_mossa_ov'));
assert.equal(tilesForBiome('skog').includes('myr_1'), false);
assert.equal(tilesForBiome('skog').includes('gras_1'), false);
assert.ok(tilesForBiome('fjall').includes('ljung_1'));
assert.ok(tilesForBiome('fjall').includes('ljung_till_bergsvag_nh'));
assert.ok(tilesForBiome('fjall').includes('ljung_till_myr_ov'));
assert.equal(startupTiles.has('ljung_1'), false);
assert.ok(tilesForBiome('ask').includes('myr_till_aska_nh'));
assert.equal(tilesForBiome('kust').length, 0);
assert.equal(TILE_GROUPS.overgangar.length, 60);
assert.equal(startupTiles.has('ljung_till_bergsvag_nh'), false);

assert.ok(decorForBiome('skog').includes('vagros_blommor'));
assert.ok(decorForBiome('skog').includes('torvstack'));
assert.equal(startupDecor.has('vagros_blommor'), false);
assert.ok(decorForBiome('trask').includes('myrull'));
assert.ok(decorForBiome('fjall').includes('vindtall'));
assert.ok(decorForBiome('kust').includes('sjunken_bat'));
assert.ok(decorForBiome('ask').includes('vagros_blommor'));
assert.ok(DECOR_GROUPS.by.includes('hus_lagat_tak'));
assert.ok(DECOR_GROUPS.by.includes('hons'));
assert.equal((DECOR_GROUPS.by as readonly string[]).includes('lista_saknade'), false);
assert.equal(startupDecor.has('hus_lagat_tak'), false);
assert.deepEqual(decorForGroup('interiör'), decorForGroup('by'));
assert.equal(decorForBiome('trask').includes('hus_lagat_tak'), false);

const groundSrc = readFileSync(join(root, 'src/world/bigWorld/BigWorldStreamGround.ts'), 'utf8');
assert.equal(groundSrc.includes('DECOR_ALIASES'), false);
assert.equal(groundSrc.includes('björk'), false);
assert.equal(groundSrc.includes('vägrös'), false);
assert.equal(groundSrc.includes('kolmila'), false);
assert.match(groundSrc, /ensureBiomeAssets/);
assert.match(groundSrc, /trackChunkLoad/);

const blendSrc = readFileSync(join(root, 'src/world/bigWorld/biomeBlend.ts'), 'utf8');
assert.equal(blendSrc.includes('björk'), false);
assert.equal(blendSrc.includes('vägrös'), false);
assert.match(blendSrc, /vagros_blommor/);
assert.match(blendSrc, /'bjork'/);

const store = new AssetStore();
const dummy = Texture.EMPTY;
const size = { w: 8, h: 8, anchor: [4, 7] as [number, number] };
for (const id of tilesForBiome('trask')) store.tiles.set(id, dummy);
for (const id of decorForBiome('trask')) store.decor.set(id, { tex: dummy, size });
for (const id of decorForGroup('by')) store.decor.set(id, { tex: dummy, size });

const marsh = store.ensureBiomeAssets('trask');
const marshAgain = store.ensureBiomeAssets('träsk');
assert.equal(marsh, marshAgain, 'parallella anrop för samma biom ska dela löfte');
await marsh;
assert.equal(store.ensureBiomeAssets('trask'), marsh, 'klart biom ska återanvända samma löfte');

const village = store.ensureDecorGroup('by');
assert.equal(store.ensureDecorGroup('interiör'), village);
await village;

const ratios: number[] = [];
await store.ensureBiomeAssets('saknas-helt', (ratio) => ratios.push(ratio));
assert.deepEqual(ratios, [1]);

console.log('assets-tiles-dekor.test.mts: ok', {
  tiles: TILES.length,
  decor: DECOR.length,
  startupTiles: STARTUP_TILES.length,
  startupDecor: STARTUP_DECOR.length,
});
