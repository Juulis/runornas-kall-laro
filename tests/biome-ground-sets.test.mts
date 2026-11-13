/**
 * Varje biom har ett eget markset. Inga webbläsartester.
 * Kör: npx tsx tests/biome-ground-sets.test.mts
 */
import assert from 'node:assert/strict';
import varldStor from '../src/data/varld_stor.json';
import { STARTUP_TILES, TILES, tilesForBiome } from '../src/render/biomeAssetGroups';
import { BIOME_GROUND_ROLES, groundRolePoolForBiome } from '../src/world/bigWorld/biomeBlend';
import { chunkTileCount } from '../src/world/bigWorld/bigWorldCoords';
import { pickChunkGroundTileId, worldTileIndex, type GroundRolePool } from '../src/world/bigWorld/groundTiles';

const BIOMES = ['skog', 'trask', 'fjall', 'kust', 'ask'] as const;
const ROLES = ['bas', 'flack_a', 'flack_b', 'sallsynt'] as const;

function union(pool: GroundRolePool): Set<string> {
  return new Set([...pool.base, ...pool.patchA, ...pool.patchB, ...pool.rare]);
}

function poolFromMarkset(markset: {
  bas: readonly string[];
  flack_a: readonly string[];
  flack_b: readonly string[];
  sallsynt: readonly string[];
}): GroundRolePool {
  return {
    base: [...markset.bas],
    patchA: [...markset.flack_a],
    patchB: [...markset.flack_b],
    rare: [...markset.sallsynt],
  };
}

const tileSet = new Set<string>(TILES);
const startup = new Set<string>(STARTUP_TILES);
const forest = union(groundRolePoolForBiome('skog'));

for (const id of BIOMES) {
  const markset = varldStor.biomer[id].markset;
  const expected = poolFromMarkset(markset);
  const pool = groundRolePoolForBiome(id);
  assert.deepEqual(pool, expected, `${id}: groundRolePoolForBiome ska följa markset`);
  assert.deepEqual(BIOME_GROUND_ROLES[id], pool, `${id}: BIOME_GROUND_ROLES ska vara samma pool`);

  const tiles = union(pool);
  assert.ok(tiles.size >= 3, `${id} har bara ${tiles.size} olika markplattor`);

  for (const role of ROLES) {
    for (const tileId of markset[role]) {
      assert.ok(tileSet.has(tileId), `${id}.${role} ${tileId} saknas i TILES`);
    }
  }

  if (id === 'skog') continue;
  const shared = [...tiles].filter((tileId) => forest.has(tileId)).sort();
  assert.deepEqual(shared, id === 'kust' ? ['gras_4'] : [], `${id} delar ${shared.join(', ')} med skogen`);
}

assert.ok(forest.size >= 3, 'skogen ska ha minst 3 olika markplattor');

const forestPool = groundRolePoolForBiome('skog');
assert.deepEqual(groundRolePoolForBiome(''), forestPool, 'tomt biom-id ska ge skogen');
assert.deepEqual(groundRolePoolForBiome('okant'), forestPool, 'okänt biom-id ska ge skogen');

const worldSeed = 424242;
for (const id of BIOMES) {
  const pool = groundRolePoolForBiome(id);
  const allowed = union(pool);
  for (let gy = -4; gy < 28; gy++) {
    for (let gx = -4; gx < 28; gx++) {
      const first = pickChunkGroundTileId(worldSeed, gx, gy, pool);
      const again = pickChunkGroundTileId(worldSeed, gx, gy, pool);
      assert.equal(first, again, `${id} ska vara deterministisk vid ${gx},${gy}`);
      assert.ok(allowed.has(first), `${id}: ${first} finns inte i biomets pool`);
    }
  }
}

const tilesPerChunk = chunkTileCount();
const seamPools = [groundRolePoolForBiome('skog'), groundRolePoolForBiome('trask')];
for (const seed of [1, worldSeed]) {
  for (const tj of [0, 1, 8, 15, 31, 63]) {
    const west = worldTileIndex(0, 0, tilesPerChunk, tj);
    const east = worldTileIndex(1, 0, 0, tj);
    assert.deepEqual(west, east, `x-söm tj=${tj}`);
    for (const pool of seamPools) {
      assert.equal(
        pickChunkGroundTileId(seed, west.gx, west.gy, pool),
        pickChunkGroundTileId(seed, east.gx, east.gy, pool),
        `x-söm seed ${seed} tj ${tj}`,
      );
    }
  }
  for (const ti of [0, 2, 9, 20, 40, 63]) {
    const north = worldTileIndex(0, 0, ti, tilesPerChunk);
    const south = worldTileIndex(0, 1, ti, 0);
    assert.deepEqual(north, south, `y-söm ti=${ti}`);
    for (const pool of seamPools) {
      assert.equal(
        pickChunkGroundTileId(seed, north.gx, north.gy, pool),
        pickChunkGroundTileId(seed, south.gx, south.gy, pool),
        `y-söm seed ${seed} ti ${ti}`,
      );
    }
  }
}

const kustLoad = tilesForBiome('kust');
const kustMark = ['grus_2', 'lera_1', 'lera_2', 'lera_3', 'gras_4', 'kullersten'] as const;
for (const tileId of kustMark) {
  if (startup.has(tileId)) {
    assert.equal(kustLoad.includes(tileId), false, `${tileId} ligger i startup och ska inte laddas igen för kusten`);
  } else {
    assert.ok(kustLoad.includes(tileId), `${tileId} ska ingå i tilesForBiome('kust')`);
  }
}
assert.equal(kustLoad.includes('gras_1'), false);
assert.equal(kustLoad.includes('ljung_1'), false);
assert.equal(startup.has('grus_2'), false);

console.log('biome-ground-sets.test.mts: ok');
