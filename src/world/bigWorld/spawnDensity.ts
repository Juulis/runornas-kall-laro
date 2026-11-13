import { DATA } from '../../data';
import type { BigWorldDataFile, BigWorldRegion } from '../../data/bigWorldTypes';
import { regionSpawnCountForChunk, regionMonsterPerGame } from './regionSpawnBudget';

type RingRange = readonly [number, number];

const genTable = DATA.varldGenerator.monsterpooler.tathet_per_chunk as Record<string, RingRange>;

function ringKey(ring: number): string {
  const n = Math.max(0, Math.floor(ring));
  const specific = `ring_${n}`;
  if (genTable[specific]) return specific;
  if (n >= 3 && genTable.ring_3_och_ut) return 'ring_3_och_ut';
  return specific;
}

/** Mellanmark, monster per chunk. Ring 0-1 medel 48, ring 2-3 medel 38, ring 4 och ut medel 30. */
export function mellanmarkSpawnCountRange(ring: number): RingRange {
  const key = ringKey(ring);
  return genTable[key] ?? genTable.ring_3_och_ut ?? [26, 34];
}

/** Mellanmarksgrupp: 2 till 4 monster, slumpat, snitt cirka 3. */
export const MELLANMARK_GROUP_MIN = 2;
export const MELLANMARK_GROUP_MAX = 4;
/** Hur långt från gruppens mitt ett monster får stå, världsenheter. */
export const MELLANMARK_GROUP_SPREAD = 3;
/** Minsta avstånd mellan två gruppers centra, världsenheter. */
export const MELLANMARK_GROUP_SEPARATION = 14;

/** Namngiven region — fördelar region.tathet.monster_per_game över regionens chunkar. */
export function regionSpawnCountRange(
  region: BigWorldRegion,
  ring: number,
  data: BigWorldDataFile = DATA.varldStor,
  cx?: number,
  cy?: number,
  gameSeed?: number,
): RingRange {
  if (cx != null && cy != null && gameSeed != null) {
    const n = regionSpawnCountForChunk(region, cx, cy, gameSeed, ring, data);
    return [n, n];
  }
  const total = regionMonsterPerGame(region, ring, data);
  return [total, total];
}

/** @deprecated use regionSpawnCountRange */
export function namedRegionSpawnCountRange(region: BigWorldRegion): RingRange {
  return regionSpawnCountRange(region, region.ringzon ?? 0);
}

/** Manhattan-rutor från vägens mitt. Ring 0 och 1 har ett hårt band, från ring 2 det vidare bandet. */
export function roadSkipRadius(ring: number): number {
  return ring <= 1 ? 2 : 4;
}

/** Avstånd i rutor från vägcentrum inom chunk. radius är Manhattan-gränsen. */
export function spawnTileNearRoad(
  localX: number,
  localY: number,
  cx: number,
  cy: number,
  roadIds: readonly string[],
  hasRoadAtTile: (cx: number, cy: number, ti: number, tj: number) => boolean,
  radius = 4,
): boolean {
  if (roadIds.length === 0) return false;
  const ti = Math.floor(localX);
  const tj = Math.floor(localY);
  const r = Math.max(0, Math.floor(radius));
  for (let dj = -r; dj <= r; dj++) {
    for (let di = -r; di <= r; di++) {
      if (Math.abs(di) + Math.abs(dj) > r) continue;
      if (hasRoadAtTile(cx, cy, ti + di, tj + dj)) return true;
    }
  }
  return false;
}

/**
 * Ring 0 och 1: alltid hoppa över om rutan är nära vägen.
 * Från ring 2: hoppa över med 50 procents chans (rngNext > 0,5).
 */
export function skipSpawnNearRoad(nearRoad: boolean, rngNext: number, ring = 2): boolean {
  if (!nearRoad) return false;
  if (ring <= 1) return true;
  return rngNext > 0.5;
}

/** Champion per grupp (hela gruppen), från elit_modell. Inte per chunk. */
export function mellanmarkChampionRoll(): { minRing: number; chance: number } {
  const pool = DATA.varldGenerator.monsterpooler;
  const model = pool.elit_modell;
  if (model && typeof model === 'object') {
    return {
      minRing: model.fran_ring ?? 2,
      chance: model.chans_per_grupp ?? 0.1,
    };
  }
  const elit = pool.elit;
  if (elit && typeof elit === 'object') {
    return {
      minRing: elit.mellanmark_champion_min_ring ?? 2,
      chance: elit.mellanmark_champion_chance_per_chunk ?? 0.1,
    };
  }
  return { minRing: 2, chance: 0.1 };
}

/** Vikt inom familjens pool. Saknad vikt = 1. max_andel är en global andel, inte ett chunktak. */
export function subtypeSpawnWeight(id: string): number {
  const w = DATA.varldGenerator.monsterpooler.vikter?.undertyper?.[id];
  return typeof w === 'number' && w > 0 ? w : 1;
}

export function fogRevealRadiusWorld(): number {
  const k = DATA.varldGenerator.karta_och_dimma;
  if (!k || typeof k === 'string') return 28;
  if (k.dimma_radie_enheter != null) return k.dimma_radie_enheter;
  const rutor = k.dimma_radie_rutor ?? 14;
  return rutor * 2;
}
