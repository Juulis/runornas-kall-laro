import assert from 'node:assert/strict';
import { DATA } from '../src/data';
import { Zone } from '../src/world/Zone';
import type { World } from '../src/systems/World';
import { syncProximitySpawns } from '../src/systems/SpawnProximity';
import { buildBigWorldCatalog, generateChunkWorldData, type BigWorldSpawnRoll } from '../src/world/bigWorld/worldGenerator';
import { regionMonsterPerGame, regionSpawnScale } from '../src/world/bigWorld/regionSpawnBudget';
import {
  MELLANMARK_GROUP_MAX,
  MELLANMARK_GROUP_MIN,
  MELLANMARK_GROUP_SEPARATION,
  mellanmarkSpawnCountRange,
} from '../src/world/bigWorld/spawnDensity';
import { chunkSpawnToWorld } from '../src/world/bigWorld/bigWorldCoords';
import { CAMP_SAFE_RADIUS, START_POS_SAFE_RADIUS, campFirePos, campMonsterSpecs } from '../src/world/bigWorld/campMonsterField';
import { campStartPos } from '../src/world/bigWorld/startskogenFootprint';
import { FOREST_SPAWN_ACTIVE_RADIUS, MAX_LIVE_MONSTERS } from '../src/world/forestConstants';
import { resetBigWorldMonsterSync, syncBigWorldChunkMonsters } from '../src/world/bigWorld/syncBigWorldChunkMonsters';
import type { ChunkWorldCache } from '../src/world/bigWorld/chunkCache';

const catalog = buildBigWorldCatalog(DATA.varldStor);
const worldSeed = 42;
const gameSeed = 99;
const fire = campFirePos();
const startPos = campStartPos();

const far = generateChunkWorldData(worldSeed, gameSeed, 8, 2, catalog);
assert.ok(far.spawns.length >= mellanmarkSpawnCountRange(far.ring)[0], 'mellanmark ska följa design-täthet (min)');

const start = generateChunkWorldData(worldSeed, gameSeed, 1, 1, catalog);
assert.equal(start.spawns.length, 0, 'startskogen-chunk ska inte få genererade chunk-spawns (legacy spawnzoner)');

assert.deepEqual(mellanmarkSpawnCountRange(0), [40, 56], 'ring 0 ska vara tät');
assert.deepEqual(mellanmarkSpawnCountRange(1), [40, 56], 'ring 1 ska vara tät');
assert.deepEqual(mellanmarkSpawnCountRange(2), [32, 44]);
assert.deepEqual(mellanmarkSpawnCountRange(3), [32, 44]);
assert.deepEqual(mellanmarkSpawnCountRange(4), [26, 34]);
assert.deepEqual(mellanmarkSpawnCountRange(7), [26, 34], 'ring 4 och ut delar intervall');

const gamla = DATA.varldStor.regioner.find((r) => r.id === 'gamla_byn');
assert.ok(gamla);
const gamlaRaw = (gamla.tathet as { monster_per_game?: number })?.monster_per_game ?? 2;
assert.ok(gamlaRaw >= 40, `namngivna regioner ska vara tätare (${gamlaRaw})`);
const gamlaScale = regionSpawnScale(gamla.ringzon ?? 0);
const gamlaBudget = regionMonsterPerGame(gamla, gamla.ringzon ?? 0, DATA.varldStor);
assert.equal(gamlaBudget, gamlaRaw * gamlaScale);
let gamlaSpawns = 0;
for (let dx = -gamla.radie; dx <= gamla.radie; dx++) {
  for (let dy = -gamla.radie; dy <= gamla.radie; dy++) {
    const d = generateChunkWorldData(worldSeed, gameSeed, gamla.chunk[0] + dx, gamla.chunk[1] + dy, catalog);
    if (d.regionId === 'gamla_byn') gamlaSpawns += d.spawns.length;
  }
}
assert.ok(gamlaSpawns <= gamlaBudget, 'region ska följa skalad tathet.monster_per_game, inte en rå mellanmark per chunk');

function clearOfCamp(x: number, y: number, label: string): void {
  const dFire = Math.hypot(x - fire.x, y - fire.y);
  const dStart = Math.hypot(x - startPos.x, y - startPos.y);
  assert.ok(dFire >= CAMP_SAFE_RADIUS - 0.05, `${label} inne vid elden (${dFire.toFixed(2)})`);
  assert.ok(dStart >= START_POS_SAFE_RADIUS - 0.05, `${label} för nära start (${dStart.toFixed(2)})`);
}

for (let seed = 1; seed <= 4; seed++) {
  for (const s of campMonsterSpecs(seed)) clearOfCamp(s.pos[0], s.pos[1], s.uid);
}
for (let cx = -2; cx <= 2; cx++) {
  for (let cy = -2; cy <= 2; cy++) {
    const d = generateChunkWorldData(3, 5, cx, cy, catalog);
    for (const s of d.spawns) {
      const w = chunkSpawnToWorld(cx, cy, s.localX, s.localY);
      clearOfCamp(w.x, w.y, s.uid);
    }
  }
}

interface Cluster {
  x: number;
  y: number;
  n: number;
  champs: number;
}

/** Intra-grupp är högst cirka 6 enheter, mellan grupper minst 8. Tröskel 7 skiljer dem. */
function clustersOf(cx: number, cy: number, spawns: readonly BigWorldSpawnRoll[]): Cluster[] {
  const pts = spawns.map((s) => {
    const w = chunkSpawnToWorld(cx, cy, s.localX, s.localY);
    return { x: w.x, y: w.y, champ: s.elite === 'champion', used: false };
  });
  const out: Cluster[] = [];
  for (const p of pts) {
    if (p.used) continue;
    const group = [p];
    p.used = true;
    for (let i = 0; i < group.length; i++) {
      const cur = group[i];
      if (!cur) continue;
      for (const o of pts) {
        if (o.used) continue;
        if (Math.hypot(o.x - cur.x, o.y - cur.y) <= 7) {
          o.used = true;
          group.push(o);
        }
      }
    }
    const gx = group.reduce((sum, g) => sum + g.x, 0) / group.length;
    const gy = group.reduce((sum, g) => sum + g.y, 0) / group.length;
    out.push({ x: gx, y: gy, n: group.length, champs: group.filter((g) => g.champ).length });
  }
  return out;
}

const nearChunks: { cx: number; cy: number }[] = [];
const midChunks: { cx: number; cy: number }[] = [];
const farChunks: { cx: number; cy: number }[] = [];
for (let cx = -16; cx <= 16; cx++) {
  for (let cy = -16; cy <= 16; cy++) {
    const d = generateChunkWorldData(1, 1, cx, cy, catalog);
    if (!d.mellanmark || d.safe) continue;
    const spot = { cx, cy };
    if (d.ring <= 1) nearChunks.push(spot);
    else if (d.ring <= 3 && midChunks.length < 24) midChunks.push(spot);
    else if (d.ring >= 4 && farChunks.length < 24) farChunks.push(spot);
  }
}
assert.ok(nearChunks.length >= 8, `för få mellanmarkschunkar i ring 0-1 (${nearChunks.length})`);
assert.ok(midChunks.length >= 8, 'för få mellanmarkschunkar i ring 2-3');
assert.ok(farChunks.length >= 8, 'för få mellanmarkschunkar i ring 4 och ut');

const sums = { near: 0, mid: 0, far: 0 };
const counts = { near: 0, mid: 0, far: 0 };
const bonus = DATA.monsterLevels.elites.champion.level_bonus;
let sawChampGroup = false;
let unik = 0;

function checkChunk(seed: number, cx: number, cy: number, band: 'near' | 'mid' | 'far'): void {
  const d = generateChunkWorldData(seed, seed, cx, cy, catalog);
  assert.equal(d.mellanmark, true);
  const [lo, hi] = mellanmarkSpawnCountRange(d.ring);
  assert.ok(
    d.spawns.length >= lo && d.spawns.length <= hi,
    `seed ${seed} chunk ${cx},${cy} ring ${d.ring}: ${d.spawns.length} utanför ${lo}-${hi}`,
  );
  sums[band] += d.spawns.length;
  counts[band] += 1;
  const enemies = new Set(d.spawns.map((s) => s.enemy));
  assert.equal(enemies.size, 1, 'en undertyp per mellanmarkschunk');
  const groups = clustersOf(cx, cy, d.spawns);
  let champGroups = 0;
  for (const g of groups) {
    assert.ok(g.n >= MELLANMARK_GROUP_MIN && g.n <= MELLANMARK_GROUP_MAX, `gruppstorlek ${g.n}`);
    if (g.champs > 0) {
      champGroups++;
      assert.equal(g.champs, g.n, 'hela gruppen blir champion');
    }
  }
  assert.ok(champGroups <= 1, 'högst en championgrupp per chunk');
  if (d.ring < 2) assert.equal(champGroups, 0, 'ring 0-1 har inga mellanmarkschampions');
  if (champGroups === 1 && (groups.find((g) => g.champs > 0)?.n ?? 0) >= 2) sawChampGroup = true;
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i];
      const b = groups[j];
      if (!a || !b) continue;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(dist >= MELLANMARK_GROUP_SEPARATION - 0.05, `gruppers centra ${dist.toFixed(2)} isär`);
    }
  }
  for (const s of d.spawns) {
    if (s.elite === 'unik') unik++;
    const w = chunkSpawnToWorld(cx, cy, s.localX, s.localY);
    clearOfCamp(w.x, w.y, s.uid);
    if (s.elite !== 'champion') continue;
    const base = DATA.monsterLevels.fixed_levels?.[s.enemy];
    if (base != null) assert.equal(s.level, base + bonus);
  }
}

for (let seed = 1; seed <= 20; seed++) {
  for (const c of nearChunks) checkChunk(seed, c.cx, c.cy, 'near');
  for (const c of midChunks) checkChunk(seed, c.cx, c.cy, 'mid');
  for (const c of farChunks) checkChunk(seed, c.cx, c.cy, 'far');
}

function avg(band: 'near' | 'mid' | 'far'): number {
  return sums[band] / counts[band];
}
const nearAvg = avg('near');
const midAvg = avg('mid');
const farAvg = avg('far');
assert.ok(nearAvg >= 44 && nearAvg <= 52, `ring 0-1 snitt ${nearAvg.toFixed(2)}`);
assert.ok(midAvg >= 35 && midAvg <= 41, `ring 2-3 snitt ${midAvg.toFixed(2)}`);
assert.ok(farAvg >= 28 && farAvg <= 32, `ring 4 och ut snitt ${farAvg.toFixed(2)}`);
assert.equal(unik, 0, 'inga unika i mellanmark');
assert.ok(sawChampGroup, 'en championgrupp ska ha minst två monster');

resetBigWorldMonsterSync();
const zone = new Zone('forest', 'startskogen', 4096, 4096);
zone.bigWorldStreaming = true;
const capWorld = {
  zone,
  session: { seed: 1, worldSeed: 1, killed: new Set<string>() },
  monsters: [] as { uid: string; pos: { x: number; y: number }; hp: number; dead: number; view: { destroy: () => void } }[],
  objects: { removeChild() {} },
  hero: { pos: { x: 0, y: 0 } },
  spawnQueue: [] as { spec: { uid: string; enemy: string; level: number; boss: boolean }; pos: { x: number; y: number }; done: boolean }[],
} as unknown as World;
const factory = {
  refillStartskogenQueue() {},
  create(_w: World, _id: string, p: { x: number; y: number }, _lvl: number, spec: { uid: string }) {
    capWorld.monsters.push({ uid: spec.uid, pos: { x: p.x, y: p.y }, hp: 10, dead: 0, view: { destroy() {} } });
  },
};
const many = Array.from({ length: 80 }, (_, i) => ({
  uid: `bw:1,1:${i}:skogsvarg`,
  enemy: 'skogsvarg',
  level: 1,
  localX: 32,
  localY: 32,
  elite: null as const,
}));
const cache = {
  syncNear() {},
  get() {
    return { safe: false, spawns: many };
  },
} as unknown as ChunkWorldCache;
for (let i = 0; i < 5; i++) {
  syncBigWorldChunkMonsters(capWorld, cache, factory as never, 1, 1, capWorld.hero.pos);
}
const liveNear = capWorld.monsters.filter(
  (m) => m.hp > 0 && m.dead <= 0 && Math.hypot(m.pos.x - capWorld.hero.pos.x, m.pos.y - capWorld.hero.pos.y) <= FOREST_SPAWN_ACTIVE_RADIUS,
);
assert.equal(liveNear.length, MAX_LIVE_MONSTERS, 'chunk-synken stannar vid 60 levande inom radie 52');

capWorld.monsters.push({ uid: 'far:1', pos: { x: 400, y: 0 }, hp: 10, dead: 0, view: { destroy() {} } });
capWorld.monsters.push({ uid: 'corpse:1', pos: { x: 1, y: 0 }, hp: 0, dead: 1, view: { destroy() {} } });
zone.bigWorldStreaming = false;
capWorld.spawnQueue = Array.from({ length: 20 }, (_, i) => ({
  spec: { uid: `lager:cap${i}`, enemy: 'skogsvarg', level: 1, boss: false },
  pos: { x: 4, y: 0 },
  done: false,
}));
const before = capWorld.monsters.length;
syncProximitySpawns(capWorld, factory as never, capWorld.hero.pos);
const spawnedExtra = capWorld.monsters.length - before;
assert.equal(spawnedExtra, 0, 'taket gäller också lägerflocken när radien redan är full');
resetBigWorldMonsterSync();

console.log('big-world-spawn-density.test.mts: ok');
