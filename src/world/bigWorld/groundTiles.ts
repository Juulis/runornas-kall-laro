import { Rng } from '../../core/Rng';
import { TILE_WORLD } from '../../render/Iso';
import { chunkMinWorld } from './bigWorldCoords';
import { worldValueNoise } from './worldNoise';

export type GroundRole = 'base' | 'patchA' | 'patchB' | 'rare';

export interface GroundRolePool {
  base: readonly string[];
  patchA: readonly string[];
  patchB: readonly string[];
  rare: readonly string[];
}

/**
 * Värdebruset är samlat kring mitten, inte likformigt.
 * Trösklarna är percentilerna 2 %, 10 % och 30 % så ytorna blir
 * ungefär sällsynt 2 %, fläck B 8 %, fläck A 20 % och bas 70 %.
 */
const RARE_BELOW = 0.2;
const PATCH_B_BELOW = 0.303;
const PATCH_A_BELOW = 0.42;

const FALLBACK_TILE = 'gras_1';

/** Platt tile-lista (andra biom tills steg 4) blir en rollpool. Tomma roller faller tillbaka till bas. */
export function toRolePool(pool: readonly string[]): GroundRolePool {
  if (pool.length === 0) return { base: [FALLBACK_TILE], patchA: [], patchB: [], rare: [] };
  return { base: [...pool], patchA: [], patchB: [], rare: [] };
}

function isRolePool(pool: GroundRolePool | readonly string[]): pool is GroundRolePool {
  return !Array.isArray(pool) && 'base' in pool && 'patchA' in pool && 'patchB' in pool && 'rare' in pool;
}

function asRolePool(pool: GroundRolePool | readonly string[]): GroundRolePool {
  return isRolePool(pool) ? pool : toRolePool(pool);
}

/** Världsruta för (cx, cy, lokal ti, tj). Samma ruta från två chunkars sida ger samma (gx, gy). */
export function worldTileIndex(cx: number, cy: number, ti: number, tj: number): { gx: number; gy: number } {
  const min = chunkMinWorld(cx, cy);
  return {
    gx: Math.round((min.x + ti * TILE_WORLD) / TILE_WORLD),
    gy: Math.round((min.y + tj * TILE_WORLD) / TILE_WORLD),
  };
}

/** Roll från brusfältet. Samma (worldSeed, gx, gy) ger alltid samma roll. */
export function groundRoleAt(worldSeed: number, gx: number, gy: number): GroundRole {
  const n = worldValueNoise(worldSeed, gx, gy);
  if (n < RARE_BELOW) return 'rare';
  if (n < PATCH_B_BELOW) return 'patchB';
  if (n < PATCH_A_BELOW) return 'patchA';
  return 'base';
}

function tilesForRole(pool: GroundRolePool, role: GroundRole): readonly string[] {
  const chosen = pool[role];
  if (chosen.length > 0) return chosen;
  if (pool.base.length > 0) return pool.base;
  return [FALLBACK_TILE];
}

function pickFromList(worldSeed: number, gx: number, gy: number, role: GroundRole, list: readonly string[]): string {
  if (list.length === 0) return FALLBACK_TILE;
  const only = list[0];
  if (list.length === 1) return only ?? FALLBACK_TILE;
  const index = Math.floor(new Rng(Rng.hash(worldSeed, 'marktile', gx, gy, role)).next() * list.length);
  return list[index] ?? FALLBACK_TILE;
}

/**
 * Markplatta för en världsruta. Platt string[] mappas till roller via toRolePool.
 * Tom roll faller tillbaka till bas, tom pool till gras_1.
 */
export function pickChunkGroundTileId(worldSeed: number, gx: number, gy: number, pool: GroundRolePool | readonly string[]): string {
  const roles = asRolePool(pool);
  const role = groundRoleAt(worldSeed, gx, gy);
  return pickFromList(worldSeed, gx, gy, role, tilesForRole(roles, role));
}

/** Samma val som pickChunkGroundTileId — för tester utan Pixi. */
export function chunkGroundTileGrid(
  worldSeed: number,
  cx: number,
  cy: number,
  tiles: number,
  pool: GroundRolePool | readonly string[],
): string[][] {
  const origin = worldTileIndex(cx, cy, 0, 0);
  const grid: string[][] = [];
  for (let ti = 0; ti < tiles; ti++) {
    const row: string[] = [];
    const gx = origin.gx + ti;
    for (let tj = 0; tj < tiles; tj++) row.push(pickChunkGroundTileId(worldSeed, gx, origin.gy + tj, pool));
    grid.push(row);
  }
  return grid;
}

/** En patch à patchTiles — samma tile-indexering som BigWorldStreamGround.buildTilesStep. */
export function fillPatchGroundTiles(
  grid: string[][],
  worldSeed: number,
  cx: number,
  cy: number,
  pool: GroundRolePool | readonly string[],
  pi: number,
  pj: number,
  patchTiles: number,
  tiles: number,
): void {
  const ti0 = pi * patchTiles;
  const tj0 = pj * patchTiles;
  const tw = Math.min(patchTiles, tiles - ti0);
  const th = Math.min(patchTiles, tiles - tj0);
  const origin = worldTileIndex(cx, cy, 0, 0);
  for (let built = 0; built < tw * th; built++) {
    const di = Math.floor(built / tw);
    const dj = built % tw;
    const ti = ti0 + di;
    const tj = tj0 + dj;
    const row = grid[ti];
    if (!row) continue;
    row[tj] = pickChunkGroundTileId(worldSeed, origin.gx + ti, origin.gy + tj, pool);
  }
}

export function buildChunkGroundViaPatchOrder(
  worldSeed: number,
  cx: number,
  cy: number,
  tiles: number,
  pool: GroundRolePool | readonly string[],
  patchTiles: number,
  patchOrder: readonly [number, number][],
): string[][] {
  const grid: string[][] = Array.from({ length: tiles }, () => Array.from({ length: tiles }, () => ''));
  for (const [pi, pj] of patchOrder) fillPatchGroundTiles(grid, worldSeed, cx, cy, pool, pi, pj, patchTiles, tiles);
  return grid;
}

export function patchOrderByDistance(firstPi: number, firstPj: number, tiles: number, patchTiles: number): [number, number][] {
  const side = Math.ceil(tiles / patchTiles);
  const order: [number, number][] = [];
  for (let pi = 0; pi < side; pi++) for (let pj = 0; pj < side; pj++) order.push([pi, pj]);
  order.sort((a, b) => (a[0] - firstPi) ** 2 + (a[1] - firstPj) ** 2 - ((b[0] - firstPi) ** 2 + (b[1] - firstPj) ** 2));
  return order;
}
