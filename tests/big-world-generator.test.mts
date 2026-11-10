import assert from 'node:assert/strict';
import { DATA, validateData } from '../src/data';
import { regionSpawnChunkList, regionSpawnCountForChunk } from '../src/world/bigWorld/regionSpawnBudget';
import { generateChunkWorldData, getBigWorldCatalog } from '../src/world/bigWorld/worldGenerator';
import { chunkDistanceFromStart } from '../src/world/bigWorld/ringZone';
import { roadsAtChunk } from '../src/world/bigWorld/roads';

const seed = 424242;

const a = generateChunkWorldData(seed, seed, 1, 1);
const b = generateChunkWorldData(seed, seed, 1, 1);
assert.deepEqual(a, b);
assert.notEqual(generateChunkWorldData(seed + 1, seed, 1, 1).chunkSeed, a.chunkSeed);

const camp = generateChunkWorldData(seed, seed, 0, 0);
assert.equal(camp.regionId, 'startlagret');
assert.equal(camp.mellanmark, false);
assert.equal(camp.safe, true);
assert.equal(camp.ring, 0);

const skog = DATA.varldStor.regioner.find((r) => r.id === 'startskogen');
assert.ok(skog);
const startForest = generateChunkWorldData(seed, seed, skog.chunk[0], skog.chunk[1]);
assert.ok(startForest.pois.includes('rod_portal'));
const rod = DATA.varldStor.pois.find((p) => p.id === 'rod_portal');
assert.equal(rod?.krav, 'alla_tre_runor_aktiva');

const catalog = getBigWorldCatalog();
assert.ok(roadsAtChunk(catalog.roads, 0, 0).ids.includes('vag_ostra'));
assert.ok(roadsAtChunk(catalog.roads, 1, 1).ids.includes('vag_ostra'));

const d = generateChunkWorldData(seed, seed, 1, 1);
assert.equal(d.biomeId, 'skog');
assert.equal(d.biomeBlend[0]?.biomeId, 'skog');
assert.ok((d.biomeBlend[0]?.weight ?? 0) > 0.3);

const start = DATA.varldStor.meta.startpunkt.chunk;
const near = chunkDistanceFromStart(1, 1, start);
const far = chunkDistanceFromStart(10, 10, start);
assert.ok(far > near);

const vargstigen = generateChunkWorldData(seed, seed, 2, 0);
assert.equal(vargstigen.regionId, 'vargstigen');
assert.equal(vargstigen.generatedSpawn, true);
for (const s of vargstigen.spawns) {
  assert.ok(s.level >= vargstigen.levelBand[0]);
  assert.ok(s.level <= vargstigen.levelBand[1]);
}

const sodra = DATA.varldStor.regioner.find((r) => r.id === 'sodra_mon');
assert.ok(sodra);
const sodraChunk = generateChunkWorldData(seed, seed, sodra.chunk[0], sodra.chunk[1]);
assert.ok(sodraChunk.spawnSubtypes.length > 0);
assert.equal(sodraChunk.regionId, 'sodra_mon');
const sodraRaw = (sodra.tathet as { monster_per_game?: number }).monster_per_game ?? 0;
let sodraSpawns = 0;
let sodraExpected = 0;
for (const c of regionSpawnChunkList(sodra)) {
  const d = generateChunkWorldData(seed, seed, c.cx, c.cy);
  if (d.regionId !== 'sodra_mon') continue;
  sodraExpected += regionSpawnCountForChunk(sodra, c.cx, c.cy, seed, sodra.ringzon ?? 0, DATA.varldStor);
  sodraSpawns += d.spawns.length;
}
assert.equal(sodraSpawns, sodraExpected, 'chunkar som faktiskt är södra mon får sin andel');
assert.ok(sodraSpawns > sodraRaw, `skalad täthet ska överstiga råtalet ${sodraRaw}, fick ${sodraSpawns}`);

const katedral = DATA.varldStor.regioner.find((r) => r.id === 'katedralen');
assert.ok(katedral);
const katData = generateChunkWorldData(seed, seed, katedral.chunk[0], katedral.chunk[1]);
assert.ok(katData.spawnSubtypes.includes('hornslaktare') || katData.spawnSubtypes.includes('askriddare'));
assert.ok(katData.spawns.length > 0);

const sprickan = DATA.varldStor.regioner.find((r) => r.id === 'sprickans_botten');
assert.ok(sprickan);
const sprData = generateChunkWorldData(seed, seed, sprickan.chunk[0], sprickan.chunk[1]);
assert.ok(sprData.spawnSubtypes.includes('sprickvasen'), 'sprickans_botten ska använda design-undertyp sprickvasen');
assert.ok(sprData.spawns.length > 0);

const jarn = DATA.varldStor.regioner.find((r) => r.id === 'jarnklostret');
assert.ok(jarn);
const besideKloster = generateChunkWorldData(seed, seed, jarn.chunk[0], jarn.chunk[1] + 1);
assert.equal(besideKloster.mellanmark, true);
assert.equal(besideKloster.access, 'oppen');
assert.ok(besideKloster.regionId.startsWith('mellanmark:'));

const gravasen = DATA.varldStor.regioner.find((r) => r.id === 'gravasen');
assert.ok(gravasen);
const gravasenEdge = generateChunkWorldData(seed, seed, -1, 3);
assert.equal(gravasenEdge.regionId, 'gravasen');
assert.equal(gravasenEdge.generatedSpawn, true);
assert.ok(gravasenEdge.spawns.length > 0);
assert.deepEqual(gravasenEdge.levelBand, [7, 10]);

for (const id of ['brandkanten', 'dimvagen', 'korpholmarna'] as const) {
  const reg = DATA.varldStor.regioner.find((r) => r.id === id);
  assert.ok(reg);
  const at = generateChunkWorldData(seed, seed, reg.chunk[0], reg.chunk[1]);
  assert.equal(at.regionId, id);
  assert.ok(at.spawns.length > 0, `${id} ska spawna`);
}

assert.equal(validateData().filter((i) => i.startsWith('varld_stor')).length, 0);

console.log('big-world-generator.test.mts: ok');
