import { Rng } from '../../core/Rng';
import { TILE_WORLD } from '../../render/Iso';
import { EDGE_SUFFIXES, TILES, canonicalBiomeId } from '../../render/biomeAssetGroups';
import type { BiomeWeight } from './biomeBlend';
import { groundRolePoolForBiome } from './biomeBlend';
import { chunkTileCount, worldToChunk } from './bigWorldCoords';
import { pickChunkGroundTileId, worldTileIndex } from './groundTiles';
import { chunkRegionBiome, getBigWorldCatalog, type BigWorldCatalog } from './worldGenerator';

/**
 * Mjuka biomgränser. Ingen Pixi.
 * Blandzonen är 6 rutor från den effektiva gränsen. Gränslinjen själv
 * får vandra högst 6 rutor med brus från worldSeed, så den inte följer chunkkanten.
 */

/** Rutor från en biomgräns där mark och dekor fortfarande blandas. */
export const BIOME_BLEND_WIDTH = 6;

/** Hur långt bruset får skjuta själva gränslinjen, i rutor. */
const BORDER_SHIFT_MAX = 6;

/** Lågfrekvent: ungefär en våg per 48 rutor, så kanten blir en båge och inte taggar. */
const SHIFT_PERIOD = 48;

export type BiomeLookup = (cx: number, cy: number) => string;

/**
 * Familj i filnamnet `<a>_till_<b>`. Skog möter andra biom med mossa,
 * träsk med myr, fjäll med ljung och aska med aska. Kust saknar eget par.
 */
const BIOME_FAMILY: Record<string, string> = {
  skog: 'mossa',
  trask: 'myr',
  fjall: 'ljung',
  ask: 'aska',
};

/**
 * 4-bitars grannmask, samma axlar som steg 12: N är −y, O är +x, S är +y, V är −x.
 * Bit sätts när den grannen hör till b-sidan i `<a>_till_<b>`.
 *
 * Iso-diamanten (128×64) har b-färgen så här på ljung_till_mossa:
 *   oh längs N, nh längs O, nv längs S, ov längs V.
 *   oh_nh fyller N+O, nh_nv fyller O+S, nv_ov fyller S+V, ov_oh fyller N+V.
 *   horn_h är den lilla spetsen mellan N och O, horn_n mellan O och S,
 *   horn_v mellan S och V, horn_o mellan N och V.
 * Två angränsande b-grannar tar den sammansatta kanten. Saknas den används hornet.
 * Mask 0, motstående sidor (N+S, O+V), tre sidor och alla fyra har ingen tile.
 */
const N_BIT = 1;
const O_BIT = 2;
const S_BIT = 4;
const V_BIT = 8;

const SIDE_SUFFIX: readonly (string | null)[] = [
  null,
  'oh',
  'nh',
  'oh_nh',
  'nv',
  null,
  'nh_nv',
  null,
  'ov',
  'ov_oh',
  null,
  null,
  'nv_ov',
  null,
  null,
  null,
];

const HORN_SUFFIX: readonly (string | null)[] = [
  null,
  null,
  null,
  'horn_h',
  null,
  null,
  'horn_n',
  null,
  null,
  'horn_o',
  null,
  null,
  'horn_v',
  null,
  null,
  null,
];

interface ParsedTransition {
  prefix: string;
  suffix: string;
  variant: boolean;
}

const SUFFIX_BY_LENGTH = [...EDGE_SUFFIXES].sort((a, b) => b.length - a.length);
const TILE_SET = new Set<string>(TILES);
const pairSuffixes = new Map<string, Set<string>>();

function matchSuffix(id: string): { prefix: string; suffix: string } | null {
  for (const suffix of SUFFIX_BY_LENGTH) {
    const tail = `_${suffix}`;
    if (!id.endsWith(tail) || id.length <= tail.length) continue;
    const prefix = id.slice(0, -tail.length);
    if (!prefix.includes('_till_')) return null;
    return { prefix, suffix };
  }
  return null;
}

function parseTransitionId(id: string): ParsedTransition | null {
  if (id.endsWith('_2')) {
    const base = matchSuffix(id.slice(0, -2));
    if (!base) return null;
    return { prefix: base.prefix, suffix: base.suffix, variant: true };
  }
  const base = matchSuffix(id);
  if (!base) return null;
  return { prefix: base.prefix, suffix: base.suffix, variant: false };
}

for (const id of TILES) {
  const parsed = parseTransitionId(id);
  if (!parsed) continue;
  if (parsed.variant) continue;
  let known = pairSuffixes.get(parsed.prefix);
  if (!known) {
    known = new Set();
    pairSuffixes.set(parsed.prefix, known);
  }
  known.add(parsed.suffix);
}

/** Föredragen suffix för masken, eller null när ingen tile hör dit. */
export function transitionSuffixForMask(mask: number): string | null {
  if (mask < 0 || mask > 15) return null;
  return SIDE_SUFFIX[mask] ?? null;
}

/** Hörnspets om den sammansatta kanten saknas. Bara för två angränsande b-grannar. */
export function transitionHornForMask(mask: number): string | null {
  if (mask < 0 || mask > 15) return null;
  return HORN_SUFFIX[mask] ?? null;
}

/**
 * Tile-id för paret och masken. `variantRoll` i [0, 1) får välja `_2` när den filen finns.
 * Utan roll används grundfilen. Saknas suffixet: null, aldrig ett påhittat id.
 */
export function resolveTransitionTileId(
  prefix: string,
  mask: number,
  variantRoll?: number,
  ids: ReadonlySet<string> = TILE_SET,
): string | null {
  const primary = transitionSuffixForMask(mask);
  const horn = transitionHornForMask(mask);
  const suffix = primary && ids.has(`${prefix}_${primary}`) ? primary : horn && ids.has(`${prefix}_${horn}`) ? horn : null;
  if (!suffix) return null;
  const base = `${prefix}_${suffix}`;
  if (variantRoll === undefined) return ids.has(base) ? base : null;
  const alt = `${base}_2`;
  if (ids.has(alt) && variantRoll < 0.35) return alt;
  return ids.has(base) ? base : null;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

let latticeSeed = Number.NaN;
const latticeMemo = new Map<string, number>();

function lattice(seed: number, ix: number, iy: number): number {
  if (seed !== latticeSeed) {
    latticeMemo.clear();
    latticeSeed = seed;
  }
  const key = `${ix},${iy}`;
  const hit = latticeMemo.get(key);
  if (hit !== undefined) return hit;
  const value = new Rng(Rng.hash(seed, 'biomkant', ix, iy)).next();
  latticeMemo.set(key, value);
  return value;
}

function borderNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const v00 = lattice(seed, x0, y0);
  const v10 = lattice(seed, x0 + 1, y0);
  const v01 = lattice(seed, x0, y0 + 1);
  const v11 = lattice(seed, x0 + 1, y0 + 1);
  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
}

/** Förskjutning i rutor, [-BORDER_SHIFT_MAX, BORDER_SHIFT_MAX], längs en chunkkant. */
function edgeShift(worldSeed: number, axis: 'x' | 'y', edge: number, along: number): number {
  const lane = (axis === 'x' ? edge * 2 : edge * 2 + 1) * 3.1;
  const n = borderNoise(worldSeed, along / SHIFT_PERIOD, lane);
  return (n - 0.5) * (2 * BORDER_SHIFT_MAX);
}

let cachedCatalog: BigWorldCatalog | null = null;
const catalogMemo = new Map<string, string>();
let boundLookup: BiomeLookup | null = null;
let customLookup: BiomeLookup | null = null;
const customMemo = new Map<string, string>();
const uniformMemo = new Map<string, boolean>();

function catalogBiome(cx: number, cy: number): string {
  const catalog = getBigWorldCatalog();
  if (catalog !== cachedCatalog) {
    catalogMemo.clear();
    uniformMemo.clear();
    cachedCatalog = catalog;
  }
  const key = `${cx},${cy}`;
  const hit = catalogMemo.get(key);
  if (hit !== undefined) return hit;
  const id = canonicalBiomeId(chunkRegionBiome(cx, cy, catalog) || 'skog');
  catalogMemo.set(key, id);
  return id;
}

function customBiome(cx: number, cy: number): string {
  const lookup = customLookup;
  if (!lookup) return 'skog';
  const key = `${cx},${cy}`;
  const hit = customMemo.get(key);
  if (hit !== undefined) return hit;
  const id = canonicalBiomeId(lookup(cx, cy) || 'skog');
  customMemo.set(key, id);
  return id;
}

function bindLookup(lookup?: BiomeLookup): BiomeLookup {
  const token = lookup ?? null;
  if (boundLookup !== token) {
    customMemo.clear();
    uniformMemo.clear();
    boundLookup = token;
    customLookup = lookup ?? null;
  }
  return lookup ? customBiome : catalogBiome;
}

function regionIsUniform(cx: number, cy: number, lookup: BiomeLookup): boolean {
  const key = `${cx},${cy}`;
  const hit = uniformMemo.get(key);
  if (hit !== undefined) return hit;
  const id = lookup(cx, cy);
  let same = true;
  for (let dy = -1; dy <= 1 && same; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (lookup(cx + dx, cy + dy) !== id) {
        same = false;
        break;
      }
    }
  }
  uniformMemo.set(key, same);
  return same;
}

/** Chunkens primära biom. Lookup i tester får ersätta katalogen. */
export function biomeIdAtChunk(cx: number, cy: number, lookup?: BiomeLookup): string {
  return bindLookup(lookup)(cx, cy);
}

interface TilePlace {
  cx: number;
  cy: number;
  ti: number;
  tj: number;
}

function placeOf(gx: number, gy: number): TilePlace {
  const chunk = worldToChunk(gx * TILE_WORLD, gy * TILE_WORLD);
  const origin = worldTileIndex(chunk.cx, chunk.cy, 0, 0);
  return { cx: chunk.cx, cy: chunk.cy, ti: gx - origin.gx, tj: gy - origin.gy };
}

interface NearBorder {
  dist: number;
  /** Positiv: öster om en lodrät kant, eller söder om en vågrät. */
  signed: number;
  negBiome: string;
  posBiome: string;
}

function nearer(best: NearBorder | null, dist: number, signed: number, negBiome: string, posBiome: string): NearBorder | null {
  if (negBiome === posBiome) return best;
  if (!best || dist < best.dist) return { dist, signed, negBiome, posBiome };
  return best;
}

function nearestBorder(worldSeed: number, gx: number, gy: number, lookup: BiomeLookup): NearBorder | null {
  const place = placeOf(gx, gy);
  const tiles = chunkTileCount();
  const edgeDist = Math.min(place.ti, place.tj, tiles - 1 - place.ti, tiles - 1 - place.tj);
  if (edgeDist >= BIOME_BLEND_WIDTH + BORDER_SHIFT_MAX) return null;

  let best: NearBorder | null = null;
  const { cx, cy } = place;

  for (const edgeCx of [cx, cx + 1]) {
    const edgeX = worldTileIndex(edgeCx, 0, 0, 0).gx;
    for (let segCy = cy - 1; segCy <= cy + 1; segCy++) {
      const y0 = worldTileIndex(0, segCy, 0, 0).gy;
      const y1 = y0 + tiles - 1;
      const yClose = Math.max(y0, Math.min(y1, gy));
      const shift = edgeShift(worldSeed, 'x', edgeCx, yClose);
      const dx = gx - (edgeX - 0.5 + shift);
      const dy = gy - yClose;
      best = nearer(best, Math.hypot(dx, dy), dx, lookup(edgeCx - 1, segCy), lookup(edgeCx, segCy));
    }
  }

  for (const edgeCy of [cy, cy + 1]) {
    const edgeY = worldTileIndex(0, edgeCy, 0, 0).gy;
    for (let segCx = cx - 1; segCx <= cx + 1; segCx++) {
      const x0 = worldTileIndex(segCx, 0, 0, 0).gx;
      const x1 = x0 + tiles - 1;
      const xClose = Math.max(x0, Math.min(x1, gx));
      const shift = edgeShift(worldSeed, 'y', edgeCy, xClose);
      const dy = gy - (edgeY - 0.5 + shift);
      const dx = gx - xClose;
      best = nearer(best, Math.hypot(dx, dy), dy, lookup(segCx, edgeCy - 1), lookup(segCx, edgeCy));
    }
  }

  return best;
}

interface TileField {
  biomeId: string;
  weights: BiomeWeight[];
  blend: boolean;
  distance: number;
}

function fieldAt(worldSeed: number, gx: number, gy: number, lookup: BiomeLookup): TileField {
  const place = placeOf(gx, gy);
  const home = lookup(place.cx, place.cy);
  if (regionIsUniform(place.cx, place.cy, lookup)) {
    return { biomeId: home, weights: [{ biomeId: home, weight: 1 }], blend: false, distance: Number.POSITIVE_INFINITY };
  }
  const border = nearestBorder(worldSeed, gx, gy, lookup);
  if (!border || border.dist > BIOME_BLEND_WIDTH) {
    return { biomeId: home, weights: [{ biomeId: home, weight: 1 }], blend: false, distance: border?.dist ?? Number.POSITIVE_INFINITY };
  }
  const t = Math.max(-1, Math.min(1, border.signed / BIOME_BLEND_WIDTH));
  const posW = (t + 1) / 2;
  const negW = 1 - posW;
  const weights: BiomeWeight[] = [];
  if (negW > 1e-6) weights.push({ biomeId: border.negBiome, weight: negW });
  if (posW > 1e-6) weights.push({ biomeId: border.posBiome, weight: posW });
  const sum = weights.reduce((acc, row) => acc + row.weight, 0);
  if (sum <= 0) return { biomeId: home, weights: [{ biomeId: home, weight: 1 }], blend: true, distance: border.dist };
  if (Math.abs(sum - 1) > 1e-6) {
    for (const row of weights) row.weight /= sum;
  }
  const biomeId = border.signed >= 0 ? border.posBiome : border.negBiome;
  return { biomeId, weights, blend: true, distance: border.dist };
}

function fieldFor(worldSeed: number, gx: number, gy: number, lookup?: BiomeLookup): TileField {
  return fieldAt(worldSeed, gx, gy, bindLookup(lookup));
}

/** Avstånd i rutor till närmaste biomgräns. Över bredden, eller Infinity, betyder rent biom. */
export function biomeBorderDistanceTiles(worldSeed: number, gx: number, gy: number, lookup?: BiomeLookup): number {
  return fieldFor(worldSeed, gx, gy, lookup).distance;
}

export function isBiomeBlendTile(worldSeed: number, gx: number, gy: number, lookup?: BiomeLookup): boolean {
  return fieldFor(worldSeed, gx, gy, lookup).blend;
}

/** Vikter som summerar till 1. En post när rutan inte ligger i blandzonen. */
export function blendWeightsAtTile(worldSeed: number, gx: number, gy: number, lookup?: BiomeLookup): BiomeWeight[] {
  return fieldFor(worldSeed, gx, gy, lookup).weights;
}

/** Biom efter brusförskjutningen. Utanför blandzonen är det chunkens eget biom. */
export function effectiveBiomeAtTile(worldSeed: number, gx: number, gy: number, lookup?: BiomeLookup): string {
  return fieldFor(worldSeed, gx, gy, lookup).biomeId;
}

/** Välj biom med vikterna. Samma seed och ruta ger alltid samma val. */
export function pickWeightedBiomeId(worldSeed: number, gx: number, gy: number, weights: readonly BiomeWeight[]): string {
  const first = weights[0];
  if (!first) return 'skog';
  if (weights.length === 1) return first.biomeId;
  const roll = new Rng(Rng.hash(worldSeed, 'biomfrans', gx, gy)).next();
  let acc = 0;
  for (const row of weights) {
    acc += row.weight;
    if (roll < acc) return row.biomeId;
  }
  return weights[weights.length - 1]?.biomeId ?? first.biomeId;
}

function familyOf(biomeId: string): string | null {
  return BIOME_FAMILY[biomeId] ?? null;
}

function prefixOwnedBy(ownBiome: string, otherBiome: string): { prefix: string; otherBiome: string } | null {
  const ownFamily = familyOf(ownBiome);
  const otherFamily = familyOf(otherBiome);
  if (!ownFamily || !otherFamily || ownFamily === otherFamily) return null;
  const forward = `${ownFamily}_till_${otherFamily}`;
  if (pairSuffixes.has(forward)) return { prefix: forward, otherBiome };
  return null;
}

function neighborMask(bBiome: string, north: string, east: string, south: string, west: string): number {
  let mask = 0;
  if (north === bBiome) mask |= N_BIT;
  if (east === bBiome) mask |= O_BIT;
  if (south === bBiome) mask |= S_BIT;
  if (west === bBiome) mask |= V_BIT;
  return mask;
}

function transitionAt(worldSeed: number, gx: number, gy: number, own: string, lookup: BiomeLookup): string | null {
  const north = fieldAt(worldSeed, gx, gy - 1, lookup).biomeId;
  const east = fieldAt(worldSeed, gx + 1, gy, lookup).biomeId;
  const south = fieldAt(worldSeed, gx, gy + 1, lookup).biomeId;
  const west = fieldAt(worldSeed, gx - 1, gy, lookup).biomeId;
  const others: string[] = [];
  for (const id of [north, east, south, west]) {
    if (id !== own && !others.includes(id)) others.push(id);
  }
  const roll = new Rng(Rng.hash(worldSeed, 'kantvar', gx, gy)).next();
  for (const other of others) {
    const pair = prefixOwnedBy(own, other);
    if (!pair) continue;
    const mask = neighborMask(pair.otherBiome, north, east, south, west);
    const tileId = resolveTransitionTileId(pair.prefix, mask, roll);
    if (tileId) return tileId;
  }
  return null;
}

/**
 * Markplatta för en världsruta. Bara worldSeed, (gx, gy) och biomkartan ingår,
 * så två chunkar som frågar om samma ruta får samma svar.
 * Utanför blandzonen: exakt pickChunkGroundTileId med biomets rollpool.
 */
export function pickBlendedGroundTileId(worldSeed: number, gx: number, gy: number, lookup?: BiomeLookup): string {
  const resolved = bindLookup(lookup);
  const field = fieldAt(worldSeed, gx, gy, resolved);
  if (!field.blend) return pickChunkGroundTileId(worldSeed, gx, gy, groundRolePoolForBiome(field.biomeId));
  const transition = transitionAt(worldSeed, gx, gy, field.biomeId, resolved);
  if (transition) return transition;
  const chosen = pickWeightedBiomeId(worldSeed, gx, gy, field.weights);
  return pickChunkGroundTileId(worldSeed, gx, gy, groundRolePoolForBiome(chosen));
}
