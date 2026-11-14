import { Rng } from '../../core/Rng';
import { canonicalBiomeId } from '../../render/biomeAssetGroups';
import { TILE_WORLD } from '../../render/Iso';
import { PLAYABLE_CITIES } from '../cityZones';
import { chunkTileCount, worldToChunk } from './bigWorldCoords';
import { bigWorldCityPortalWorld } from './bigWorldPortals';
import { worldTileIndex } from './groundTiles';
import { isRoadMaskAtWorld } from './roads';
import { campStartPos } from './startskogenFootprint';
import { biomeIdAtChunk, effectiveBiomeAtTile } from './transitionResolver';
import { worldValueNoiseSalted } from './worldNoise';

/**
 * Tjärnar i träsk och kust. Ingen Pixi.
 *
 * V1-strand: rutan behåller sin vanliga markplatta (pickBlendedGroundTileId).
 * Inga gras_till_vatten-plattor. Strandväxter (vasstuva, kaveldun, myrull) får
 * stå på strandrutor, inte ute i tjärnen. nackros_* och vass_kant finns inte.
 *
 * En tjärn är en 4-sammanhängande blob på 4–14 rutor inuti ett världsblock.
 * Blocket är inte låst till chunkar, så en tjärn får korsa en chunkgräns.
 * Hela komponenten räknas i blocket, oavsett vilken chunk som frågar.
 * Vad och bro kommer i steg 15: idag är varje vattenruta spärrad.
 */

/** Fri radie kring byportaler, i världsenheter. Hela vattenrutan ligger utanför. */
export const PORTAL_WATER_CLEAR = 8;

/** Ingen vattenruta inom så här många världsenheter från start_pos. */
export const CAMP_WATER_CLEAR = 60;

/** V1-vatten. Redan i träskets tilegrupp. Kusten begär dem särskilt. */
export const WATER_TILE_IDS = ['myr_gol_1', 'myr_gol_2'] as const;

/** Små växter som får stå på strand, om de finns i chunkens pool. */
export const SHORE_PLANT_IDS: readonly string[] = ['vasstuva', 'kaveldun', 'myrull'];

/** Delad glimt: alpha = bas + amp * sin(t * omega). Samma för alla vattentiles. */
export const WATER_SHIMMER_BASE = 0.78;
export const WATER_SHIMMER_AMP = 0.22;
export const WATER_SHIMMER_OMEGA = 2.1;

const TJARN_SALT = 'tjarn';
/** Världsrutor per block. Inte en delare av chunkens 64, så blobbar kan korsa chunkgräns. */
const BLOCK = 20;
/** Torr ram så grannblockens tjärnar inte möts (minst två rutor emellan). */
const MARGIN = 1;
const MIN_POND = 4;
const MAX_POND = 14;

const N4: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const EMPTY: ReadonlySet<string> = new Set();
const pondCache = new Map<string, ReadonlySet<string>>();
const chunkWaterBiome = new Map<string, boolean>();

let portalCache: readonly { x: number; y: number }[] | null = null;

function portals(): readonly { x: number; y: number }[] {
  if (portalCache) return portalCache;
  portalCache = PLAYABLE_CITIES.map((city) => bigWorldCityPortalWorld(city));
  return portalCache;
}

function tileKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

/** Närmaste avstånd från en punkt till rutan. 0 om punkten ligger i rutan. */
export function distToWaterTile(px: number, py: number, gx: number, gy: number): number {
  const x0 = gx * TILE_WORLD;
  const y0 = gy * TILE_WORLD;
  const cx = Math.max(x0, Math.min(px, x0 + TILE_WORLD));
  const cy = Math.max(y0, Math.min(py, y0 + TILE_WORLD));
  return Math.hypot(px - cx, py - cy);
}

function chunkMayContainWater(cx: number, cy: number): boolean {
  const key = `${cx},${cy}`;
  const hit = chunkWaterBiome.get(key);
  if (hit !== undefined) return hit;
  let yes = false;
  for (let dy = -1; dy <= 1 && !yes; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const id = canonicalBiomeId(biomeIdAtChunk(cx + dx, cy + dy));
      if (id === 'trask' || id === 'kust') {
        yes = true;
        break;
      }
    }
  }
  chunkWaterBiome.set(key, yes);
  return yes;
}

function blockMayContainWater(bx: number, by: number): boolean {
  const x0 = bx * BLOCK;
  const y0 = by * BLOCK;
  const x1 = x0 + BLOCK - 1;
  const y1 = y0 + BLOCK - 1;
  const midX = x0 + (BLOCK >> 1);
  const midY = y0 + (BLOCK >> 1);
  const samples: readonly (readonly [number, number])[] = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
    [midX, midY],
    [midX, y0],
    [midX, y1],
    [x0, midY],
    [x1, midY],
  ];
  const seen = new Set<string>();
  for (const [gx, gy] of samples) {
    const chunk = worldToChunk(gx * TILE_WORLD + TILE_WORLD * 0.5, gy * TILE_WORLD + TILE_WORLD * 0.5);
    const key = `${chunk.cx},${chunk.cy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (chunkMayContainWater(chunk.cx, chunk.cy)) return true;
  }
  return false;
}

function gate(worldSeed: number, gx: number, gy: number): boolean {
  const biome = canonicalBiomeId(effectiveBiomeAtTile(worldSeed, gx, gy));
  if (biome !== 'trask' && biome !== 'kust') return false;
  const midX = gx * TILE_WORLD + TILE_WORLD * 0.5;
  const midY = gy * TILE_WORLD + TILE_WORLD * 0.5;
  if (isRoadMaskAtWorld(worldSeed, midX, midY)) return false;
  const start = campStartPos();
  if (distToWaterTile(start.x, start.y, gx, gy) < CAMP_WATER_CLEAR) return false;
  for (const portal of portals()) {
    if (distToWaterTile(portal.x, portal.y, gx, gy) < PORTAL_WATER_CLEAR) return false;
  }
  return true;
}

interface Cell {
  gx: number;
  gy: number;
  n: number;
}

function betterCell(a: Cell, b: Cell): boolean {
  if (a.n !== b.n) return a.n > b.n;
  if (a.gy !== b.gy) return a.gy < b.gy;
  return a.gx < b.gx;
}

function touches(cell: Cell, chosen: readonly Cell[]): boolean {
  for (const have of chosen) {
    const dx = Math.abs(cell.gx - have.gx);
    const dy = Math.abs(cell.gy - have.gy);
    if (dx + dy === 1) return true;
  }
  return false;
}

function computePond(worldSeed: number, bx: number, by: number): ReadonlySet<string> {
  if (!blockMayContainWater(bx, by)) return EMPTY;
  const x0 = bx * BLOCK + MARGIN;
  const y0 = by * BLOCK + MARGIN;
  const x1 = (bx + 1) * BLOCK - MARGIN;
  const y1 = (by + 1) * BLOCK - MARGIN;
  const cells: Cell[] = [];
  for (let gy = y0; gy < y1; gy++) {
    for (let gx = x0; gx < x1; gx++) {
      if (!gate(worldSeed, gx, gy)) continue;
      cells.push({ gx, gy, n: worldValueNoiseSalted(worldSeed, gx, gy, TJARN_SALT) });
    }
  }
  const first = cells[0];
  if (!first || cells.length < MIN_POND) return EMPTY;
  let origin = first;
  for (const cell of cells) {
    if (betterCell(cell, origin)) origin = cell;
  }
  const span = MAX_POND - MIN_POND + 1;
  const want = MIN_POND + (Rng.hash(worldSeed, 'tjarn-storlek', bx, by) % span);
  const chosen: Cell[] = [origin];
  const used = new Set<string>([tileKey(origin.gx, origin.gy)]);
  while (chosen.length < want) {
    let best: Cell | null = null;
    for (const cell of cells) {
      if (used.has(tileKey(cell.gx, cell.gy))) continue;
      if (!touches(cell, chosen)) continue;
      if (!best || betterCell(cell, best)) best = cell;
    }
    if (!best) break;
    chosen.push(best);
    used.add(tileKey(best.gx, best.gy));
  }
  if (chosen.length < MIN_POND) return EMPTY;
  return used;
}

function pondSet(worldSeed: number, bx: number, by: number): ReadonlySet<string> {
  const key = `${worldSeed}|${bx}|${by}`;
  const hit = pondCache.get(key);
  if (hit) return hit;
  if (pondCache.size > 8192) pondCache.clear();
  const built = computePond(worldSeed, bx, by);
  pondCache.set(key, built);
  return built;
}

/** Sant om världsrutan är vatten. Bara worldSeed och (gx, gy). */
export function isWaterTile(worldSeed: number, gx: number, gy: number): boolean {
  const bx = Math.floor(gx / BLOCK);
  const by = Math.floor(gy / BLOCK);
  return pondSet(worldSeed, bx, by).has(tileKey(gx, gy));
}

/** 4-granne till vatten, själv inte vatten. */
export function isShoreTile(worldSeed: number, gx: number, gy: number): boolean {
  if (isWaterTile(worldSeed, gx, gy)) return false;
  for (const [dx, dy] of N4) {
    if (isWaterTile(worldSeed, gx + dx, gy + dy)) return true;
  }
  return false;
}

/** myr_gol_1 eller myr_gol_2, eller null på torr ruta. */
export function waterTileIdAt(worldSeed: number, gx: number, gy: number): string | null {
  if (!isWaterTile(worldSeed, gx, gy)) return null;
  return (Rng.hash(worldSeed, 'tjarn-yta', gx, gy) & 1) === 0 ? 'myr_gol_1' : 'myr_gol_2';
}

/** Sant om rutan ska spärras. Vad och bro (steg 15) är inte med. */
export function isWaterBlockedTile(worldSeed: number, gx: number, gy: number): boolean {
  return isWaterTile(worldSeed, gx, gy);
}

/** Sant om världspunkten står på en spärrad vattenruta. */
export function isWaterAtWorld(worldSeed: number, wx: number, wy: number): boolean {
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return false;
  return isWaterBlockedTile(worldSeed, Math.floor(wx / TILE_WORLD), Math.floor(wy / TILE_WORLD));
}

/**
 * Samma alfa för alla vattentiles. Periodisk, i (0, 1], samma tid ger samma värde.
 */
export function waterShimmerAlpha(time: number): number {
  const alpha = WATER_SHIMMER_BASE + WATER_SHIMMER_AMP * Math.sin(time * WATER_SHIMMER_OMEGA);
  if (alpha > 1) return 1;
  if (alpha < 0.01) return 0.01;
  return alpha;
}

/** Sätter zone.blocked på chunkens vattenrutor. Sant om minst en ruta spärrades. */
export function applyChunkWaterBlocked(
  zone: { setBlocked(wx: number, wy: number, value: boolean): void },
  worldSeed: number,
  cx: number,
  cy: number,
): boolean {
  if (!chunkMayContainWater(cx, cy)) return false;
  const tiles = chunkTileCount();
  const origin = worldTileIndex(cx, cy, 0, 0);
  let any = false;
  for (let ti = 0; ti < tiles; ti++) {
    const gx = origin.gx + ti;
    for (let tj = 0; tj < tiles; tj++) {
      const gy = origin.gy + tj;
      if (!isWaterBlockedTile(worldSeed, gx, gy)) continue;
      any = true;
      zone.setBlocked(gx * TILE_WORLD + TILE_WORLD * 0.5, gy * TILE_WORLD + TILE_WORLD * 0.5, true);
    }
  }
  return any;
}
