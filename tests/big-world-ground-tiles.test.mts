import assert from 'node:assert/strict';
import { Rng } from '../src/core/Rng';
import { DATA } from '../src/data';
import { BIG_WORLD_GROUND_BUILD_BUDGET_MS, BIG_WORLD_GROUND_PATCH_TILES } from '../src/world/bigWorld/bigWorldConfig';
import { chunkTileCount } from '../src/world/bigWorld/bigWorldCoords';
import { SKOG_GROUND_ROLES } from '../src/world/bigWorld/biomeBlend';
import {
  buildChunkGroundViaPatchOrder,
  chunkGroundTileGrid,
  fillPatchGroundTiles,
  groundRoleAt,
  patchOrderByDistance,
  pickChunkGroundTileId,
  worldTileIndex,
  type GroundRole,
  type GroundRolePool,
} from '../src/world/bigWorld/groundTiles';
import { worldValueNoise } from '../src/world/bigWorld/worldNoise';
import { buildBigWorldCatalog, generateChunkWorldData } from '../src/world/bigWorld/worldGenerator';

const pool = ['gras_1', 'gras_2', 'gras_3'];
const worldSeed = 99887766;
const tiles = chunkTileCount();
const patchTiles = BIG_WORLD_GROUND_PATCH_TILES;
const cx = 0;
const cy = 0;

for (const [gx, gy] of [
  [0, 0],
  [-96, 4],
  [1000, -40],
  [7, 13],
] as const) {
  const a = worldValueNoise(worldSeed, gx, gy);
  assert.equal(a, worldValueNoise(worldSeed, gx, gy), `brus deterministiskt vid ${gx},${gy}`);
  assert.ok(a >= 0 && a <= 1, `brus ${a} utanför [0, 1]`);
}
const cached = worldValueNoise(4, 10, 10);
worldValueNoise(4, 500, -20);
worldValueNoise(9, 10, 10);
assert.equal(worldValueNoise(4, 10, 10), cached, 'brus ska vara detsamma efter andra sampel');

let noiseDiffers = false;
for (let i = 0; i < 24; i++) {
  if (worldValueNoise(1, i * 3, 2) !== worldValueNoise(2, i * 3, 2)) noiseDiffers = true;
}
assert.ok(noiseDiffers, 'annat worldSeed ska kunna ge annat brus');

let near = 0;
let far = 0;
const smoothSamples = 64;
for (let i = 0; i < smoothSamples; i++) {
  const x = -30 + i * 4;
  const y = 10 + i;
  near += Math.abs(worldValueNoise(11, x, y) - worldValueNoise(11, x + 1, y));
  far += Math.abs(worldValueNoise(11, x, y) - worldValueNoise(11, x + 21, y));
}
assert.ok(near / smoothSamples < 0.06, `närliggande rutor ska likna varandra (${near / smoothSamples})`);
assert.ok(far > near * 3, 'brus över ~14 rutor ska variera mer än ett steg');

assert.equal(groundRoleAt(worldSeed, 3, 9), groundRoleAt(worldSeed, 3, 9));
assert.equal(pickChunkGroundTileId(worldSeed, 3, 9, pool), pickChunkGroundTileId(worldSeed, 3, 9, pool));
assert.equal(pickChunkGroundTileId(worldSeed, 3, 9, SKOG_GROUND_ROLES), pickChunkGroundTileId(worldSeed, 3, 9, SKOG_GROUND_ROLES));
assert.equal(pickChunkGroundTileId(worldSeed, 0, 0, []), 'gras_1');

const gridA = chunkGroundTileGrid(worldSeed, cx, cy, tiles, pool);
const gridB = chunkGroundTileGrid(worldSeed, cx, cy, tiles, pool);
assert.deepEqual(gridA, gridB);

const orderA = patchOrderByDistance(0, 0, tiles, patchTiles);
const orderB = patchOrderByDistance(3, 3, tiles, patchTiles);
const builtA = buildChunkGroundViaPatchOrder(worldSeed, cx, cy, tiles, pool, patchTiles, orderA);
const builtB = buildChunkGroundViaPatchOrder(worldSeed, cx, cy, tiles, pool, patchTiles, orderB);
assert.deepEqual(builtA, gridA, 'patchordning via fillPatchGroundTiles ska ge fullständig chunk');
assert.deepEqual(builtB, gridA, 'annan patchstart ska ge samma slutgrid');

const roleBuilt = buildChunkGroundViaPatchOrder(worldSeed, cx, cy, tiles, SKOG_GROUND_ROLES, patchTiles, orderB);
const roleGrid = chunkGroundTileGrid(worldSeed, cx, cy, tiles, SKOG_GROUND_ROLES);
assert.deepEqual(roleBuilt, roleGrid, 'rollpool ska också vara oberoende av byggordning');

const catalog = buildBigWorldCatalog(DATA.varldStor);
const c10a = generateChunkWorldData(555, 777, 1, 0, catalog);
const c10b = generateChunkWorldData(555, 777, 1, 0, catalog);
assert.equal(c10a.chunkSeed, c10b.chunkSeed);
const p10 = c10a.tilePool.length ? c10a.tilePool : ['gras_1'];
const fromDirect = chunkGroundTileGrid(555, 1, 0, tiles, p10);
const fromPatches = buildChunkGroundViaPatchOrder(555, 1, 0, tiles, p10, patchTiles, patchOrderByDistance(3, 0, tiles, patchTiles));
for (let ti = 0; ti < tiles; ti++) {
  for (let tj = 0; tj < tiles; tj++) {
    assert.equal(fromPatches[ti]?.[tj], fromDirect[ti]?.[tj], `chunk (1,0) tile ${ti},${tj}`);
  }
}

const otherGrid = chunkGroundTileGrid(Rng.hash(worldSeed, 1), cx, cy, tiles, pool);
assert.notDeepEqual(otherGrid, gridA, 'annat worldSeed ska ge annat mönster');

const seamPools: (GroundRolePool | readonly string[])[] = [pool, SKOG_GROUND_ROLES];
for (const seed of [1, worldSeed]) {
  for (const tj of [0, 1, 8, 15, 31, 63]) {
    const west = worldTileIndex(0, 0, tiles, tj);
    const east = worldTileIndex(1, 0, 0, tj);
    assert.deepEqual(west, east, `x-söm tj=${tj}`);
    assert.equal(worldValueNoise(seed, west.gx, west.gy), worldValueNoise(seed, east.gx, east.gy));
    assert.equal(groundRoleAt(seed, west.gx, west.gy), groundRoleAt(seed, east.gx, east.gy));
    for (const samplePool of seamPools) {
      assert.equal(
        pickChunkGroundTileId(seed, west.gx, west.gy, samplePool),
        pickChunkGroundTileId(seed, east.gx, east.gy, samplePool),
        `x-söm tile seed ${seed} tj ${tj}`,
      );
    }
  }
  for (const ti of [0, 2, 9, 20, 40, 63]) {
    const north = worldTileIndex(0, 0, ti, tiles);
    const south = worldTileIndex(0, 1, ti, 0);
    assert.deepEqual(north, south, `y-söm ti=${ti}`);
    assert.equal(groundRoleAt(seed, north.gx, north.gy), groundRoleAt(seed, south.gx, south.gy));
    for (const samplePool of seamPools) {
      assert.equal(
        pickChunkGroundTileId(seed, north.gx, north.gy, samplePool),
        pickChunkGroundTileId(seed, south.gx, south.gy, samplePool),
        `y-söm tile seed ${seed} ti ${ti}`,
      );
    }
  }
}

const negOrigin = worldTileIndex(-2, 3, 0, 0);
const negAt = worldTileIndex(-2, 3, 5, 9);
assert.equal(negAt.gx, negOrigin.gx + 5);
assert.equal(negAt.gy, negOrigin.gy + 9);

const edgeLeft = worldTileIndex(0, 0, tiles - 1, 0);
const edgeRight = worldTileIndex(1, 0, 0, 0);
assert.equal(edgeRight.gx, edgeLeft.gx + 1);
assert.equal(edgeRight.gy, edgeLeft.gy);
const edgeUp = worldTileIndex(0, 0, 0, tiles - 1);
const edgeDown = worldTileIndex(0, 1, 0, 0);
assert.equal(edgeDown.gy, edgeUp.gy + 1);
assert.equal(edgeDown.gx, edgeUp.gx);

function saltedRole(seed: number, gx: number, gy: number): GroundRole {
  const r = new Rng(Rng.hash(seed, 'salt', gx, gy)).next();
  if (r < 0.7) return 'base';
  if (r < 0.9) return 'patchA';
  if (r < 0.98) return 'patchB';
  return 'rare';
}

function collectChunkRoles(side: number, at: (gx: number, gy: number) => GroundRole): GroundRole[][] {
  const size = side * tiles;
  const grid: GroundRole[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => 'base' as GroundRole));
  const origin = worldTileIndex(0, 0, 0, 0);
  for (let chunkY = 0; chunkY < side; chunkY++) {
    for (let chunkX = 0; chunkX < side; chunkX++) {
      for (let tj = 0; tj < tiles; tj++) {
        for (let ti = 0; ti < tiles; ti++) {
          const { gx, gy } = worldTileIndex(chunkX, chunkY, ti, tj);
          const ix = gx - origin.gx;
          const iy = gy - origin.gy;
          const row = grid[iy];
          if (!row || ix < 0 || ix >= size || iy < 0 || iy >= size) {
            throw new Error(`världsruta ${gx},${gy} hamnade utanför ${size}×${size}`);
          }
          row[ix] = at(gx, gy);
        }
      }
    }
  }
  return grid;
}

function neighborCohesion(grid: readonly (readonly GroundRole[])[]): number {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  let same = 0;
  let total = 0;
  for (let y = 0; y < height; y++) {
    const row = grid[y];
    if (!row) continue;
    for (let x = 0; x < width; x++) {
      const role = row[x];
      if (role === undefined) continue;
      if (x + 1 < width) {
        total++;
        if (row[x + 1] === role) same++;
      }
      if (y + 1 < height) {
        total++;
        if (grid[y + 1]?.[x] === role) same++;
      }
    }
  }
  return total === 0 ? 0 : same / total;
}

function roleShares(grid: readonly (readonly GroundRole[])[]): Record<GroundRole, number> {
  const count = { base: 0, patchA: 0, patchB: 0, rare: 0 };
  let n = 0;
  for (const row of grid) {
    for (const role of row) {
      count[role]++;
      n++;
    }
  }
  return {
    base: count.base / n,
    patchA: count.patchA / n,
    patchB: count.patchB / n,
    rare: count.rare / n,
  };
}

const areaSeeds = [1, 7, 42, 555, worldSeed];
const sideChunks = 3;
const refCohesion = new Map<number, number>();

for (const seed of areaSeeds) {
  const ref = collectChunkRoles(sideChunks, (gx, gy) => saltedRole(seed, gx, gy));
  const refCoh = neighborCohesion(ref);
  refCohesion.set(seed, refCoh);
  console.log(`referens seed ${seed}: ${(refCoh * 100).toFixed(1)}% samma roll hos granne`);
  assert.ok(refCoh < 0.62, `referensens salt ska ligga runt 50 %, fick ${(refCoh * 100).toFixed(1)}%`);
}

for (const seed of areaSeeds) {
  const grid = collectChunkRoles(sideChunks, (gx, gy) => groundRoleAt(seed, gx, gy));
  const coh = neighborCohesion(grid);
  const refCoh = refCohesion.get(seed) ?? 1;
  console.log(`brus seed ${seed}: ${(coh * 100).toFixed(1)}% samma roll hos granne`);
  assert.ok(coh > 0.7, `sammanhållning för seed ${seed} är ${(coh * 100).toFixed(1)}%, ska vara över 70%`);
  assert.ok(coh > refCoh, `brus ska hålla ihop tydligare än salt (${(coh * 100).toFixed(1)}% mot ${(refCoh * 100).toFixed(1)}%)`);

  const share = roleShares(grid);
  console.log(
    `yta seed ${seed}: bas ${(share.base * 100).toFixed(1)}% fläck A ${(share.patchA * 100).toFixed(1)}% fläck B ${(share.patchB * 100).toFixed(1)}% sällsynt ${(share.rare * 100).toFixed(1)}%`,
  );
  assert.ok(share.base >= 0.6 && share.base <= 0.8, `bas ${share.base}`);
  assert.ok(share.patchA >= 0.12 && share.patchA <= 0.28, `fläck A ${share.patchA}`);
  assert.ok(share.patchB >= 0.04 && share.patchB <= 0.14, `fläck B ${share.patchB}`);
  assert.ok(share.rare >= 0.005 && share.rare <= 0.05, `sällsynt ${share.rare}`);
}

const seenForest = new Set<string>();
for (let gy = 0; gy < 48; gy++) {
  for (let gx = 0; gx < 48; gx++) {
    const role = groundRoleAt(worldSeed, gx, gy);
    const tile = pickChunkGroundTileId(worldSeed, gx, gy, SKOG_GROUND_ROLES);
    const allowed = SKOG_GROUND_ROLES[role];
    const list = allowed.length > 0 ? allowed : SKOG_GROUND_ROLES.base;
    assert.ok(list.includes(tile), `${tile} hör inte till ${role}`);
    seenForest.add(tile);
  }
}
assert.ok(seenForest.has('gras_1') || seenForest.has('gras_2') || seenForest.has('gras_3') || seenForest.has('gras_4'));
assert.ok(seenForest.has('mossa_1') || seenForest.has('mossa_2'));
assert.ok(seenForest.has('gras_blommor_1') || seenForest.has('gras_blommor_2') || seenForest.has('skogsbotten_ormbunke'));

assert.equal(BIG_WORLD_GROUND_BUILD_BUDGET_MS, 4);

const benchGrid = Array.from({ length: patchTiles }, () => Array.from({ length: patchTiles }, () => ''));
for (let i = 0; i < 8; i++) fillPatchGroundTiles(benchGrid, 12345, 2, -1, pool, 0, 0, patchTiles, patchTiles);
const samples: number[] = [];
for (let i = 0; i < 21; i++) {
  const t0 = performance.now();
  fillPatchGroundTiles(benchGrid, 12345, 2, -1, pool, 0, 0, patchTiles, patchTiles);
  samples.push(performance.now() - t0);
}
samples.sort((a, b) => a - b);
const medianMs = samples[Math.floor(samples.length / 2)] ?? Number.POSITIVE_INFINITY;
console.log(`patch ${patchTiles}×${patchTiles}: ${medianMs.toFixed(3)} ms (median)`);
assert.ok(medianMs < 2, `markpatch tog ${medianMs.toFixed(3)} ms`);

console.log('big-world-ground-tiles.test.mts: ok');
