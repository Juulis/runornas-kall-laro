import type { BigWorldBiome } from '../../data/bigWorldTypes';
import { toRolePool, type GroundRolePool } from './groundTiles';

export interface BiomeWeight {
  biomeId: string;
  weight: number;
}

const NEIGHBOR_OFFSETS: readonly [number, number][] = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/**
 * Mjuka biomövergångar: primär biom + grannar med annan biom får vikt
 * (design: overgangar per biom — här approximeras med grannchunkar).
 */
export function blendBiomesAtChunk(
  cx: number,
  cy: number,
  primaryBiomeId: string,
  neighborBiome: (ncx: number, ncy: number) => string,
): BiomeWeight[] {
  const weights = new Map<string, number>();
  for (const [dx, dy] of NEIGHBOR_OFFSETS) {
    const bid = neighborBiome(cx + dx, cy + dy);
    const w = dx === 0 && dy === 0 ? 4 : 1;
    weights.set(bid, (weights.get(bid) ?? 0) + w);
  }
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  const out: BiomeWeight[] = [];
  for (const [biomeId, w] of weights) {
    out.push({ biomeId, weight: w / total });
  }
  out.sort((a, b) => b.weight - a.weight);
  if (out[0]?.biomeId !== primaryBiomeId) {
    // Säkerställ att primär biom alltid är först efter sort
    const i = out.findIndex((x) => x.biomeId === primaryBiomeId);
    if (i > 0) {
      const [p] = out.splice(i, 1);
      if (p) out.unshift(p);
    }
  }
  return out;
}

/**
 * Skogens mark. Bas är gräs, fläck A glänta, fläck B mossa, sällsynt blomsteräng.
 * Andra biom får egna markset i steg 4 och behåller sina nuvarande plattor.
 */
export const SKOG_GROUND_ROLES: GroundRolePool = {
  base: ['gras_1', 'gras_2', 'gras_3', 'gras_4'],
  patchA: ['skogsbotten_lov', 'skogsbotten_barr_1', 'skogsbotten_barr_2'],
  patchB: ['mossa_1', 'mossa_2'],
  rare: ['gras_blommor_1', 'gras_blommor_2', 'skogsbotten_ormbunke'],
};

const LEGACY_BIOME_TILES: Record<string, readonly string[]> = {
  trask: ['lera_1', 'lera_2', 'gras_till_lera', 'skogsbotten_lov'],
  fjall: ['lera_2', 'lera_3', 'gras_3'],
  kust: ['lera_1', 'gras_2', 'gras_4'],
  ask: ['lera_3', 'gras_till_lera', 'skogsbotten_ormbunke'],
};

/** Rollpool för ett biom. Okänt biom använder skogen. */
export function groundRolePoolForBiome(biomeId: string): GroundRolePool {
  const id = biomeId || 'skog';
  if (id === 'skog') return SKOG_GROUND_ROLES;
  const tiles = LEGACY_BIOME_TILES[id];
  if (tiles) return toRolePool(tiles);
  return SKOG_GROUND_ROLES;
}

function flattenRolePool(pool: GroundRolePool): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const role of [pool.base, pool.patchA, pool.patchB, pool.rare]) {
    for (const id of role) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out.length > 0 ? out : ['gras_1'];
}

/** Platshållartiles/dekor tills #89/#102 — byts via data utan kod. */
export function biomeRenderPlaceholders(biome: BigWorldBiome | undefined): {
  tilePool: string[];
  decorPool: string[];
  music: 'explore' | 'town';
} {
  const id = biome?.id ?? 'skog';
  const decor: Record<string, string[]> = {
    skog: ['gran', 'bjork', 'runsten', 'vagros_blommor'],
    trask: ['vagros_blommor', 'runsten'],
    fjall: ['runsten', 'vagros_blommor'],
    kust: ['vagros_blommor'],
    ask: ['vagros_blommor', 'runsten'],
  };
  const skogDecor = decor.skog ?? ['vagros_blommor'];
  return {
    tilePool: flattenRolePool(groundRolePoolForBiome(id)),
    decorPool: decor[id] ?? skogDecor,
    music: id === 'skog' ? 'explore' : 'explore',
  };
}

export function isTownBiomeChunk(regionTyp: string | undefined): boolean {
  return regionTyp === 'stad' || regionTyp === 'by' || regionTyp === 'lager';
}
