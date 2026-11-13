import type { BigWorldBiome, BigWorldBiomeMarkset } from '../../data/bigWorldTypes';
import varldStor from '../../data/varld_stor.json';
import { decorPoolForBiome, type DecorLayerPool } from './decorPlanner';
import type { GroundRolePool } from './groundTiles';

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
 * Skogens mark. Bas är gräs, fläck A skogsbotten, fläck B mossa, sällsynt blommor och ormbunke.
 * Samma plattor som varld_stor.biomer.skog.markset. Används om json saknar markset.
 */
export const SKOG_GROUND_ROLES: GroundRolePool = {
  base: ['gras_1', 'gras_2', 'gras_3', 'gras_4'],
  patchA: ['skogsbotten_lov', 'skogsbotten_barr_1', 'skogsbotten_barr_2'],
  patchB: ['mossa_1', 'mossa_2'],
  rare: ['gras_blommor_1', 'gras_blommor_2', 'skogsbotten_ormbunke'],
};

/** Reservpooler när biomet saknar markset. Samma plattor som i varld_stor.json. */
const DEFAULT_BIOME_GROUND_ROLES: Record<string, GroundRolePool> = {
  skog: SKOG_GROUND_ROLES,
  trask: {
    base: ['myr_1', 'myr_2', 'myr_3', 'myr_4'],
    patchA: ['torv_1', 'torv_2'],
    patchB: ['vassmark_1', 'vassmark_2'],
    rare: ['myr_gol_1', 'myr_gol_2'],
  },
  fjall: {
    base: ['grus_1', 'grus_2'],
    patchA: ['ljung_1', 'ljung_2', 'ljung_3', 'ljung_4'],
    patchB: ['berghall_1', 'berghall_2'],
    rare: ['bergsvag_1', 'bergsvag_2', 'snoflack_1', 'snoflack_2'],
  },
  kust: {
    base: ['grus_2'],
    patchA: ['lera_1', 'lera_2', 'lera_3'],
    patchB: ['gras_4'],
    rare: ['kullersten'],
  },
  ask: {
    base: ['aska'],
    patchA: ['ruin_grus'],
    patchB: ['lera_3'],
    rare: ['stengolv_sprucket_1', 'stengolv_sprucket_2'],
  },
};

function copyTileIds(ids: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const id of ids ?? []) {
    if (id.length > 0) out.push(id);
  }
  return out;
}

/** bas → base, flack_a → patchA, flack_b → patchB, sallsynt → rare. Tom bas räknas inte. */
function poolFromMarkset(markset: BigWorldBiomeMarkset | undefined): GroundRolePool | null {
  if (!markset) return null;
  const base = copyTileIds(markset.bas);
  if (base.length === 0) return null;
  return {
    base,
    patchA: copyTileIds(markset.flack_a),
    patchB: copyTileIds(markset.flack_b),
    rare: copyTileIds(markset.sallsynt),
  };
}

function marksetFromData(biomeId: string): BigWorldBiomeMarkset | undefined {
  const biomer = (varldStor as { biomer?: Record<string, { markset?: BigWorldBiomeMarkset }> }).biomer;
  return biomer?.[biomeId]?.markset;
}

function resolveGroundRoles(biomeId: string): GroundRolePool {
  return poolFromMarkset(marksetFromData(biomeId)) ?? DEFAULT_BIOME_GROUND_ROLES[biomeId] ?? SKOG_GROUND_ROLES;
}

/** Rollpooler för de fem biomen. Markset i varld_stor vinner över reserven. */
export const BIOME_GROUND_ROLES: Record<string, GroundRolePool> = {
  skog: resolveGroundRoles('skog'),
  trask: resolveGroundRoles('trask'),
  fjall: resolveGroundRoles('fjall'),
  kust: resolveGroundRoles('kust'),
  ask: resolveGroundRoles('ask'),
};

/** Rollpool för ett biom. Okänt eller tomt id ger skogen. */
export function groundRolePoolForBiome(biomeId: string): GroundRolePool {
  const id = biomeId || 'skog';
  return BIOME_GROUND_ROLES[id] ?? BIOME_GROUND_ROLES.skog ?? SKOG_GROUND_ROLES;
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

/** Korta listor om biomet saknar dekor_pool. Lagerpoolen kommer ändå från decorPoolForBiome. */
const LEGACY_DECOR: Record<string, readonly string[]> = {
  skog: ['gran', 'bjork', 'runsten', 'vagros_blommor'],
  trask: ['vagros_blommor', 'runsten'],
  fjall: ['runsten', 'vagros_blommor'],
  kust: ['vagros_blommor'],
  ask: ['vagros_blommor', 'runsten'],
};

function hasDecorPool(pool: { stor: readonly string[]; mellan: readonly string[]; liten: readonly string[] } | undefined): boolean {
  return !!pool && pool.stor.length + pool.mellan.length + pool.liten.length > 0;
}

/** Mark och dekor för en chunk. dekor_pool plattas ut till decorPool när fältet finns. */
export function biomeRenderPlaceholders(biome: BigWorldBiome | undefined): {
  tilePool: string[];
  decorPool: string[];
  decorLayers: DecorLayerPool;
  music: 'explore' | 'town';
} {
  const id = biome?.id ?? 'skog';
  const raw = biome?.dekor_pool;
  const decorLayers =
    hasDecorPool(raw) && raw ? { stor: [...raw.stor], mellan: [...raw.mellan], liten: [...raw.liten] } : decorPoolForBiome(id);
  const legacy = LEGACY_DECOR[id] ?? LEGACY_DECOR.skog ?? ['vagros_blommor'];
  const decorPool = hasDecorPool(raw) && raw ? [...raw.stor, ...raw.mellan, ...raw.liten] : [...legacy];
  return {
    tilePool: flattenRolePool(groundRolePoolForBiome(id)),
    decorPool,
    decorLayers,
    music: 'explore',
  };
}

export function isTownBiomeChunk(regionTyp: string | undefined): boolean {
  return regionTyp === 'stad' || regionTyp === 'by' || regionTyp === 'lager';
}
