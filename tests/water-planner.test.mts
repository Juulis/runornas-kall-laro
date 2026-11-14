/**
 * Tjärnar: form, spärr, spawn och väg till städerna.
 * Kör: npx tsx tests/water-planner.test.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA } from '../src/data';
import { canonicalBiomeId } from '../src/render/biomeAssetGroups';
import { TILE_WORLD } from '../src/render/Iso';
import { PLAYABLE_CITIES } from '../src/world/cityZones';
import { chunkSpawnToWorld, chunkTileCount, worldToChunk } from '../src/world/bigWorld/bigWorldCoords';
import { bigWorldCityPortalWorld } from '../src/world/bigWorld/bigWorldPortals';
import { campMonsterSpecs } from '../src/world/bigWorld/campMonsterField';
import { worldTileIndex } from '../src/world/bigWorld/groundTiles';
import { isRoadMaskAtWorld, roadIsDrawn, roadPolylineWorld } from '../src/world/bigWorld/roads';
import { campStartPos } from '../src/world/bigWorld/startskogenFootprint';
import { biomeIdAtChunk, effectiveBiomeAtTile } from '../src/world/bigWorld/transitionResolver';
import {
  applyChunkWaterBlocked,
  CAMP_WATER_CLEAR,
  distToWaterTile,
  isShoreTile,
  isWaterAtWorld,
  isWaterBlockedTile,
  isWaterTile,
  PORTAL_WATER_CLEAR,
  WATER_SHIMMER_OMEGA,
  WATER_TILE_IDS,
  waterShimmerAlpha,
  waterTileIdAt,
} from '../src/world/bigWorld/waterPlanner';
import { generateChunkWorldData, spawnTileAllowed } from '../src/world/bigWorld/worldGenerator';
import { Zone } from '../src/world/Zone';

const TRASK_CHUNK = { cx: -4, cy: 1 };
const KUST_CHUNK = { cx: -7, cy: 3 };
const SKOG_CHUNK = { cx: 1, cy: 1 };
const N4: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const N8: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const CITY_ROADS = new Set(['vag_ostra', 'vag_norra', 'vag_vastra', 'askvagen']);

interface WaterCell {
  gx: number;
  gy: number;
  wx: number;
  wy: number;
}

function keyOf(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

function parseKey(key: string): [number, number] {
  const comma = key.indexOf(',');
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}

function watersInChunk(worldSeed: number, cx: number, cy: number): WaterCell[] {
  const tiles = chunkTileCount();
  const origin = worldTileIndex(cx, cy, 0, 0);
  const out: WaterCell[] = [];
  for (let ti = 0; ti < tiles; ti++) {
    const gx = origin.gx + ti;
    for (let tj = 0; tj < tiles; tj++) {
      const gy = origin.gy + tj;
      if (!isWaterTile(worldSeed, gx, gy)) continue;
      out.push({
        gx,
        gy,
        wx: gx * TILE_WORLD + TILE_WORLD * 0.5,
        wy: gy * TILE_WORLD + TILE_WORLD * 0.5,
      });
    }
  }
  return out;
}

/** Hela 4-komponenten, även rutor utanför chunken som sökningen startade i. */
function componentSizes(worldSeed: number, cx: number, cy: number): number[] {
  const tiles = chunkTileCount();
  const origin = worldTileIndex(cx, cy, 0, 0);
  const seen = new Set<string>();
  const sizes: number[] = [];
  for (let ti = 0; ti < tiles; ti++) {
    const gx0 = origin.gx + ti;
    for (let tj = 0; tj < tiles; tj++) {
      const gy0 = origin.gy + tj;
      const start = keyOf(gx0, gy0);
      if (seen.has(start) || !isWaterTile(worldSeed, gx0, gy0)) continue;
      const queue: [number, number][] = [[gx0, gy0]];
      seen.add(start);
      let size = 0;
      let qi = 0;
      while (qi < queue.length) {
        const cell = queue[qi];
        qi += 1;
        if (!cell) break;
        size += 1;
        const [gx, gy] = cell;
        for (const [dx, dy] of N4) {
          const nx = gx + dx;
          const ny = gy + dy;
          const nk = keyOf(nx, ny);
          if (seen.has(nk) || !isWaterTile(worldSeed, nx, ny)) continue;
          seen.add(nk);
          queue.push([nx, ny]);
        }
      }
      sizes.push(size);
    }
  }
  return sizes;
}

function circleClearsBlocked(zone: Zone, px: number, py: number, r: number): boolean {
  const gx0 = Math.floor((px - r) / TILE_WORLD);
  const gx1 = Math.floor((px + r) / TILE_WORLD);
  const gy0 = Math.floor((py - r) / TILE_WORLD);
  const gy1 = Math.floor((py + r) / TILE_WORLD);
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const midX = gx * TILE_WORLD + TILE_WORLD * 0.5;
      const midY = gy * TILE_WORLD + TILE_WORLD * 0.5;
      if (!zone.blocked(midX, midY)) continue;
      if (distToWaterTile(px, py, gx, gy) < r - 1e-4) return false;
    }
  }
  return true;
}

const start = campStartPos();
const portals = PLAYABLE_CITIES.map((city) => bigWorldCityPortalWorld(city));

const a0 = waterShimmerAlpha(0.35);
assert.equal(waterShimmerAlpha(0.35), a0, 'samma tid ska ge samma alfa');
assert.notEqual(waterShimmerAlpha(0), waterShimmerAlpha(0.7), 'glimten ska röra sig');
const period = (Math.PI * 2) / WATER_SHIMMER_OMEGA;
assert.ok(Math.abs(waterShimmerAlpha(0.2) - waterShimmerAlpha(0.2 + period)) < 1e-9, 'glimten är periodisk');
for (let i = 0; i < 24; i++) {
  const alpha = waterShimmerAlpha(i * 0.37);
  assert.ok(alpha > 0 && alpha <= 1, `alfa ${alpha} ligger utanför (0, 1]`);
}

const tilesN = chunkTileCount();
for (const seed of [1, 4, 11]) {
  for (let ti = 0; ti < tilesN; ti += 8) {
    const fromWest = worldTileIndex(-4, 1, tilesN, ti);
    const fromEast = worldTileIndex(-3, 1, 0, ti);
    assert.deepEqual(fromWest, fromEast, 'sömmen är samma världsruta');
    assert.equal(isWaterTile(seed, fromWest.gx, fromWest.gy), isWaterTile(seed, fromEast.gx, fromEast.gy));
    assert.equal(waterTileIdAt(seed, fromWest.gx, fromWest.gy), waterTileIdAt(seed, fromEast.gx, fromEast.gy));
    assert.equal(isShoreTile(seed, fromWest.gx, fromWest.gy), isShoreTile(seed, fromEast.gx, fromEast.gy));
    assert.equal(isWaterTile(seed, fromWest.gx, fromWest.gy), isWaterTile(seed, fromWest.gx, fromWest.gy));
  }
}

let sawTrask = false;
let sawKust = false;
let sawCrossChunk = false;
const planT0 = performance.now();
watersInChunk(3, TRASK_CHUNK.cx, TRASK_CHUNK.cy);
const planMs = performance.now() - planT0;
console.log(`vattenplan en träskchunk: ${planMs.toFixed(1)} ms`);

for (const seed of [1, 2, 3, 5, 8]) {
  const traskSizes = componentSizes(seed, TRASK_CHUNK.cx, TRASK_CHUNK.cy);
  const kustSizes = componentSizes(seed, KUST_CHUNK.cx, KUST_CHUNK.cy);
  if (traskSizes.length > 0) sawTrask = true;
  if (kustSizes.length > 0) sawKust = true;
  for (const size of [...traskSizes, ...kustSizes]) {
    assert.ok(size >= 4 && size <= 14, `komponent ${size} rutor, väntat 4–14 (seed ${seed})`);
  }
  for (const cell of [...watersInChunk(seed, TRASK_CHUNK.cx, TRASK_CHUNK.cy), ...watersInChunk(seed, KUST_CHUNK.cx, KUST_CHUNK.cy)]) {
    const biome = canonicalBiomeId(effectiveBiomeAtTile(seed, cell.gx, cell.gy));
    assert.ok(biome === 'trask' || biome === 'kust', `vatten i biom ${biome}`);
    if (biome === 'trask') sawTrask = true;
    if (biome === 'kust') sawKust = true;
    const tileId = waterTileIdAt(seed, cell.gx, cell.gy);
    assert.ok(tileId === 'myr_gol_1' || tileId === 'myr_gol_2', `yta ${tileId}`);
    assert.equal(isWaterBlockedTile(seed, cell.gx, cell.gy), true);
    assert.equal(isShoreTile(seed, cell.gx, cell.gy), false);
    let wetNeighbor = false;
    for (const [dx, dy] of N4) {
      const nx = cell.gx + dx;
      const ny = cell.gy + dy;
      if (!isWaterTile(seed, nx, ny)) {
        assert.equal(isShoreTile(seed, nx, ny), true, 'torr 4-granne är strand');
        const edge = worldToChunk(nx * TILE_WORLD + 1, ny * TILE_WORLD + 1);
        const own = worldToChunk(cell.wx, cell.wy);
        if (edge.cx !== own.cx || edge.cy !== own.cy) sawCrossChunk = true;
      } else {
        wetNeighbor = true;
        const other = worldToChunk(nx * TILE_WORLD + 1, ny * TILE_WORLD + 1);
        const own = worldToChunk(cell.wx, cell.wy);
        if (other.cx !== own.cx || other.cy !== own.cy) sawCrossChunk = true;
      }
    }
    assert.equal(wetNeighbor, true, 'ingen isolerad vattenruta');
  }
  const forest = watersInChunk(seed, SKOG_CHUNK.cx, SKOG_CHUNK.cy);
  assert.equal(forest.length, 0, `ren skog [${SKOG_CHUNK.cx},${SKOG_CHUNK.cy}] seed ${seed} har vatten`);
  assert.equal(canonicalBiomeId(biomeIdAtChunk(SKOG_CHUNK.cx, SKOG_CHUNK.cy)), 'skog');
}
assert.ok(sawTrask, 'minst en tjärn i träsk');
assert.ok(sawKust, 'minst en tjärn i kust');
assert.equal(sawCrossChunk, true, 'minst en tjärn korsar en chunkgräns och räknas som en komponent');

for (let seed = 1; seed <= 20; seed++) {
  const found = [...watersInChunk(seed, TRASK_CHUNK.cx, TRASK_CHUNK.cy), ...watersInChunk(seed, KUST_CHUNK.cx, KUST_CHUNK.cy)];
  const zone = new Zone('forest', 'vatten', 64, 64);
  const wetTrask = applyChunkWaterBlocked(zone, seed, TRASK_CHUNK.cx, TRASK_CHUNK.cy);
  const wetKust = applyChunkWaterBlocked(zone, seed, KUST_CHUNK.cx, KUST_CHUNK.cy);
  assert.equal(wetTrask, watersInChunk(seed, TRASK_CHUNK.cx, TRASK_CHUNK.cy).length > 0);
  assert.equal(wetKust, watersInChunk(seed, KUST_CHUNK.cx, KUST_CHUNK.cy).length > 0);
  for (const cell of found) {
    assert.equal(isRoadMaskAtWorld(seed, cell.wx, cell.wy), false, `vatten på väg ${cell.gx},${cell.gy}`);
    assert.ok(distToWaterTile(start.x, start.y, cell.gx, cell.gy) >= CAMP_WATER_CLEAR, 'vatten inom 60 från start');
    for (const portal of portals) {
      assert.ok(
        distToWaterTile(portal.x, portal.y, cell.gx, cell.gy) >= PORTAL_WATER_CLEAR,
        `vatten inom ${PORTAL_WATER_CLEAR} från portal`,
      );
    }
    assert.equal(zone.blocked(cell.wx, cell.wy), true);
    assert.equal(isWaterAtWorld(seed, cell.wx, cell.wy), true);
  }
  const sgx = Math.floor(start.x / TILE_WORLD);
  const sgy = Math.floor(start.y / TILE_WORLD);
  const startRad = Math.ceil(CAMP_WATER_CLEAR / TILE_WORLD);
  for (let dy = -startRad; dy <= startRad; dy++) {
    for (let dx = -startRad; dx <= startRad; dx++) {
      if (distToWaterTile(start.x, start.y, sgx + dx, sgy + dy) >= CAMP_WATER_CLEAR) continue;
      assert.equal(isWaterTile(seed, sgx + dx, sgy + dy), false, `startnära vatten seed ${seed}`);
    }
  }
  for (const portal of portals) {
    const pgx = Math.floor(portal.x / TILE_WORLD);
    const pgy = Math.floor(portal.y / TILE_WORLD);
    const rad = Math.ceil(PORTAL_WATER_CLEAR / TILE_WORLD) + 1;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (distToWaterTile(portal.x, portal.y, pgx + dx, pgy + dy) >= PORTAL_WATER_CLEAR) continue;
        assert.equal(isWaterTile(seed, pgx + dx, pgy + dy), false, `portalvatten seed ${seed}`);
      }
    }
  }
  const sample = found[0];
  if (sample) {
    const hero = { x: sample.wx, y: sample.wy };
    zone.collide(hero, 0.5);
    assert.equal(zone.blocked(hero.x, hero.y), false, 'radie 0,5 ska puttas ur vattnet');
    assert.equal(circleClearsBlocked(zone, hero.x, hero.y, 0.5), true);
    let dry: { gx: number; gy: number } | null = null;
    for (const [dx, dy] of N4) {
      if (!isWaterTile(seed, sample.gx + dx, sample.gy + dy)) {
        dry = { gx: sample.gx + dx, gy: sample.gy + dy };
        break;
      }
    }
    if (dry) {
      const edgeX = dry.gx < sample.gx ? sample.gx * TILE_WORLD : (sample.gx + 1) * TILE_WORLD;
      const stand = {
        x: dry.gx === sample.gx ? sample.wx : edgeX + Math.sign(dry.gx - sample.gx) * 0.2,
        y: dry.gy === sample.gy ? sample.wy : sample.wy,
      };
      if (dry.gy !== sample.gy) {
        const edgeY = dry.gy < sample.gy ? sample.gy * TILE_WORLD : (sample.gy + 1) * TILE_WORLD;
        stand.y = edgeY + Math.sign(dry.gy - sample.gy) * 0.2;
        stand.x = sample.wx;
      }
      zone.collide(stand, 0.5);
      assert.equal(circleClearsBlocked(zone, stand.x, stand.y, 0.5), true, 'steg in från stranden ska hamna utanför');
    }
  }
  zone.clearBlockedChunk(TRASK_CHUNK.cx, TRASK_CHUNK.cy);
  for (const cell of watersInChunk(seed, TRASK_CHUNK.cx, TRASK_CHUNK.cy)) {
    assert.equal(zone.blocked(cell.wx, cell.wy), false, 'urlastad chunk läcker spärr');
  }
  if (wetKust) {
    const kept = watersInChunk(seed, KUST_CHUNK.cx, KUST_CHUNK.cy)[0];
    if (kept) assert.equal(zone.blocked(kept.wx, kept.wy), true, 'grannchunkens spärr ska vara kvar');
  }
}

const spawnChunks: readonly (readonly [number, number])[] = [
  [TRASK_CHUNK.cx, TRASK_CHUNK.cy],
  [KUST_CHUNK.cx, KUST_CHUNK.cy],
  [SKOG_CHUNK.cx, SKOG_CHUNK.cy],
  [0, 0],
  [8, 2],
];
for (let seed = 1; seed <= 6; seed++) {
  for (const spec of campMonsterSpecs(seed, seed)) {
    assert.equal(isWaterAtWorld(seed, spec.pos[0], spec.pos[1]), false, `${spec.uid} står i vatten`);
    assert.equal(spawnTileAllowed(seed, spec.pos[0], spec.pos[1]), true);
  }
  for (const [cx, cy] of spawnChunks) {
    const data = generateChunkWorldData(seed, seed + 3, cx, cy);
    for (const spawn of data.spawns) {
      const world = chunkSpawnToWorld(cx, cy, spawn.localX, spawn.localY);
      assert.equal(isWaterTile(seed, Math.floor(world.x / TILE_WORLD), Math.floor(world.y / TILE_WORLD)), false, spawn.uid);
      assert.equal(spawnTileAllowed(seed, world.x, world.y), true, spawn.uid);
    }
  }
}
const pond = watersInChunk(1, TRASK_CHUNK.cx, TRASK_CHUNK.cy)[0];
assert.ok(pond, 'behöver en känd tjärn');
if (pond) {
  assert.equal(spawnTileAllowed(1, pond.wx, pond.wy), false, 'en punkt i tjärnen ska avvisas');
  assert.equal(isWaterBlockedTile(1, pond.gx, pond.gy), true);
}
assert.equal(spawnTileAllowed(1, start.x, start.y), true);

function cityWalkable(worldSeed: number): Set<string> {
  const walkable = new Set<string>();
  for (const road of DATA.varldStor.vagar) {
    if (!CITY_ROADS.has(road.id) || !roadIsDrawn(road.typ)) continue;
    const poly = roadPolylineWorld(road, worldSeed);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[i + 1] ?? a;
      if (!a || !b) continue;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(dist / TILE_WORLD));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const gx = Math.floor(x / TILE_WORLD);
        const gy = Math.floor(y / TILE_WORLD);
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const wx = (gx + dx) * TILE_WORLD + TILE_WORLD * 0.5;
            const wy = (gy + dy) * TILE_WORLD + TILE_WORLD * 0.5;
            if (!isRoadMaskAtWorld(worldSeed, wx, wy)) continue;
            walkable.add(keyOf(gx + dx, gy + dy));
          }
        }
      }
    }
  }
  const sgx = Math.floor(start.x / TILE_WORLD);
  const sgy = Math.floor(start.y / TILE_WORLD);
  const rad = Math.ceil(36 / TILE_WORLD);
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      if (dx * dx + dy * dy > rad * rad) continue;
      if (isWaterTile(worldSeed, sgx + dx, sgy + dy)) continue;
      walkable.add(keyOf(sgx + dx, sgy + dy));
    }
  }
  return walkable;
}

function reaches(walkable: ReadonlySet<string>, from: string, goals: ReadonlySet<string>): boolean {
  if (goals.has(from)) return true;
  if (!walkable.has(from)) return false;
  const seen = new Set<string>([from]);
  const queue = [from];
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi];
    qi += 1;
    if (!cur) break;
    const [gx, gy] = parseKey(cur);
    for (const [dx, dy] of N8) {
      const nk = keyOf(gx + dx, gy + dy);
      if (!walkable.has(nk) || seen.has(nk)) continue;
      if (goals.has(nk)) return true;
      seen.add(nk);
      queue.push(nk);
    }
  }
  return false;
}

for (let seed = 1; seed <= 20; seed++) {
  const walkable = cityWalkable(seed);
  const from = keyOf(Math.floor(start.x / TILE_WORLD), Math.floor(start.y / TILE_WORLD));
  assert.equal(walkable.has(from), true, `start ska vara gångbar, seed ${seed}`);
  for (const city of PLAYABLE_CITIES) {
    const portal = bigWorldCityPortalWorld(city);
    const pgx = Math.floor(portal.x / TILE_WORLD);
    const pgy = Math.floor(portal.y / TILE_WORLD);
    const goals = new Set<string>();
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nk = keyOf(pgx + dx, pgy + dy);
        if (walkable.has(nk)) goals.add(nk);
      }
    }
    assert.ok(goals.size > 0, `${city} saknar vägmask i korridoren, seed ${seed}`);
    assert.equal(reaches(walkable, from, goals), true, `${city} går inte att nå från start, seed ${seed}`);
  }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const groundSrc = readFileSync(join(root, 'src/world/bigWorld/BigWorldStreamGround.ts'), 'utf8');
assert.match(groundSrc, /clearBlockedChunk/);
assert.match(groundSrc, /applyChunkWaterBlocked/);
assert.match(groundSrc, /waterShimmerAlpha/);
assert.match(groundSrc, /WATER_TILE_IDS/);
assert.match(groundSrc, /Laddar vattnet/);
assert.equal(groundSrc.includes('nackros'), false);
assert.deepEqual([...WATER_TILE_IDS], ['myr_gol_1', 'myr_gol_2']);

console.log('water-planner.test.mts: ok');
