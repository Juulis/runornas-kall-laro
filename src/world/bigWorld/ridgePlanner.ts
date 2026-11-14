import { DATA } from '../../data';
import { Rng } from '../../core/Rng';
import { TILE_WORLD } from '../../render/Iso';
import { chunkMinWorld, chunkWorldSpan, worldToChunk } from './bigWorldCoords';
import { registerDecorKeepout, roadPolylineWorld } from './roads';
import { campStartPos } from './startskogenFootprint';
import { regionAt } from './worldGenerator';

/**
 * Klippryggar: sammanhängande kedjor av stenblock, inte enstaka slumpstenar.
 * Kedjan följer en höjdkurva i ett eget värdebrus (vinkelrät mot gradienten)
 * och svänger mot högre brus. Varje block hör till chunken där centrum ligger,
 * så samma formel ger samma block oavsett vilken chunk som frågar.
 *
 * Ovansidan är norr, mot minskande världs-y. Rutor där är mörkare bergsväg.
 * Ingen Pixi-import.
 */

export const RIDGE_COLLIDER_R = 1.6;
/** Fri gång tvärs vägen, världsenheter. */
export const RIDGE_PASS_WIDTH = 5;
/** Inga åsar med centrum eller cirkel inne i den här radien kring start_pos. */
export const CAMP_RIDGE_CLEAR = 60;
/**
 * Hjälteradien i Game.ts (moveWithCollision). En rutnätscell blockeras när
 * åsens cirkel överlappar den här radien kring cellens mitt.
 */
export const RIDGE_HERO_RADIUS = 0.5;

export interface PlannedRidgeBlock {
  wx: number;
  wy: number;
  id: 'stenblock' | 'stenblock_lav' | 'stenhog';
  collider: { x: number; y: number; r: number };
}

const SPINE_GRID = 96;
const STEP = 3.6;
/** (n-1)*STEP ligger i 21,6–57,6, alltså kedjor på 20–60. */
const SPAN_MIN = 6;
const SPAN_EXTRA = 11;
const ROAD_BUCKET = 64;
const BLOCK_CELL = 8;
/** Lite marginal så flyttalsbrus inte äter upp passet på 5. */
const PASS_PAD = 0.05;
const CAMP_PAD = 0.05;
/** Norr om blocket, i världsenheter. Sidled är längs x. */
const HIGHLAND_NEAR = 1.6;
const HIGHLAND_FAR = 10;
const HIGHLAND_LATERAL = 3.4;
const CLEARANCE = RIDGE_PASS_WIDTH / 2 + RIDGE_COLLIDER_R + PASS_PAD;

const NO_BLOCKS: PlannedRidgeBlock[] = [];
const eligibleCache = new Map<string, boolean>();

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

interface Step {
  x: number;
  y: number;
  keep: boolean;
  index: number;
}

interface SeedStore {
  chunks: Map<string, PlannedRidgeBlock[]>;
  cells: Map<string, PlannedRidgeBlock[]>;
  /** Hela kedjans behållna block, innan chunk-filter. Räknas en gång per seed. */
  spines: Map<string, PlannedRidgeBlock[]>;
  roads: Map<string, Seg[]> | null;
}

const stores = new Map<number, SeedStore>();

function storeFor(worldSeed: number): SeedStore {
  const hit = stores.get(worldSeed);
  if (hit) return hit;
  const made: SeedStore = { chunks: new Map(), cells: new Map(), spines: new Map(), roads: null };
  stores.set(worldSeed, made);
  return made;
}

function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

function lat(worldSeed: number, ix: number, iy: number): number {
  return Rng.hash(worldSeed, 'as-brus', ix, iy) / 4294967296;
}

/** Värdebrus i världsenheter. Oberoende av markens bruscache. */
function ridgeNoise(worldSeed: number, x: number, y: number): number {
  const scale = 72;
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const v00 = lat(worldSeed, x0, y0);
  const v10 = lat(worldSeed, x0 + 1, y0);
  const v01 = lat(worldSeed, x0, y0 + 1);
  const v11 = lat(worldSeed, x0 + 1, y0 + 1);
  return v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy;
}

function chunkFullyInsideCamp(cx: number, cy: number): boolean {
  const min = chunkMinWorld(cx, cy);
  const span = chunkWorldSpan();
  const start = campStartPos();
  const r2 = CAMP_RIDGE_CLEAR * CAMP_RIDGE_CLEAR;
  const corners: readonly (readonly [number, number])[] = [
    [min.x, min.y],
    [min.x + span, min.y],
    [min.x, min.y + span],
    [min.x + span, min.y + span],
  ];
  for (const [x, y] of corners) {
    const dx = x - start.x;
    const dy = y - start.y;
    if (dx * dx + dy * dy > r2) return false;
  }
  return true;
}

/**
 * Sant i fjäll, på kusten, eller inne i Gravåsen.
 * Helt inne i startcirkeln (radie 60): falskt. En chunk som bara delvis
 * ligger i cirkeln är ändå sann; blocken inne i cirkeln släpps inte ut.
 */
export function shouldPlaceRidgesAtChunk(cx: number, cy: number): boolean {
  const key = chunkKey(cx, cy);
  const cached = eligibleCache.get(key);
  if (cached !== undefined) return cached;
  const hit = regionAt(cx, cy);
  const biom = hit.biom.trim().toLowerCase();
  const eligible = biom === 'fjall' || biom === 'fjäll' || biom === 'kust' || (hit.id === 'gravasen' && hit.inside);
  const ok = eligible && !chunkFullyInsideCamp(cx, cy);
  eligibleCache.set(key, ok);
  return ok;
}

function distPointToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const x = ax + dx * t;
  const y = ay + dy * t;
  return Math.hypot(px - x, py - y);
}

function addSeg(buckets: Map<string, Seg[]>, a: { x: number; y: number }, b: { x: number; y: number }): void {
  const seg: Seg = { ax: a.x, ay: a.y, bx: b.x, by: b.y };
  const ix0 = Math.floor(Math.min(a.x, b.x) / ROAD_BUCKET);
  const ix1 = Math.floor(Math.max(a.x, b.x) / ROAD_BUCKET);
  const iy0 = Math.floor(Math.min(a.y, b.y) / ROAD_BUCKET);
  const iy1 = Math.floor(Math.max(a.y, b.y) / ROAD_BUCKET);
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iy = iy0; iy <= iy1; iy++) {
      const key = chunkKey(ix, iy);
      const list = buckets.get(key);
      if (list) list.push(seg);
      else buckets.set(key, [seg]);
    }
  }
}

/** Alla vägpolylinjer, även trappa och schakt som inte ritas. */
function roadBuckets(worldSeed: number): Map<string, Seg[]> {
  const store = storeFor(worldSeed);
  if (store.roads) return store.roads;
  const buckets = new Map<string, Seg[]>();
  for (const road of DATA.varldStor.vagar) {
    const pts = roadPolylineWorld(road, worldSeed);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a || !b) continue;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
      addSeg(buckets, a, b);
    }
  }
  store.roads = buckets;
  return buckets;
}

/**
 * Avstånd till närmaste punkt på någon vägpolylinje.
 * Räcker med grannhinkarna: passets gräns (drygt 4) är mycket mindre än hinken.
 */
function distToRoads(worldSeed: number, x: number, y: number): number {
  const buckets = roadBuckets(worldSeed);
  const ix = Math.floor(x / ROAD_BUCKET);
  const iy = Math.floor(y / ROAD_BUCKET);
  let best = Number.POSITIVE_INFINITY;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const list = buckets.get(chunkKey(ix + dx, iy + dy));
      if (!list) continue;
      for (const seg of list) {
        const d = distPointToSeg(x, y, seg.ax, seg.ay, seg.bx, seg.by);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

function circleInsideEligible(x: number, y: number): boolean {
  const r = RIDGE_COLLIDER_R;
  const samples: readonly (readonly [number, number])[] = [
    [x, y],
    [x + r, y],
    [x - r, y],
    [x, y + r],
    [x, y - r],
  ];
  for (const [sx, sy] of samples) {
    const c = worldToChunk(sx, sy);
    if (!shouldPlaceRidgesAtChunk(c.cx, c.cy)) return false;
  }
  return true;
}

function pointKeep(worldSeed: number, x: number, y: number): boolean {
  if (!circleInsideEligible(x, y)) return false;
  const start = campStartPos();
  if (Math.hypot(x - start.x, y - start.y) < CAMP_RIDGE_CLEAR + RIDGE_COLLIDER_R + CAMP_PAD) return false;
  if (distToRoads(worldSeed, x, y) < CLEARANCE) return false;
  return true;
}

function initialAngle(worldSeed: number, ix: number, iy: number): number {
  const x = ix * SPINE_GRID;
  const y = iy * SPINE_GRID;
  const e = 8;
  const dx = ridgeNoise(worldSeed, x + e, y) - ridgeNoise(worldSeed, x - e, y);
  const dy = ridgeNoise(worldSeed, x, y + e) - ridgeNoise(worldSeed, x, y - e);
  if (dx * dx + dy * dy < 1e-8) return ((Rng.hash(worldSeed, 'as-rikt', ix, iy) % 360) * Math.PI) / 180;
  const along = Math.atan2(-dx, dy);
  if ((Rng.hash(worldSeed, 'as-vand', ix, iy) & 1) === 0) return along;
  return along + Math.PI;
}

function steer(worldSeed: number, x: number, y: number, ang: number): number {
  let bestA = ang;
  let bestS = -Infinity;
  for (const delta of [-0.5, 0, 0.5]) {
    const a = ang + delta;
    const nx = x + Math.cos(a) * STEP;
    const ny = y + Math.sin(a) * STEP;
    let score = ridgeNoise(worldSeed, nx, ny);
    if (delta === 0) score += 0.06;
    if (score > bestS) {
      bestS = score;
      bestA = a;
    }
  }
  return bestA;
}

function spineActive(worldSeed: number, ix: number, iy: number): boolean {
  const origin = worldToChunk(ix * SPINE_GRID, iy * SPINE_GRID);
  if (!shouldPlaceRidgesAtChunk(origin.cx, origin.cy)) return false;
  return Rng.hash(worldSeed, 'as-kedja', ix, iy) % 3 !== 0;
}

function collidedEarlier(steps: readonly Step[], x: number, y: number): boolean {
  for (let i = 0; i < steps.length - 1; i++) {
    const s = steps[i];
    if (!s) continue;
    if (Math.hypot(s.x - x, s.y - y) < STEP * 0.85) return true;
  }
  return false;
}

function walkSpine(worldSeed: number, ix: number, iy: number): Step[] {
  const spanSteps = SPAN_MIN + (Rng.hash(worldSeed, 'as-lang', ix, iy) % SPAN_EXTRA);
  const n = spanSteps + 1;
  let ang = initialAngle(worldSeed, ix, iy);
  const side = ((Rng.hash(worldSeed, 'as-sida', ix, iy) % 1000) / 999 - 0.5) * 22;
  let x = ix * SPINE_GRID + Math.cos(ang + Math.PI / 2) * side;
  let y = iy * SPINE_GRID + Math.sin(ang + Math.PI / 2) * side;
  const out: Step[] = [];
  for (let i = 0; i < n; i++) {
    if (i > 1 && collidedEarlier(out, x, y)) break;
    out.push({ x, y, keep: pointKeep(worldSeed, x, y), index: i });
    if (i === n - 1) break;
    ang = steer(worldSeed, x, y, ang);
    x += Math.cos(ang) * STEP;
    y += Math.sin(ang) * STEP;
  }
  if ((out.length - 1) * STEP + 1e-6 < 20) return [];
  return out;
}

function pickId(worldSeed: number, ix: number, iy: number, index: number): PlannedRidgeBlock['id'] {
  const h = Rng.hash(worldSeed, 'as-art', ix, iy, index);
  if (h % 5 === 0) return 'stenhog';
  return (h & 1) === 0 ? 'stenblock' : 'stenblock_lav';
}

function toBlock(worldSeed: number, ix: number, iy: number, step: Step): PlannedRidgeBlock {
  return {
    wx: step.x,
    wy: step.y,
    id: pickId(worldSeed, ix, iy, step.index),
    collider: { x: step.x, y: step.y, r: RIDGE_COLLIDER_R },
  };
}

function keptRuns(steps: readonly Step[]): Step[][] {
  const groups: Step[][] = [];
  let cur: Step[] = [];
  for (const step of steps) {
    if (!step.keep) {
      if (cur.length >= 2) groups.push(cur);
      cur = [];
      continue;
    }
    cur.push(step);
  }
  if (cur.length >= 2) groups.push(cur);
  return groups;
}

function indexBlock(store: SeedStore, block: PlannedRidgeBlock): void {
  const ix = Math.floor(block.wx / BLOCK_CELL);
  const iy = Math.floor(block.wy / BLOCK_CELL);
  const key = chunkKey(ix, iy);
  const list = store.cells.get(key);
  if (list) list.push(block);
  else store.cells.set(key, [block]);
}

function nearAccepted(accepted: readonly PlannedRidgeBlock[], x: number, y: number): boolean {
  for (const block of accepted) {
    if (Math.abs(block.wx - x) < 0.05 && Math.abs(block.wy - y) < 0.05) return true;
  }
  return false;
}

/** Kedjan räknas en gång. Chunkar plockar sedan den del som landar hos dem. */
function spineBlocks(worldSeed: number, ix: number, iy: number): readonly PlannedRidgeBlock[] {
  const store = storeFor(worldSeed);
  const key = chunkKey(ix, iy);
  const cached = store.spines.get(key);
  if (cached) return cached;
  if (!spineActive(worldSeed, ix, iy)) {
    store.spines.set(key, NO_BLOCKS);
    return NO_BLOCKS;
  }
  const blocks: PlannedRidgeBlock[] = [];
  for (const run of keptRuns(walkSpine(worldSeed, ix, iy))) {
    for (const step of run) blocks.push(toBlock(worldSeed, ix, iy, step));
  }
  store.spines.set(key, blocks);
  return blocks;
}

export function planRidgesForChunk(args: { worldSeed: number; cx: number; cy: number }): PlannedRidgeBlock[] {
  const store = storeFor(args.worldSeed);
  const key = `${args.worldSeed}|${args.cx}|${args.cy}`;
  const cached = store.chunks.get(key);
  if (cached) return cached;
  if (!shouldPlaceRidgesAtChunk(args.cx, args.cy)) {
    store.chunks.set(key, NO_BLOCKS);
    return NO_BLOCKS;
  }
  const min = chunkMinWorld(args.cx, args.cy);
  const span = chunkWorldSpan();
  const reach = 60;
  const ix0 = Math.floor((min.x - reach) / SPINE_GRID);
  const ix1 = Math.floor((min.x + span + reach) / SPINE_GRID);
  const iy0 = Math.floor((min.y - reach) / SPINE_GRID);
  const iy1 = Math.floor((min.y + span + reach) / SPINE_GRID);
  const accepted: PlannedRidgeBlock[] = [];
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iy = iy0; iy <= iy1; iy++) {
      if (!spineActive(args.worldSeed, ix, iy)) continue;
      for (const block of spineBlocks(args.worldSeed, ix, iy)) {
        const owner = worldToChunk(block.wx, block.wy);
        if (owner.cx !== args.cx || owner.cy !== args.cy) continue;
        if (nearAccepted(accepted, block.wx, block.wy)) continue;
        accepted.push(block);
        indexBlock(store, block);
      }
    }
  }
  accepted.sort((a, b) => a.wy - b.wy || a.wx - b.wx || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  store.chunks.set(key, accepted);
  return accepted;
}

function planDisk(worldSeed: number, wx: number, wy: number, reach: number): void {
  const lo = worldToChunk(wx - reach, wy - reach);
  const hi = worldToChunk(wx + reach, wy + reach);
  for (let cx = lo.cx; cx <= hi.cx; cx++) {
    for (let cy = lo.cy; cy <= hi.cy; cy++) planRidgesForChunk({ worldSeed, cx, cy });
  }
}

function anyBlockNear(store: SeedStore, wx: number, wy: number, reach: number): boolean {
  const ix0 = Math.floor((wx - reach) / BLOCK_CELL);
  const ix1 = Math.floor((wx + reach) / BLOCK_CELL);
  const iy0 = Math.floor((wy - reach) / BLOCK_CELL);
  const iy1 = Math.floor((wy + reach) / BLOCK_CELL);
  const reach2 = reach * reach;
  for (let iy = iy0; iy <= iy1; iy++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const list = store.cells.get(chunkKey(ix, iy));
      if (!list) continue;
      for (const block of list) {
        const dx = block.wx - wx;
        const dy = block.wy - wy;
        if (dx * dx + dy * dy < reach2) return true;
      }
    }
  }
  return false;
}

/** Sant om en cirkel (eller en punkt när radius saknas) träffar ett planerat åsblock. */
export function ridgeBlocksWorld(worldSeed: number, wx: number, wy: number, radius = 0): boolean {
  const extra = radius > 0 ? radius : 0;
  const reach = extra + RIDGE_COLLIDER_R;
  planDisk(worldSeed, wx, wy, reach);
  return anyBlockNear(storeFor(worldSeed), wx, wy, reach);
}

/**
 * Mörkare ovansida norr om en ås. Samma (worldSeed, gx, gy) ger samma svar.
 * Långt från åsar, och i biom utan åsar, är svaret falskt.
 */
export function isRidgeHighlandTile(worldSeed: number, gx: number, gy: number): boolean {
  const wx = (gx + 0.5) * TILE_WORLD;
  const wy = (gy + 0.5) * TILE_WORLD;
  const here = worldToChunk(wx, wy);
  if (!shouldPlaceRidgesAtChunk(here.cx, here.cy)) return false;
  planDisk(worldSeed, wx, wy + (HIGHLAND_NEAR + HIGHLAND_FAR) * 0.5, HIGHLAND_LATERAL + HIGHLAND_FAR);
  const store = storeFor(worldSeed);
  const ix0 = Math.floor((wx - HIGHLAND_LATERAL) / BLOCK_CELL);
  const ix1 = Math.floor((wx + HIGHLAND_LATERAL) / BLOCK_CELL);
  const iy0 = Math.floor((wy + HIGHLAND_NEAR) / BLOCK_CELL);
  const iy1 = Math.floor((wy + HIGHLAND_FAR) / BLOCK_CELL);
  for (let iy = iy0; iy <= iy1; iy++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const list = store.cells.get(chunkKey(ix, iy));
      if (!list) continue;
      for (const block of list) {
        const north = block.wy - wy;
        if (north < HIGHLAND_NEAR || north > HIGHLAND_FAR) continue;
        if (Math.abs(block.wx - wx) > HIGHLAND_LATERAL) continue;
        return true;
      }
    }
  }
  return false;
}

/** Träd och buskar hoppar över själva klippblockets cirkel. */
registerDecorKeepout((worldSeed, wx, wy) => ridgeBlocksWorld(worldSeed, wx, wy));

/** Tömmer plan-cachen. Tester använder den för att räkna om samma chunk. */
export function resetRidgePlannerCache(): void {
  stores.clear();
}
