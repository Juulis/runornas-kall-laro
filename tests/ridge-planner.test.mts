/**
 * Klippryggar: pass längs vägarna, höjd norr om åsen, väg från lägret till städerna.
 * Kör: npx tsx tests/ridge-planner.test.mts
 *
 * Rutnätet är tile-rutnätet (2 världsenheter). Cell (gx, gy) har centrum
 * ((gx+0,5)*TILE_WORLD, (gy+0,5)*TILE_WORLD). Den är blockerad när ett åsblock
 * med r=1,6 överlappar hjälteradien 0,5 (samma som moveWithCollision i Game.ts).
 * Vägmaskens celler är alltid gångbara. Söket är ett ärligt 8-vägs-BFS, begränsat
 * till en korridor kring vägpolylinjerna så det inte sveper hela kartan.
 */
import assert from 'node:assert/strict';
import { DATA } from '../src/data';
import { TILE_WORLD } from '../src/render/Iso';
import { bigWorldCityPortalWorld } from '../src/world/bigWorld/bigWorldPortals';
import { worldToChunk } from '../src/world/bigWorld/bigWorldCoords';
import {
  CAMP_RIDGE_CLEAR,
  isRidgeHighlandTile,
  planRidgesForChunk,
  resetRidgePlannerCache,
  RIDGE_COLLIDER_R,
  RIDGE_HERO_RADIUS,
  RIDGE_PASS_WIDTH,
  ridgeBlocksWorld,
  shouldPlaceRidgesAtChunk,
  type PlannedRidgeBlock,
} from '../src/world/bigWorld/ridgePlanner';
import { isRoadMaskAtWorld, roadPolylineWorld } from '../src/world/bigWorld/roads';
import { campStartPos } from '../src/world/bigWorld/startskogenFootprint';
import { regionAt } from '../src/world/bigWorld/worldGenerator';
import { PLAYABLE_CITIES } from '../src/world/cityZones';

const IDS = new Set(['stenblock', 'stenblock_lav', 'stenhog']);
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const PASS_REACH = RIDGE_PASS_WIDTH / 2;
const LINK_DIST = 4.2;

const start = campStartPos();

interface Cell {
  gx: number;
  gy: number;
}

function cellKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

function cellOf(wx: number, wy: number): Cell {
  return { gx: Math.floor(wx / TILE_WORLD), gy: Math.floor(wy / TILE_WORLD) };
}

function cellCenter(cell: Cell): { x: number; y: number } {
  return { x: (cell.gx + 0.5) * TILE_WORLD, y: (cell.gy + 0.5) * TILE_WORLD };
}

let minCx = Infinity;
let maxCx = -Infinity;
let minCy = Infinity;
let maxCy = -Infinity;
for (const region of DATA.varldStor.regioner) {
  minCx = Math.min(minCx, region.chunk[0] - region.radie - 2);
  maxCx = Math.max(maxCx, region.chunk[0] + region.radie + 2);
  minCy = Math.min(minCy, region.chunk[1] - region.radie - 2);
  maxCy = Math.max(maxCy, region.chunk[1] + region.radie + 2);
}

const fjallChunks: [number, number][] = [];
const kustChunks: [number, number][] = [];
const gravChunks: [number, number][] = [];
for (let cx = minCx; cx <= maxCx; cx++) {
  for (let cy = minCy; cy <= maxCy; cy++) {
    if (!shouldPlaceRidgesAtChunk(cx, cy)) continue;
    const hit = regionAt(cx, cy);
    if (hit.id === 'gravasen' && hit.inside) gravChunks.push([cx, cy]);
    else if (hit.biom === 'fjall' || hit.biom === 'fjäll') fjallChunks.push([cx, cy]);
    else if (hit.biom === 'kust') kustChunks.push([cx, cy]);
  }
}
assert.ok(fjallChunks.length > 0, 'ska finnas fjällchunkar');
assert.ok(kustChunks.length > 0, 'ska finnas kustchunkar');
assert.ok(gravChunks.length > 0, 'ska finnas gravåschunkar');

const quiet: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 1],
  [1, 0],
  [0, 1],
  [2, 0],
  [0, 2],
  [2, 1],
  [1, 2],
  [2, 2],
];
for (const [cx, cy] of quiet) {
  assert.equal(shouldPlaceRidgesAtChunk(cx, cy), false, `chunk ${cx},${cy} är startskog eller läger`);
}

const sampleChunk = fjallChunks.find(([cx, cy]) => planRidgesForChunk({ worldSeed: 1, cx, cy }).length > 1);
assert.ok(sampleChunk, 'fjällen ska ha en chunk med en kedja');
const cold = planRidgesForChunk({ worldSeed: 1, cx: sampleChunk[0], cy: sampleChunk[1] }).map((block) => ({
  wx: block.wx,
  wy: block.wy,
  id: block.id,
  r: block.collider.r,
}));
resetRidgePlannerCache();
const recomputed = planRidgesForChunk({ worldSeed: 1, cx: sampleChunk[0], cy: sampleChunk[1] });
assert.deepEqual(
  recomputed.map((block) => ({ wx: block.wx, wy: block.wy, id: block.id, r: block.collider.r })),
  cold,
  'samma seed och chunk ska ge samma block efter omräkning',
);
assert.deepEqual(planRidgesForChunk({ worldSeed: 1, cx: sampleChunk[0], cy: sampleChunk[1] }), recomputed);

function blocksIn(worldSeed: number, chunks: readonly (readonly [number, number])[]): PlannedRidgeBlock[] {
  const out: PlannedRidgeBlock[] = [];
  for (const [cx, cy] of chunks) out.push(...planRidgesForChunk({ worldSeed, cx, cy }));
  return out;
}

function assertBlockShape(blocks: readonly PlannedRidgeBlock[], worldSeed: number): void {
  const seen = new Set<string>();
  for (const block of blocks) {
    assert.equal(block.collider.r, RIDGE_COLLIDER_R, 'kollisionsradie ska vara 1,6');
    assert.equal(block.collider.x, block.wx);
    assert.equal(block.collider.y, block.wy);
    assert.ok(IDS.has(block.id), `okänd sprite ${block.id}`);
    const owner = worldToChunk(block.wx, block.wy);
    const again = planRidgesForChunk({ worldSeed, cx: owner.cx, cy: owner.cy });
    assert.ok(
      again.some((b) => b.wx === block.wx && b.wy === block.wy),
      'blocket ska höra till sin chunk',
    );
    const key = `${block.wx.toFixed(2)},${block.wy.toFixed(2)}`;
    assert.equal(seen.has(key), false, `dubblett ${key}`);
    seen.add(key);
    const camp = Math.hypot(block.wx - start.x, block.wy - start.y);
    assert.ok(camp >= CAMP_RIDGE_CLEAR + RIDGE_COLLIDER_R, `ås inne i startcirkeln, avstånd ${camp.toFixed(2)}`);
  }
}

function assertLinked(worldSeed: number, blocks: readonly PlannedRidgeBlock[]): void {
  const cell = 8;
  const map = new Map<string, PlannedRidgeBlock[]>();
  const extra = new Map<string, PlannedRidgeBlock[]>();
  const put = (block: PlannedRidgeBlock): void => {
    const key = cellKey(Math.floor(block.wx / cell), Math.floor(block.wy / cell));
    const list = map.get(key);
    if (list) list.push(block);
    else map.set(key, [block]);
  };
  for (const block of blocks) put(block);
  const ensureNeighborChunks = (wx: number, wy: number): void => {
    const here = worldToChunk(wx, wy);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = here.cx + dx;
        const cy = here.cy + dy;
        const key = cellKey(cx, cy);
        if (extra.has(key)) continue;
        const planned = planRidgesForChunk({ worldSeed, cx, cy });
        extra.set(key, planned);
        for (const block of planned) put(block);
      }
    }
  };
  for (const block of blocks) {
    const ix = Math.floor(block.wx / cell);
    const iy = Math.floor(block.wy / cell);
    const look = (): boolean => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const list = map.get(cellKey(ix + dx, iy + dy));
          if (!list) continue;
          for (const other of list) {
            if (other === block) continue;
            if (Math.hypot(other.wx - block.wx, other.wy - block.wy) <= LINK_DIST) return true;
          }
        }
      }
      return false;
    };
    if (look()) continue;
    ensureNeighborChunks(block.wx, block.wy);
    assert.ok(look(), `ensam sten vid ${block.wx.toFixed(1)},${block.wy.toFixed(1)}`);
  }
}

function samplePolyline(pts: readonly { x: number; y: number }[], step: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const first = pts[0];
  if (!first) return out;
  out.push(first);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / step));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

function assertPass(worldSeed: number): void {
  for (const road of DATA.varldStor.vagar) {
    const samples = samplePolyline(roadPolylineWorld(road, worldSeed), 1);
    for (const p of samples) {
      assert.equal(
        ridgeBlocksWorld(worldSeed, p.x, p.y, PASS_REACH),
        false,
        `seed ${worldSeed} ${road.id} blockerar passet vid ${p.x.toFixed(1)},${p.y.toFixed(1)}`,
      );
    }
  }
}

function addDisk(into: Set<string>, wx: number, wy: number, radius: number): void {
  const gx0 = Math.floor((wx - radius) / TILE_WORLD);
  const gx1 = Math.floor((wx + radius) / TILE_WORLD);
  const gy0 = Math.floor((wy - radius) / TILE_WORLD);
  const gy1 = Math.floor((wy + radius) / TILE_WORLD);
  const r2 = radius * radius;
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const c = cellCenter({ gx, gy });
      const dx = c.x - wx;
      const dy = c.y - wy;
      if (dx * dx + dy * dy <= r2) into.add(cellKey(gx, gy));
    }
  }
}

function corridorFor(worldSeed: number): Set<string> {
  const cells = new Set<string>();
  addDisk(cells, start.x, start.y, 28);
  for (const road of DATA.varldStor.vagar) {
    const poly = roadPolylineWorld(road, worldSeed);
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1];
      const b = poly[i];
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.ceil(len / 4));
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        addDisk(cells, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 8);
      }
    }
  }
  for (const city of PLAYABLE_CITIES) {
    const portal = bigWorldCityPortalWorld(city);
    addDisk(cells, portal.x, portal.y, 18);
  }
  return cells;
}

const NBR: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function reaches(worldSeed: number, corridor: Set<string>, goal: { x: number; y: number }): boolean {
  const blocked = new Map<string, boolean>();
  const open = (gx: number, gy: number): boolean => {
    const key = cellKey(gx, gy);
    const hit = blocked.get(key);
    if (hit !== undefined) return !hit;
    const c = cellCenter({ gx, gy });
    const isBlocked = !isRoadMaskAtWorld(worldSeed, c.x, c.y) && ridgeBlocksWorld(worldSeed, c.x, c.y, RIDGE_HERO_RADIUS);
    blocked.set(key, isBlocked);
    return !isBlocked;
  };
  const goalCell = cellOf(goal.x, goal.y);
  const startCell = cellOf(start.x, start.y);
  const queue: Cell[] = [startCell];
  const seen = new Set<string>([cellKey(startCell.gx, startCell.gy)]);
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi];
    qi += 1;
    if (!cur) continue;
    if (cur.gx === goalCell.gx && cur.gy === goalCell.gy) return true;
    for (const [dx, dy] of NBR) {
      const gx = cur.gx + dx;
      const gy = cur.gy + dy;
      const key = cellKey(gx, gy);
      if (seen.has(key) || !corridor.has(key)) continue;
      seen.add(key);
      if (!open(gx, gy)) continue;
      queue.push({ gx, gy });
    }
  }
  return false;
}

function assertHighland(worldSeed: number, blocks: readonly PlannedRidgeBlock[]): void {
  const far = cellOf(start.x, start.y);
  assert.equal(isRidgeHighlandTile(worldSeed, far.gx, far.gy), false, 'höjd ska vara falsk vid start_pos');
  assert.equal(isRidgeHighlandTile(worldSeed, far.gx - 40, far.gy - 40), false, 'höjd ska vara falsk långt från åsar');
  let found = false;
  for (const block of blocks) {
    const gx = Math.floor(block.wx / TILE_WORLD);
    const gy0 = Math.floor(block.wy / TILE_WORLD);
    for (let gy = gy0; gy >= gy0 - 8; gy--) {
      if (!isRidgeHighlandTile(worldSeed, gx, gy)) continue;
      found = true;
      break;
    }
    if (found) break;
  }
  assert.ok(found, `seed ${worldSeed} saknar höjdruta norr om en ås`);
}

const t0 = performance.now();
for (const worldSeed of SEEDS) {
  for (const [cx, cy] of quiet) {
    assert.equal(planRidgesForChunk({ worldSeed, cx, cy }).length, 0, `ås i startskog ${cx},${cy} seed ${worldSeed}`);
  }
  const fjall = blocksIn(worldSeed, fjallChunks);
  const kust = blocksIn(worldSeed, kustChunks);
  const grav = blocksIn(worldSeed, gravChunks);
  assert.ok(fjall.length > 0, `seed ${worldSeed} saknar ås i fjäll`);
  assert.ok(kust.length > 0, `seed ${worldSeed} saknar ås på kusten`);
  assert.ok(grav.length > 0, `seed ${worldSeed} saknar ås i Gravåsen`);
  const all = [...fjall, ...kust, ...grav];
  assertBlockShape(all, worldSeed);
  assertLinked(worldSeed, all);
  if (fjallChunks[0]) {
    const [cx, cy] = fjallChunks[0];
    const first = planRidgesForChunk({ worldSeed, cx, cy });
    const second = planRidgesForChunk({ worldSeed, cx, cy });
    assert.deepEqual(second, first, 'samma seed och chunk ska ge samma block');
  }
  assertHighland(worldSeed, all);
  assertPass(worldSeed);
  const corridor = corridorFor(worldSeed);
  for (const city of PLAYABLE_CITIES) {
    const portal = bigWorldCityPortalWorld(city);
    assert.ok(reaches(worldSeed, corridor, portal), `seed ${worldSeed} hittar ingen väg till ${city}`);
  }
}
const ms = performance.now() - t0;
console.log('ridge-planner.test.mts: ok', { ms: Math.round(ms), seeds: SEEDS.length, roads: DATA.varldStor.vagar.length });
