import type { BigWorldDataFile, BigWorldRegion } from '../../data/bigWorldTypes';
import { Rng } from '../../core/Rng';
import { chebyshevChunkDist } from './ringZone';
import { isLegacyOnlySpawnChunk } from './startskogenFootprint';
import { resolveRegionAtChunk } from './regionIndex';

export type RegionTathet = number | readonly [number, number] | { monster_per_game?: number; kalla?: string };

/**
 * JSON-talet är en total per region, utspridd på chunkar à 128 enheter.
 * Skalan följer mellanmarkens medel. Tidigare fast 4 när medlet var 23.
 * Ring 0-1 (medel 48) ger 9, ring 2-3 (medel 38) ger 8, ring 4 och ut (medel 30) ger 6.
 * Ring 2-3 ligger ett steg över 4 * 38 / 23 så regioner nära det gamla medlet,
 * till exempel gamla byn, inte blir glesare än samma rings mellanmark.
 */
export function regionSpawnScale(ring: number): number {
  if (ring <= 1) return 9;
  if (ring <= 3) return 8;
  return 6;
}

function regionMonsterBudgetUnscaled(region: BigWorldRegion, ring: number, data: BigWorldDataFile): number {
  const t = region.tathet as RegionTathet | undefined;
  if (t != null && typeof t === 'object' && !Array.isArray(t) && 'monster_per_game' in t) {
    return Math.max(0, t.monster_per_game ?? 0);
  }
  if (typeof t === 'number') return Math.max(0, t);
  if (Array.isArray(t)) return Math.max(0, t[1]);
  const regel = data.meta.tathet_regel;
  if (region.genererad_spawn !== true) {
    if (region.typ === 'by' || region.typ === 'stad') return regel?.byar ?? 0;
    return 0;
  }
  if (regel) {
    if (ring === 2 && regel.ring_2_kontroll != null) return regel.ring_2_kontroll;
    if (ring <= 1 && regel.delomrade_ring_0_1 != null) return regel.delomrade_ring_0_1;
    if (ring >= 3 && regel.vildmark_ring_3_plus != null) return regel.vildmark_ring_3_plus;
  }
  return 2;
}

export function regionMonsterPerGame(region: BigWorldRegion, ring: number, data: BigWorldDataFile): number {
  const raw = regionMonsterBudgetUnscaled(region, ring, data);
  if (raw <= 0 || region.sakert === true) return 0;
  return raw * regionSpawnScale(ring);
}

/** Chunkar i regionens radie som kan få regionstäthet (ej legacy-only, ej säker plats). */
export function regionSpawnChunkList(region: BigWorldRegion): { cx: number; cy: number }[] {
  const [rx, ry] = region.chunk;
  const out: { cx: number; cy: number }[] = [];
  for (let dx = -region.radie; dx <= region.radie; dx++) {
    for (let dy = -region.radie; dy <= region.radie; dy++) {
      if (chebyshevChunkDist(rx + dx, ry + dy, rx, ry) > region.radie) continue;
      const cx = rx + dx;
      const cy = ry + dy;
      if (isLegacyOnlySpawnChunk(cx, cy)) continue;
      out.push({ cx, cy });
    }
  }
  out.sort((a, b) => (a.cx !== b.cx ? a.cx - b.cx : a.cy - b.cy));
  return out;
}

/** Antal monster denna chunk ska få från regionens monster_per_game (fördelat jämnt). */
export function regionSpawnCountForChunk(
  region: BigWorldRegion,
  cx: number,
  cy: number,
  gameSeed: number,
  ring: number,
  data: BigWorldDataFile,
): number {
  const chunks = regionSpawnChunkList(region);
  const idx = chunks.findIndex((c) => c.cx === cx && c.cy === cy);
  if (idx < 0) return 0;
  const total = regionMonsterPerGame(region, ring, data);
  if (total <= 0) return 0;
  const n = chunks.length;
  const base = Math.floor(total / n);
  const extra = total % n;
  const rng = new Rng(Rng.hash(gameSeed, region.id, 'region-tathet'));
  const order = rng.shuffle(chunks);
  const rank = order.findIndex((c) => c.cx === cx && c.cy === cy);
  if (rank < 0) return base;
  return base + (rank < extra ? 1 : 0);
}

/** Sant om chunk ska använda regionens undertyper (inte enbart mellanmark). */
export function chunkUsesRegionSpawn(cx: number, cy: number, regions: readonly BigWorldRegion[], data: BigWorldDataFile): boolean {
  const { region, inside } = resolveRegionAtChunk(cx, cy, regions);
  if (!inside || isLegacyOnlySpawnChunk(cx, cy)) return false;
  if (region.genererad_spawn === true) return true;
  return regionMonsterPerGame(region, region.ringzon ?? 0, data) > 0;
}
