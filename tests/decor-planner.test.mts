/**
 * Dekorplanerare: täta dungar, gläntor och tre lager utan Pixi.
 * Kör: npx tsx tests/decor-planner.test.mts
 */
import assert from 'node:assert/strict';
import { DATA } from '../src/data';
import { DECOR } from '../src/render/biomeAssetGroups';
import { TILE_WORLD } from '../src/render/Iso';
import { CAMP_SAFE_RADIUS, campFirePos } from '../src/world/bigWorld/campMonsterField';
import { bigWorldCityPortalWorld } from '../src/world/bigWorld/bigWorldPortals';
import { worldToChunk } from '../src/world/bigWorld/bigWorldCoords';
import { biomeRenderPlaceholders } from '../src/world/bigWorld/biomeBlend';
import {
  applyDecorBudget,
  decorPoolForBiome,
  DECOR_SPRITE_CAP,
  planDecorForChunk,
  shouldPlaceDecorAt,
  type PlannedDecor,
} from '../src/world/bigWorld/decorPlanner';
import { isRoadMaskAtWorld, shouldSpawnDecorAt } from '../src/world/bigWorld/roads';
import { campStartPos } from '../src/world/bigWorld/startskogenFootprint';
import { worldValueNoise } from '../src/world/bigWorld/worldNoise';
import { chunkWorldSeed, generateChunkWorldData } from '../src/world/bigWorld/worldGenerator';
import { PLAYABLE_CITIES } from '../src/world/cityZones';
import { Zone } from '../src/world/Zone';

const start = campStartPos();
const fire = campFirePos();
const knownDecor = new Set<string>(DECOR);
const forestSeeds = [1, 2, 7, 42, 99, 12345];
const forestChunks: readonly (readonly [number, number])[] = [
  [1, 1],
  [2, 0],
  [0, 2],
  [4, 4],
];

function planForest(worldSeed: number, cx: number, cy: number): PlannedDecor[] {
  return planDecorForChunk({
    worldSeed,
    chunkSeed: chunkWorldSeed(worldSeed, cx, cy),
    cx,
    cy,
    biomeId: 'skog',
    pool: decorPoolForBiome('skog'),
  });
}

function hypot(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

const skogPool = DATA.varldStor.biomer.skog?.dekor_pool;
assert.ok(skogPool, 'skog ska ha dekor_pool i varld_stor');
assert.deepEqual(decorPoolForBiome('skog'), {
  stor: [...skogPool.stor],
  mellan: [...skogPool.mellan],
  liten: [...skogPool.liten],
});
assert.ok(skogPool.liten.length >= 3, 'skogens lilla lager behöver minst tre sprite-id');
assert.ok(decorPoolForBiome('skog').stor.includes('gran'), 'gran och björk ska blandas i skogen');
assert.ok(decorPoolForBiome('skog').stor.includes('bjork'));
assert.ok(decorPoolForBiome('skog').stor.includes('dod_ek'));
assert.ok(decorPoolForBiome('fjall').stor.includes('fjallbjork'));
assert.deepEqual(decorPoolForBiome('okand-biom'), decorPoolForBiome('skog'));

for (const biomeId of ['skog', 'trask', 'fjall', 'kust', 'ask']) {
  const pool = decorPoolForBiome(biomeId);
  for (const id of [...pool.stor, ...pool.mellan, ...pool.liten]) {
    assert.ok(knownDecor.has(id), `${biomeId} dekor_pool pekar på okänt id ${id}`);
  }
  const flat = biomeRenderPlaceholders(DATA.varldStor.biomer[biomeId]);
  assert.deepEqual(flat.decorPool, [...pool.stor, ...pool.mellan, ...pool.liten], `${biomeId} ska platta ut dekor_pool`);
  assert.deepEqual(flat.decorLayers, pool);
}

const legacy = biomeRenderPlaceholders({ id: 'skog', namn: 'Skog' });
assert.deepEqual(legacy.decorPool, ['gran', 'bjork', 'runsten', 'vagros_blommor']);
assert.deepEqual(legacy.decorLayers, decorPoolForBiome('skog'));

const sameArgs = { worldSeed: 42, chunkSeed: 7, cx: 1, cy: 1, biomeId: 'skog' };
const first = planDecorForChunk(sameArgs);
const second = planDecorForChunk(sameArgs);
assert.deepEqual(first, second, 'samma argument ska ge samma lista');
assert.notDeepEqual(first, planDecorForChunk({ ...sameArgs, worldSeed: 43 }), 'annat worldSeed ska ge annan lista');
assert.notDeepEqual(first, planDecorForChunk({ ...sameArgs, chunkSeed: 8 }), 'annat chunkSeed ska ge annan lista');
assert.ok(first.length > 0);

for (const worldSeed of forestSeeds) {
  for (const [cx, cy] of forestChunks) {
    const list = planForest(worldSeed, cx, cy);
    assert.ok(list.length >= 150 && list.length <= 220, `skog ${worldSeed} [${cx},${cy}] har ${list.length} dekor, väntat 150–220`);
    const ids = new Set(list.map((item) => item.id));
    const liten = new Set(list.filter((item) => item.layer === 'liten').map((item) => item.id));
    assert.ok(ids.size > 5, `skog ${worldSeed} [${cx},${cy}] har bara ${ids.size} olika sprites`);
    assert.ok(liten.size >= 3, `skog ${worldSeed} [${cx},${cy}] har bara ${liten.size} små sprites`);
    const pool = decorPoolForBiome('skog');
    let mirrors = 0;
    let stor = 0;
    for (const item of list) {
      assert.ok(pool[item.layer].includes(item.id), `${item.id} finns inte i lager ${item.layer}`);
      assert.ok(Math.abs(item.scaleX) >= 0.35 && Math.abs(item.scaleX) <= 0.6, `scaleX ${item.scaleX}`);
      assert.ok(item.scaleY >= 0.35 && item.scaleY <= 0.6, `scaleY ${item.scaleY}`);
      assert.equal(Math.abs(item.scaleX), item.scaleY);
      if (item.scaleX < 0) mirrors += 1;
      const owner = worldToChunk(item.wx, item.wy);
      assert.equal(owner.cx, cx, `dekor vid ${item.wx},${item.wy} ägs av chunk ${owner.cx} inte ${cx}`);
      assert.equal(owner.cy, cy);
      assert.equal(shouldPlaceDecorAt(worldSeed, item.wx, item.wy), true);
      assert.ok(hypot(item.wx, item.wy, start.x, start.y) >= 3);
      assert.ok(hypot(item.wx, item.wy, fire.x, fire.y) >= CAMP_SAFE_RADIUS);
      const gx = Math.floor(item.wx / TILE_WORLD);
      const gy = Math.floor(item.wy / TILE_WORLD);
      if (worldValueNoise(worldSeed, gx, gy) < 0.3) {
        assert.equal(item.layer, 'liten', 'glänta får bara små saker');
        assert.equal(item.collider, null);
      }
      if (item.layer === 'stor') {
        stor += 1;
        assert.ok(item.collider, 'stora saker ska ha kollision');
        assert.equal(item.collider.x, item.wx);
        assert.equal(item.collider.y, item.wy);
        assert.ok(item.collider.r === 0.9 || item.collider.r === 0.8);
      } else {
        assert.equal(item.collider, null);
      }
    }
    assert.ok(stor > 0, `skog ${worldSeed} [${cx},${cy}] saknar stora träd`);
    assert.ok(mirrors > list.length * 0.2 && mirrors < list.length * 0.8, `spegling ${mirrors}/${list.length}`);
  }
}

const campChunks: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
];
let inMonsterRing = 0;
for (const worldSeed of [1, 42, 99]) {
  for (const [cx, cy] of campChunks) {
    for (const item of planForest(worldSeed, cx, cy)) {
      const fromStart = hypot(item.wx, item.wy, start.x, start.y);
      const fromFire = hypot(item.wx, item.wy, fire.x, fire.y);
      assert.ok(fromStart >= 3, `dekor ${fromStart.toFixed(2)} från start_pos`);
      assert.ok(fromFire >= CAMP_SAFE_RADIUS, `dekor ${fromFire.toFixed(2)} från elden`);
      if (item.collider) {
        assert.ok(hypot(item.collider.x, item.collider.y, fire.x, fire.y) >= CAMP_SAFE_RADIUS + item.collider.r - 1e-6);
        assert.ok(hypot(item.collider.x, item.collider.y, start.x, start.y) >= 3 + item.collider.r - 1e-6);
      }
      if (cx === 0 && cy === 0 && fromFire >= CAMP_SAFE_RADIUS && fromStart >= 3 && fromStart < 22) inMonsterRing += 1;
    }
  }
}
assert.ok(inMonsterRing > 0, 'dekor ska stå utanför gläntan men innanför monsterradien 22');

assert.equal(shouldPlaceDecorAt(1, start.x, start.y), false);
assert.equal(shouldPlaceDecorAt(1, start.x + 2.9, start.y), false);
assert.equal(shouldPlaceDecorAt(1, fire.x, fire.y), false);
assert.equal(shouldPlaceDecorAt(1, fire.x + CAMP_SAFE_RADIUS - 0.1, fire.y), false);
assert.equal(shouldPlaceDecorAt(4, fire.x, fire.y), shouldPlaceDecorAt(9, fire.x, fire.y));

const roadSpawn = shouldSpawnDecorAt;
{
  const sample = planForest(3, 2, 0);
  for (const item of sample) {
    assert.equal(roadSpawn(3, item.wx, item.wy), true, `dekor på vägmasken vid ${item.wx},${item.wy}`);
    if (item.collider) {
      assert.equal(
        isRoadMaskAtWorld(3, item.wx, item.wy, item.collider.r),
        false,
        `stor dekor-kollision når vägmasken vid ${item.wx},${item.wy}`,
      );
    }
  }
  let sawRoad = false;
  for (let gx = -80; gx <= 80 && !sawRoad; gx += 1) {
    for (let gy = -80; gy <= 80; gy += 1) {
      const wx = gx * 2 + 1;
      const wy = gy * 2 + 1;
      if (roadSpawn(3, wx, wy)) continue;
      sawRoad = true;
      assert.equal(shouldPlaceDecorAt(3, wx, wy), false, `vägruta ${wx},${wy} ska neka dekor`);
      break;
    }
  }
  assert.ok(sawRoad, 'shouldSpawnDecorAt finns men ingen vägträff i provrutan');
}

for (const city of PLAYABLE_CITIES) {
  const portal = bigWorldCityPortalWorld(city);
  assert.equal(shouldPlaceDecorAt(5, portal.x, portal.y), false, `${city} portal`);
  assert.equal(shouldPlaceDecorAt(5, portal.x + 5.5, portal.y), false, `${city} innanför portalradien`);
  const outside = shouldPlaceDecorAt(5, portal.x + 8, portal.y);
  if (typeof roadSpawn === 'function' && !roadSpawn(5, portal.x + 8, portal.y)) {
    assert.equal(outside, false);
  } else {
    assert.equal(outside, true, `${city} strax utanför portalradien`);
  }
  const owner = worldToChunk(portal.x, portal.y);
  const around = planDecorForChunk({
    worldSeed: 5,
    chunkSeed: chunkWorldSeed(5, owner.cx, owner.cy),
    cx: owner.cx,
    cy: owner.cy,
    biomeId: 'skog',
  });
  for (const item of around) {
    assert.ok(hypot(item.wx, item.wy, portal.x, portal.y) >= 6, `${city} dekor inne i portalradien`);
  }
}

const freeFar = shouldPlaceDecorAt(11, 400, -240);
if (typeof roadSpawn !== 'function' || roadSpawn(11, 400, -240)) {
  assert.equal(freeFar, true, 'öppen mark långt från läger och portaler');
}

const budgetItems = Array.from({ length: 2000 }, (_, index) => ({
  wx: index,
  wy: 0,
  layer: index % 3 === 0 ? ('stor' as const) : ('liten' as const),
}));
assert.equal(applyDecorBudget(budgetItems, 0, DECOR_SPRITE_CAP).length, 1500);
assert.equal(applyDecorBudget(budgetItems, 1400, 1500).length, 100);
assert.equal(applyDecorBudget(budgetItems, 1500, 1500).length, 0);
assert.equal(applyDecorBudget(budgetItems, 1800, 1500).length, 0);
const nearest = applyDecorBudget(
  [
    { wx: 0, wy: 0, layer: 'liten' as const },
    { wx: 80, wy: 0, layer: 'stor' as const },
    { wx: 30, wy: 0, layer: 'mellan' as const },
  ],
  0,
  2,
  { x: 0, y: 0 },
);
assert.deepEqual(
  nearest.map((item) => item.wx),
  [0, 30],
);

const collideList = planForest(1, 1, 1);
const zone = new Zone('forest', 'forest', 4000, 4000);
for (const item of collideList) {
  if (item.collider) zone.colliders.push({ x: item.collider.x, y: item.collider.y, r: item.collider.r });
}
const tree = collideList.find((item) => item.collider)?.collider;
assert.ok(tree, 'typisk skogschunk ska ha minst ett träd med kollision');
const inside = { x: tree.x + 0.15, y: tree.y };
const body = 0.5;
assert.ok(Math.hypot(inside.x - tree.x, inside.y - tree.y) < tree.r + body);
zone.collide(inside, body);
assert.ok(Math.hypot(inside.x - tree.x, inside.y - tree.y) >= tree.r + body - 0.05, 'zone.collide ska putta ut en punkt som står i trädet');

const campZone = new Zone('forest', 'forest', 4000, 4000);
for (const item of planForest(1, 0, 0)) {
  if (item.collider) campZone.colliders.push({ x: item.collider.x, y: item.collider.y, r: item.collider.r });
}
const atFire = { x: fire.x, y: fire.y };
const atStart = { x: start.x, y: start.y };
campZone.collide(atFire, body);
campZone.collide(atStart, body);
assert.equal(atFire.x, fire.x, 'elden ska vara fri från dekor-kollision');
assert.equal(atFire.y, fire.y);
assert.equal(atStart.x, start.x, 'start_pos ska vara fri från dekor-kollision');
assert.equal(atStart.y, start.y);

const startChunk = generateChunkWorldData(5, 1, 0, 0);
assert.equal(startChunk.safe, true);
const startDecor = planDecorForChunk({
  worldSeed: 5,
  chunkSeed: startChunk.chunkSeed,
  cx: 0,
  cy: 0,
  biomeId: startChunk.biomeId,
  pool: startChunk.decorLayers,
});
assert.ok(startDecor.length > 0, 'säker chunk ska ändå ha dekor utanför gläntan');

const warm = { worldSeed: 12345, chunkSeed: 99, cx: 2, cy: 0, biomeId: 'skog' };
planDecorForChunk(warm);
planDecorForChunk(warm);
const samples: number[] = [];
for (let i = 0; i < 5; i++) {
  const t0 = performance.now();
  planDecorForChunk(warm);
  samples.push(performance.now() - t0);
}
samples.sort((a, b) => a - b);
const median = samples[2] ?? 999;
assert.ok(median < 50, `planner median ${median.toFixed(1)} ms`);

console.log('decor-planner.test.mts: ok', { medianMs: Number(median.toFixed(2)), campRing: inMonsterRing });
