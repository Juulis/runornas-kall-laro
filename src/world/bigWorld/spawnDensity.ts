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

/** Mellanmark — monster per chunk från varldsgenerator.json (tät nog att en kort promenad möter fiender). */
export function mellanmarkSpawnCountRange(ring: number): RingRange {
  const key = ringKey(ring);
  return genTable[key] ?? genTable.ring_3_och_ut ?? [18, 28];
}

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

/** Avstånd i rutor från vägcentrum inom chunk (varldsgenerator: 4 rutor). */
export function spawnTileNearRoad(
  localX: number,
  localY: number,
  cx: number,
  cy: number,
  roadIds: readonly string[],
  hasRoadAtTile: (cx: number, cy: number, ti: number, tj: number) => boolean,
): boolean {
  if (roadIds.length === 0) return false;
  const ti = Math.floor(localX);
  const tj = Math.floor(localY);
  for (let dj = -4; dj <= 4; dj++) {
    for (let di = -4; di <= 4; di++) {
      if (Math.abs(di) + Math.abs(dj) > 4) continue;
      if (hasRoadAtTile(cx, cy, ti + di, tj + dj)) return true;
    }
  }
  return false;
}

/** 50 % chans att hoppa över spawn vid väg (per monster, inte hela chunken). */
export function skipSpawnNearRoad(nearRoad: boolean, rngNext: number): boolean {
  return nearRoad && rngNext > 0.5;
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
