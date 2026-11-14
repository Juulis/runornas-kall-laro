/**
 * Mjuka biomgränser: blandzon, övergångstiles och utfransning. Inga webbläsartester.
 * Kör: npx tsx tests/biome-transitions.test.mts
 */
import assert from 'node:assert/strict';
import { Rng } from '../src/core/Rng';
import { TILE_WORLD } from '../src/render/Iso';
import { EDGE_SUFFIXES, TILES } from '../src/render/biomeAssetGroups';
import { groundRolePoolForBiome } from '../src/world/bigWorld/biomeBlend';
import { chunkTileCount, worldToChunk } from '../src/world/bigWorld/bigWorldCoords';
import { decorPoolForBiome, planDecorForChunk } from '../src/world/bigWorld/decorPlanner';
import { pickChunkGroundTileId, worldTileIndex, type GroundRolePool } from '../src/world/bigWorld/groundTiles';
import {
  BIOME_BLEND_WIDTH,
  biomeBorderDistanceTiles,
  biomeIdAtChunk,
  blendWeightsAtTile,
  effectiveBiomeAtTile,
  isBiomeBlendTile,
  pickBlendedGroundTileId,
  pickWeightedBiomeId,
  resolveTransitionTileId,
  transitionHornForMask,
  transitionSuffixForMask,
  type BiomeLookup,
} from '../src/world/bigWorld/transitionResolver';
import { chunkWorldSeed } from '../src/world/bigWorld/worldGenerator';

const tileSet = new Set<string>(TILES);

function union(pool: GroundRolePool): Set<string> {
  return new Set([...pool.base, ...pool.patchA, ...pool.patchB, ...pool.rare]);
}

function chunkOf(gx: number, gy: number): { cx: number; cy: number } {
  return worldToChunk(gx * TILE_WORLD, gy * TILE_WORLD);
}

/** Skog väster om chunkgränsen cx = 0, träsk österut. */
const splitLookup: BiomeLookup = (cx) => (cx < 0 ? 'skog' : 'trask');
const borderGx = worldTileIndex(0, 0, 0, 0).gx;

const MASK_SUFFIX: readonly (string | null)[] = [
  null,
  'oh',
  'nh',
  'oh_nh',
  null,
  null,
  'nh_nv',
  null,
  'ov',
  'ov_oh',
  null,
  null,
  'nv_ov',
  null,
  null,
  null,
];

// Rätt tabell: N=1 → oh, O=2 → nh, S=4 → nv, V=8 → ov, hörn N+O → oh_nh och så vidare.
MASK_SUFFIX[4] = 'nv';

const EXPECTED_SUFFIX: readonly (string | null)[] = [
  null, // 0
  'oh', // 1 N
  'nh', // 2 O
  'oh_nh', // 3 N+O
  'nv', // 4 S
  null, // 5 N+S
  'nh_nv', // 6 O+S
  null, // 7
  'ov', // 8 V
  'ov_oh', // 9 N+V
  null, // 10 O+V
  null, // 11
  'nv_ov', // 12 S+V
  null, // 13
  null, // 14
  null, // 15
];

assert.equal(MASK_SUFFIX.length, 16);
assert.deepEqual(EXPECTED_SUFFIX, [
  null,
  'oh',
  'nh',
  'oh_nh',
  'nv',
  null,
  'nh_nv',
  null,
  'ov',
  'ov_oh',
  null,
  null,
  'nv_ov',
  null,
  null,
  null,
]);

for (let mask = 0; mask < 16; mask++) {
  assert.equal(transitionSuffixForMask(mask), EXPECTED_SUFFIX[mask], `suffix mask ${mask}`);
  const id = resolveTransitionTileId('ljung_till_mossa', mask);
  const suffix = EXPECTED_SUFFIX[mask];
  if (suffix === null || suffix === undefined) {
    assert.equal(id, null, `ljung_till_mossa mask ${mask} ska fransas`);
  } else {
    assert.equal(id, `ljung_till_mossa_${suffix}`, `mask ${mask}`);
    assert.ok(tileSet.has(id ?? ''), `${id} ska finnas i TILES`);
  }
  const horn = transitionHornForMask(mask);
  if (horn) assert.ok(EDGE_SUFFIXES.includes(horn as (typeof EDGE_SUFFIXES)[number]), horn);
}

const hornOnly = new Set(['prov_till_par_horn_h', 'prov_till_par_horn_n', 'prov_till_par_horn_o', 'prov_till_par_horn_v']);
assert.equal(resolveTransitionTileId('prov_till_par', 3, undefined, hornOnly), 'prov_till_par_horn_h');
assert.equal(resolveTransitionTileId('prov_till_par', 6, undefined, hornOnly), 'prov_till_par_horn_n');
assert.equal(resolveTransitionTileId('prov_till_par', 9, undefined, hornOnly), 'prov_till_par_horn_o');
assert.equal(resolveTransitionTileId('prov_till_par', 12, undefined, hornOnly), 'prov_till_par_horn_v');
assert.equal(resolveTransitionTileId('prov_till_par', 1, undefined, hornOnly), null);

assert.equal(resolveTransitionTileId('gras_till_lera', 1), 'gras_till_lera_oh');
assert.equal(resolveTransitionTileId('gras_till_lera', 1, 0), 'gras_till_lera_oh_2');
assert.equal(resolveTransitionTileId('gras_till_lera', 1, 0.9), 'gras_till_lera_oh');
assert.equal(resolveTransitionTileId('gras_till_lera', 3), null, 'gras_till_lera saknar hörn och ska inte hitta på ett id');
assert.ok(tileSet.has('gras_till_lera_oh_2'));

const prefixes = new Set<string>();
for (const id of TILES) {
  const till = id.indexOf('_till_');
  if (till < 0) continue;
  for (const suffix of [...EDGE_SUFFIXES].sort((a, b) => b.length - a.length)) {
    if (!id.endsWith(`_${suffix}`) && !id.endsWith(`_${suffix}_2`)) continue;
    const cut = id.endsWith('_2') ? id.slice(0, -2) : id;
    const tail = `_${suffix}`;
    if (!cut.endsWith(tail)) continue;
    prefixes.add(cut.slice(0, -tail.length));
    break;
  }
}
assert.ok(prefixes.has('ljung_till_mossa'));
assert.ok(prefixes.has('myr_till_mossa'));
assert.ok(prefixes.has('myr_till_aska'));
assert.ok(prefixes.has('ljung_till_myr'));
for (const prefix of prefixes) {
  for (let mask = 0; mask < 16; mask++) {
    const id = resolveTransitionTileId(prefix, mask, 0.1);
    if (id !== null) assert.ok(tileSet.has(id), `${prefix} mask ${mask} gav okänt id ${id}`);
  }
}
assert.equal(resolveTransitionTileId('mossa_till_myr', 2), null);

for (const worldSeed of [1, 42, 99991]) {
  for (const biomeId of ['skog', 'trask', 'fjall', 'kust', 'ask']) {
    const lookup: BiomeLookup = () => biomeId;
    const pool = groundRolePoolForBiome(biomeId);
    for (const [gx, gy] of [
      [0, 0],
      [3, -8],
      [40, 12],
      [-15, 6],
      [borderGx - 30, 4],
    ] as const) {
      assert.equal(isBiomeBlendTile(worldSeed, gx, gy, lookup), false, `${biomeId} ska vara rent vid ${gx},${gy}`);
      assert.equal(
        pickBlendedGroundTileId(worldSeed, gx, gy, lookup),
        pickChunkGroundTileId(worldSeed, gx, gy, pool),
        `${biomeId} seed ${worldSeed} vid ${gx},${gy}`,
      );
    }
  }
}

for (const worldSeed of [7, 88, 123456]) {
  for (const gy of [-20, 0, 5, 33]) {
    const farWest = borderGx - 40;
    const farEast = borderGx + 40;
    assert.ok(biomeBorderDistanceTiles(worldSeed, farWest, gy, splitLookup) > BIOME_BLEND_WIDTH);
    assert.equal(isBiomeBlendTile(worldSeed, farWest, gy, splitLookup), false);
    assert.equal(isBiomeBlendTile(worldSeed, farEast, gy, splitLookup), false);
    assert.equal(
      pickBlendedGroundTileId(worldSeed, farWest, gy, splitLookup),
      pickChunkGroundTileId(worldSeed, farWest, gy, groundRolePoolForBiome('skog')),
    );
    assert.equal(
      pickBlendedGroundTileId(worldSeed, farEast, gy, splitLookup),
      pickChunkGroundTileId(worldSeed, farEast, gy, groundRolePoolForBiome('trask')),
    );
  }
}

const perChunk = chunkTileCount();
for (const worldSeed of [4, 19]) {
  for (const tj of [0, 1, 8, 31, 63]) {
    const fromWest = worldTileIndex(-1, 3, perChunk, tj);
    const fromEast = worldTileIndex(0, 3, 0, tj);
    assert.deepEqual(fromWest, fromEast, `söm tj=${tj}`);
    assert.equal(
      pickBlendedGroundTileId(worldSeed, fromWest.gx, fromWest.gy, splitLookup),
      pickBlendedGroundTileId(worldSeed, fromEast.gx, fromEast.gy, splitLookup),
      `blandzonens söm seed ${worldSeed} tj ${tj}`,
    );
  }
  for (const ti of [0, 2, 9, 40, 63]) {
    const fromNorth = worldTileIndex(2, -1, ti, perChunk);
    const fromSouth = worldTileIndex(2, 0, ti, 0);
    assert.deepEqual(fromNorth, fromSouth);
    const horizontal: BiomeLookup = (_cx, cy) => (cy < 0 ? 'fjall' : 'trask');
    assert.equal(
      pickBlendedGroundTileId(worldSeed, fromNorth.gx, fromNorth.gy, horizontal),
      pickBlendedGroundTileId(worldSeed, fromSouth.gx, fromSouth.gy, horizontal),
    );
  }
}

const orderPoints: readonly (readonly [number, number])[] = [
  [borderGx - 2, 4],
  [borderGx + 1, 4],
  [borderGx - 8, -12],
  [10, 10],
  [borderGx + 5, 20],
  [-100, 3],
];
const forward = orderPoints.map(([gx, gy]) => pickBlendedGroundTileId(11, gx, gy, splitLookup));
const backward = [...orderPoints].reverse().map(([gx, gy]) => pickBlendedGroundTileId(11, gx, gy, splitLookup));
assert.deepEqual(forward, [...backward].reverse(), 'samma ruta ska vara oberoende av anropsordning');
assert.deepEqual(
  forward,
  orderPoints.map(([gx, gy]) => pickBlendedGroundTileId(11, gx, gy, splitLookup)),
);

function assertAccept(lookup: BiomeLookup, x0: number, x1: number, y0: number, y1: number, worldSeed: number): void {
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const self = effectiveBiomeAtTile(worldSeed, gx, gy, lookup);
      const selfBlend = isBiomeBlendTile(worldSeed, gx, gy, lookup);
      const neighbors: readonly (readonly [number, number])[] = [
        [gx, gy - 1],
        [gx + 1, gy],
        [gx, gy + 1],
        [gx - 1, gy],
      ];
      for (const [nx, ny] of neighbors) {
        const other = effectiveBiomeAtTile(worldSeed, nx, ny, lookup);
        if (other === self) continue;
        assert.equal(selfBlend, true, `ren ruta ${gx},${gy} (${self}) rör ${nx},${ny} (${other})`);
        assert.equal(isBiomeBlendTile(worldSeed, nx, ny, lookup), true, `grannen ${nx},${ny} ska också ligga i blandzonen`);
      }
    }
  }
}

assertAccept(splitLookup, borderGx - 18, borderGx + 18, 0, 48, 5);
const southBorder = worldTileIndex(0, 0, 0, 0).gy;
const horizontalLookup: BiomeLookup = (_cx, cy) => (cy < 0 ? 'fjall' : 'skog');
assertAccept(horizontalLookup, -8, 24, southBorder - 14, southBorder + 14, 5);

let blendTiles = 0;
let mixedTiles = 0;
let twoWeights = 0;
for (let gy = -16; gy < 96; gy++) {
  for (let gx = borderGx - 16; gx <= borderGx + 16; gx++) {
    const weights = blendWeightsAtTile(21, gx, gy, splitLookup);
    const sum = weights.reduce((acc, row) => acc + row.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-6, `vikter vid ${gx},${gy} summerar till ${sum}`);
    if (!isBiomeBlendTile(21, gx, gy, splitLookup)) {
      assert.equal(weights.length, 1);
      continue;
    }
    if (weights.length >= 2) twoWeights += 1;
    blendTiles += 1;
    const raw = splitLookup(chunkOf(gx, gy).cx, chunkOf(gx, gy).cy);
    const home = pickChunkGroundTileId(21, gx, gy, groundRolePoolForBiome(raw));
    const got = pickBlendedGroundTileId(21, gx, gy, splitLookup);
    if (got !== home) mixedTiles += 1;
    const allowed = union(groundRolePoolForBiome('skog'));
    for (const id of union(groundRolePoolForBiome('trask'))) allowed.add(id);
    for (const id of tileSet) {
      if (id.startsWith('myr_till_mossa')) allowed.add(id);
    }
    assert.ok(allowed.has(got), `${got} vid ${gx},${gy} är varken markset eller övergång`);
  }
}
assert.ok(blendTiles > 100, `för få blandrutor: ${blendTiles}`);
assert.ok(twoWeights > 0, 'någon ruta i bandet ska ha två biomvikter');
const mixRatio = mixedTiles / blendTiles;
assert.ok(mixRatio >= 0.2 && mixRatio <= 0.8, `andel blandade rutor ${mixRatio.toFixed(3)} (${mixedTiles}/${blendTiles})`);

const crossings = new Set<number>();
for (let gy = 0; gy < 96; gy++) {
  let prev = effectiveBiomeAtTile(21, borderGx - 10, gy, splitLookup);
  for (let gx = borderGx - 9; gx <= borderGx + 10; gx++) {
    const next = effectiveBiomeAtTile(21, gx, gy, splitLookup);
    if (next !== prev) {
      crossings.add(gx);
      break;
    }
    prev = next;
  }
}
assert.ok(crossings.size > 1, `gränsen ska vandra med bruset, inte ligga på en enda gx (${[...crossings].join(',')})`);

const catalogBorder = worldTileIndex(-3, 0, 0, 0).gx;
assert.equal(biomeIdAtChunk(-4, 0), 'trask');
assert.equal(biomeIdAtChunk(-3, 0), 'skog');
const traskPool = union(groundRolePoolForBiome('trask'));
const skogPool = union(groundRolePoolForBiome('skog'));
const seamIds = new Set<string>();
let catalogMixed = 0;
let catalogSeen = 0;
for (let tj = 0; tj < perChunk; tj++) {
  const gy = worldTileIndex(-4, 0, 0, tj).gy;
  for (let dx = 0; dx < 6; dx++) {
    for (const gx of [catalogBorder - 1 - dx, catalogBorder + dx]) {
      const rawChunk = chunkOf(gx, gy);
      const raw = biomeIdAtChunk(rawChunk.cx, rawChunk.cy);
      const homePool = raw === 'trask' ? traskPool : skogPool;
      const home = pickChunkGroundTileId(3, gx, gy, groundRolePoolForBiome(raw));
      const got = pickBlendedGroundTileId(3, gx, gy);
      const again = pickBlendedGroundTileId(3, gx, gy);
      assert.equal(got, again);
      if (dx === 0 && gx < catalogBorder) seamIds.add(got);
      catalogSeen += 1;
      if (got !== home || !homePool.has(got)) catalogMixed += 1;
    }
  }
}
assert.ok(seamIds.size > 1, 'kantkolumnen ska inte vara en enda upprepad hem-tile');
assert.ok(catalogMixed > 0, 'skog/träsk-gränsen i katalogen ska blanda rutor');
assert.ok(catalogMixed < catalogSeen, 'hela bandet ska inte byta bort hem-marken');

const campCenter = worldTileIndex(1, 1, 32, 32);
assert.equal(biomeIdAtChunk(1, 1), 'skog');
assert.equal(
  pickBlendedGroundTileId(42, campCenter.gx, campCenter.gy),
  pickChunkGroundTileId(42, campCenter.gx, campCenter.gy, groundRolePoolForBiome('skog')),
);

const forestArgs = {
  worldSeed: 42,
  chunkSeed: chunkWorldSeed(42, 1, 1),
  cx: 1,
  cy: 1,
  biomeId: 'skog',
  pool: decorPoolForBiome('skog'),
};
const plainDecor = planDecorForChunk(forestArgs);
const weightedDecor = planDecorForChunk({
  ...forestArgs,
  blendBiomeAt: (gx, gy) => pickWeightedBiomeId(42, gx, gy, blendWeightsAtTile(42, gx, gy)),
});
assert.deepEqual(weightedDecor, plainDecor, 'ren skog långt från gränsen ska behålla samma dekor');
assert.ok(plainDecor.length >= 154 && plainDecor.length <= 172, `täthet ${plainDecor.length}`);

const traskIds = new Set(unionDecor(decorPoolForBiome('trask')));
const skogIds = new Set(unionDecor(decorPoolForBiome('skog')));
const mixedDecor = planDecorForChunk({
  worldSeed: 5,
  chunkSeed: 9,
  cx: 3,
  cy: 2,
  biomeId: 'skog',
  blendBiomeAt: (gx, gy) => (Rng.hash('dekor-test', gx, gy) % 2 === 0 ? 'trask' : 'skog'),
});
const againDecor = planDecorForChunk({
  worldSeed: 5,
  chunkSeed: 9,
  cx: 3,
  cy: 2,
  biomeId: 'skog',
  blendBiomeAt: (gx, gy) => (Rng.hash('dekor-test', gx, gy) % 2 === 0 ? 'trask' : 'skog'),
});
assert.deepEqual(mixedDecor, againDecor);
const swampOnly = mixedDecor.filter((item) => traskIds.has(item.id) && !skogIds.has(item.id));
assert.ok(swampOnly.length > 0, 'blandzonen ska kunna ställa träskets dekor');

function unionDecor(pool: { stor: readonly string[]; mellan: readonly string[]; liten: readonly string[] }): string[] {
  return [...pool.stor, ...pool.mellan, ...pool.liten];
}

console.log('biome-transitions.test.mts: ok', {
  blendTiles,
  mixRatio: Number(mixRatio.toFixed(3)),
  crossings: crossings.size,
  catalogMixed,
  seamIds: seamIds.size,
});
