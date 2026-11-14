import { canonicalBiomeId } from '../../render/biomeAssetGroups';
import { roadMaskAtWorldTile, roadMaskHitAt, roadTileIdAt } from './roads';

/**
 * Vilken handritad vägfamilj en ruta hör till.
 * Samma grova uppdelning som tilePair i roads.ts.
 */
export const ROAD_FAMILIES = ['stig_jord', 'vag_sten', 'vag_grus', 'spang'] as const;
export type RoadFamily = (typeof ROAD_FAMILIES)[number];

/**
 * 4-bitars grannmask. N är −y och diamantens topp, O är +x (höger),
 * S är +y (botten), V är −x (vänster). Se roadMaskPixels.ts.
 */
export const ROAD_MASK_N = 1;
export const ROAD_MASK_O = 2;
export const ROAD_MASK_S = 4;
export const ROAD_MASK_V = 8;

const enabledFamilies = new Set<RoadFamily>(ROAD_FAMILIES);

function isRoadFamily(value: string): value is RoadFamily {
  return (ROAD_FAMILIES as readonly string[]).includes(value);
}

/** Slå på eller av en hel familj. Av betyder att utfransningen från steg 7 används. */
export function setRoadMaskFamilyEnabled(family: RoadFamily, on: boolean): void {
  if (on) enabledFamilies.add(family);
  else enabledFamilies.delete(family);
}

export function roadMaskFamilyEnabled(family: RoadFamily): boolean {
  return enabledFamilies.has(family);
}

/**
 * N=1, O=2, S=4, V=8.
 * Granne räknas som väg om den rutan ligger på vägmasken (mitt eller kant).
 * Samma (seed, gx, gy) ger samma mask oavsett vilken chunk som frågar.
 * Skicka isRoad för att prova en liten form utan världens mask.
 */
export function roadNeighborMask(worldSeed: number, gx: number, gy: number, isRoad?: (gx: number, gy: number) => boolean): number {
  const on = isRoad ?? ((x: number, y: number) => roadMaskAtWorldTile(worldSeed, x, y));
  let mask = 0;
  if (on(gx, gy - 1)) mask |= ROAD_MASK_N;
  if (on(gx + 1, gy)) mask |= ROAD_MASK_O;
  if (on(gx, gy + 1)) mask |= ROAD_MASK_S;
  if (on(gx - 1, gy)) mask |= ROAD_MASK_V;
  return mask;
}

/** Familj från vägtyp och biom. Deterministisk, samma grenar som tilePair. */
export function roadFamilyAt(typ: string, biomeId: string): RoadFamily {
  const biome = canonicalBiomeId(biomeId);
  const vagEllerStig = typ === 'väg' || typ === 'stig';
  if (typ === 'spång' || (vagEllerStig && biome === 'trask')) return 'spang';
  if (typ === 'bergspass' || (vagEllerStig && biome === 'fjall')) return 'vag_grus';
  if (typ === 'väg' || typ === 'gata') return 'vag_sten';
  if (typ === 'stig' || typ === 'ebbstig') return 'stig_jord';
  return 'vag_sten';
}

function maskIndex(mask: number): number {
  if (!Number.isFinite(mask)) return 0;
  const m = mask | 0;
  if (m < 0) return 0;
  if (m > 15) return 15;
  return m;
}

/**
 * Id enligt planen. Spång heter spang_mask_00..15, de andra familj_00..15.
 */
export function roadMaskTileId(family: RoadFamily, mask: number): string {
  const nn = maskIndex(mask).toString().padStart(2, '0');
  if (family === 'spang') return `spang_mask_${nn}`;
  return `${family}_${nn}`;
}

export function parseRoadMaskTileId(id: string): { family: RoadFamily; mask: number } | null {
  const named = /^(stig_jord|vag_sten|vag_grus)_(\d{2})$/.exec(id);
  if (named) {
    const family = named[1];
    const raw = named[2];
    if (!family || !raw || !isRoadFamily(family)) return null;
    const mask = Number(raw);
    if (mask > 15) return null;
    return { family, mask };
  }
  const spang = /^spang_mask_(\d{2})$/.exec(id);
  const raw = spang?.[1];
  if (!raw) return null;
  const mask = Number(raw);
  if (mask > 15) return null;
  return { family: 'spang', mask };
}

function catalogIds(): readonly string[] {
  const ids: string[] = [];
  for (const family of ROAD_FAMILIES) {
    for (let mask = 0; mask < 16; mask++) ids.push(roadMaskTileId(family, mask));
  }
  return ids;
}

/** De 64 procedur-id:na. De ligger inte i TILES och har ingen png. */
export const ROAD_MASK_TILES: readonly string[] = catalogIds();

const roadMaskTileSet = new Set(ROAD_MASK_TILES);

export function isProceduralRoadTile(id: string): boolean {
  return roadMaskTileSet.has(id);
}

/**
 * Id om familjens mask-tile finns (procedur eller hasTile).
 * Annars null, och anroparen använder utfransningen från steg 7.
 * Utan hasTile gäller den inbyggda katalogen: alla fyra familjer i v1, tills någon stängs av.
 */
export function resolveRoadMaskTile(family: RoadFamily, mask: number, hasTile?: (id: string) => boolean): string | null {
  const id = roadMaskTileId(family, mask);
  if (!isProceduralRoadTile(id)) return null;
  if (hasTile) return hasTile(id) ? id : null;
  if (!enabledFamilies.has(family)) return null;
  return id;
}

/**
 * Tile som ska ritas ovanpå marken.
 * Mask-id när familjen finns, annars samma id som roadTileIdAt (frans + tile-par).
 */
export function roadSurfaceTileIdAt(
  worldSeed: number,
  cx: number,
  cy: number,
  ti: number,
  tj: number,
  biomeId: string,
  hasTile?: (id: string) => boolean,
): string | null {
  const hit = roadMaskHitAt(worldSeed, cx, cy, ti, tj);
  if (!hit) return null;
  const family = roadFamilyAt(hit.typ, biomeId);
  const mask = roadNeighborMask(worldSeed, hit.gx, hit.gy);
  const resolved = resolveRoadMaskTile(family, mask, hasTile);
  if (resolved) return resolved;
  return roadTileIdAt(worldSeed, cx, cy, ti, tj, biomeId);
}
