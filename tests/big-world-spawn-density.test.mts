import assert from 'node:assert/strict';
import { DATA } from '../src/data';
import { buildBigWorldCatalog, generateChunkWorldData } from '../src/world/bigWorld/worldGenerator';
import { mellanmarkSpawnCountRange } from '../src/world/bigWorld/spawnDensity';

const catalog = buildBigWorldCatalog(DATA.varldStor);
const worldSeed = 42;
const gameSeed = 99;

const far = generateChunkWorldData(worldSeed, gameSeed, 8, 2, catalog);
assert.ok(far.spawns.length >= mellanmarkSpawnCountRange(far.ring)[0], 'mellanmark ska följa design-täthet (min)');

const start = generateChunkWorldData(worldSeed, gameSeed, 1, 1, catalog);
assert.equal(start.spawns.length, 0, 'startskogen-chunk ska inte få genererade chunk-spawns (legacy spawnzoner)');

const gamla = DATA.varldStor.regioner.find((r) => r.id === 'gamla_byn');
assert.ok(gamla);
const near = mellanmarkSpawnCountRange(0);
assert.deepEqual(near, [1, 3], 'mellanmarken ska vara tätare än det gamla [0, 2]');
const gamlaBudget = (gamla.tathet as { monster_per_game?: number })?.monster_per_game ?? 2;
assert.ok(gamlaBudget >= 40, `namngivna regioner ska vara tätare (${gamlaBudget})`);
let gamlaSpawns = 0;
for (let dx = -gamla.radie; dx <= gamla.radie; dx++) {
  for (let dy = -gamla.radie; dy <= gamla.radie; dy++) {
    const d = generateChunkWorldData(worldSeed, gameSeed, gamla.chunk[0] + dx, gamla.chunk[1] + dy, catalog);
    if (d.regionId === 'gamla_byn') gamlaSpawns += d.spawns.length;
  }
}
assert.ok(gamlaSpawns <= gamlaBudget, 'region ska följa tathet.monster_per_game, inte mellanmark per chunk');

const bonus = DATA.monsterLevels.elites.champion.level_bonus;
let sawPair = false;
let sawChampGroup = false;
let champEarly = 0;
let unik = 0;
let mixed = 0;
for (let seed = 1; seed <= 24; seed++) {
  for (let cx = 4; cx <= 16; cx++) {
    for (let cy = -4; cy <= 8; cy++) {
      const d = generateChunkWorldData(seed, seed, cx, cy, catalog);
      if (!d.mellanmark) continue;
      assert.ok(d.spawns.length <= mellanmarkSpawnCountRange(d.ring)[1]);
      assert.ok(d.spawns.length <= 3, 'mellanmarkens budget är högst en grupp');
      const champs = d.spawns.filter((s) => s.elite === 'champion');
      if (champs.length > 0 && champs.length !== d.spawns.length) mixed++;
      if (d.ring < 2 && champs.length > 0) champEarly++;
      if (d.spawns.length >= 2) sawPair = true;
      if (champs.length >= 2) sawChampGroup = true;
      for (const s of d.spawns) {
        if (s.elite === 'unik') unik++;
        if (s.elite !== 'champion') continue;
        const base = DATA.monsterLevels.fixed_levels?.[s.enemy];
        if (base != null) assert.equal(s.level, base + bonus);
      }
    }
  }
}
assert.equal(mixed, 0, 'champion gäller hela gruppen, högst en grupp');
assert.equal(champEarly, 0, 'ring 0–1 har inga mellanmarkschampions');
assert.equal(unik, 0, 'inga unika i mellanmark');
assert.ok(sawPair, 'mellanmark ska kunna spawna mer än ett monster');
assert.ok(sawChampGroup, 'en championgrupp ska lyfta hela gruppen');

console.log('big-world-spawn-density.test.mts: ok');
