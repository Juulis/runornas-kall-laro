import { DATA } from '../../data';
import { Rng } from '../../core/Rng';
import { TILE_WORLD } from '../../render/Iso';
import { canonicalBiomeId } from '../../render/biomeAssetGroups';
import { PLAYABLE_CITIES } from '../cityZones';
import { CAMP_SAFE_RADIUS, campFirePos } from './campMonsterField';
import { bigWorldCityPortalWorld } from './bigWorldPortals';
import { chunkTileCount, worldToChunk } from './bigWorldCoords';
import { worldTileIndex } from './groundTiles';
import { isRoadMaskAtWorld, shouldSpawnDecorAt } from './roads';
import { campStartPos } from './startskogenFootprint';
import { worldValueNoise } from './worldNoise';

export type DecorLayer = 'stor' | 'mellan' | 'liten';

export interface DecorLayerPool {
  stor: readonly string[];
  mellan: readonly string[];
  liten: readonly string[];
}

export interface PlannedDecor {
  id: string;
  wx: number;
  wy: number;
  layer: DecorLayer;
  /** 0,35–0,6. Negativ x är spegling. */
  scaleX: number;
  /** 0,35–0,6, alltid positiv. */
  scaleY: number;
  /** Bara lager stor. Mellan och liten är null så man kan gå mellan dungarna. */
  collider: { x: number; y: number; r: number } | null;
}

/** Tak för levande dekorsprites i BigWorldStreamGround. */
export const DECOR_SPRITE_CAP = 1500;

/**
 * Fri radie kring start_pos. Monster använder START_POS_SAFE_RADIUS (22);
 * den ska inte kalhugga lägret.
 */
const START_DECOR_CLEAR = 3;
/** Fri radie kring byportaler så porten inte växer igen. */
const PORTAL_DECOR_CLEAR = 6;
/** Tät dunge: värdebrus över det här. Glänta: under GLADE_BELOW. */
const DENSE_ABOVE = 0.6;
const GLADE_BELOW = 0.3;
/**
 * Livlighet och höjd är samma värdebrus, fast med fasta offset så fälten
 * hänger ihop över chunkgränser men inte är kopior av täthetsbruset.
 * Låg livlighet (< 0,34) är en dödare fläck och föredrar dod_ek.
 * Högt höjdvärde, eller biom fjäll, föredrar fjallbjork när den finns i poolen.
 */
const LIVELINESS_SHIFT_X = 8191;
const LIVELINESS_SHIFT_Y = -4093;
const HIGHLAND_SHIFT_X = -5003;
const HIGHLAND_SHIFT_Y = 7001;
const LIVELINESS_DEAD = 0.34;
const HIGHLAND_PREF = 0.78;
/** Block där steget 3–5 (dunge) är konstant, så rytmen inte hoppar varje ruta. */
const STEP_BLOCK = 16;
const TREE_RADIUS = 0.9;
const ROCK_RADIUS = 0.8;
/**
 * Efter zonreglerna hålls en chunk i det här bandet.
 * Nio synliga chunkar (radie 1) ska landa nära taket 1500, alltså omkring 150–180 per chunk.
 */
const COUNT_LO = 154;
const COUNT_HI = 172;
const MIN_LITEN = 12;

const ROCK_IDS: ReadonlySet<string> = new Set([
  'stenhog',
  'stenblock',
  'stenblock_lav',
  'ruinmur',
  'ruinmur_rasad',
  'ruinmur_horn',
  'pelare',
  'pelare_liggande',
  'hard_kall',
  'hard_glod',
  'stenkors',
  'kristaller',
  'sjunken_bat',
  'sjunken_klocka',
  'gruvoppning',
]);

/** Används bara när biomet saknar dekor_pool i data. */
const FALLBACK_POOLS: Record<string, DecorLayerPool> = {
  skog: {
    stor: ['gran', 'gran_ung', 'bjork', 'dod_ek'],
    mellan: ['buske', 'stenhog', 'stubbe', 'vindfalle', 'runsten', 'rotvalta'],
    liten: ['gras_tuva', 'ormbunkar', 'vagros_blommor'],
  },
  trask: {
    stor: ['dod_tall', 'dod_tall_knackt', 'dod_ek', 'sjunken_bat'],
    mellan: ['stubbe_vatten', 'natstang', 'stubbe', 'myrkors', 'stolprad_rutten', 'sjunken_klocka'],
    liten: ['kaveldun', 'myrull', 'vasstuva', 'vagros_blommor'],
  },
  fjall: {
    stor: ['vindtall', 'vindtall_krokig', 'fjallbjork', 'stenblock', 'stenblock_lav'],
    mellan: ['stenhog', 'stubbe', 'renskalle', 'kristaller', 'buske'],
    liten: ['ljungtuva', 'gras_tuva', 'vagros_blommor'],
  },
  kust: {
    stor: ['sjunken_bat'],
    mellan: ['natstang', 'sjunken_klocka', 'stubbe', 'buske'],
    liten: ['vagros_blommor', 'gras_tuva', 'ormbunkar'],
  },
  ask: {
    stor: ['dod_ek', 'pelare', 'ruinmur_rasad'],
    mellan: ['stenkors', 'ruinmur', 'pelare_liggande', 'stenhog', 'stubbe'],
    liten: ['vagros_blommor', 'gras_tuva', 'ormbunkar'],
  },
};

type ZoneKind = 'dense' | 'mid' | 'glade';

interface Slot {
  gx: number;
  gy: number;
  wanted: DecorLayer;
  onlyLiten: boolean;
}

interface RankedDecor {
  item: PlannedDecor;
  index: number;
  keep: number;
}

let portalCache: readonly { x: number; y: number }[] | null = null;

function decorPortals(): readonly { x: number; y: number }[] {
  if (portalCache) return portalCache;
  portalCache = PLAYABLE_CITIES.map((city) => bigWorldCityPortalWorld(city));
  return portalCache;
}

function copyPool(pool: DecorLayerPool): DecorLayerPool {
  return { stor: [...pool.stor], mellan: [...pool.mellan], liten: [...pool.liten] };
}

function poolSize(pool: DecorLayerPool): number {
  return pool.stor.length + pool.mellan.length + pool.liten.length;
}

function roadAllowsDecor(worldSeed: number, wx: number, wy: number, extra = 0): boolean {
  if (extra > 0) return !isRoadMaskAtWorld(worldSeed, wx, wy, extra);
  return shouldSpawnDecorAt(worldSeed, wx, wy);
}

function clearsForbidden(worldSeed: number, wx: number, wy: number, pad: number): boolean {
  const start = campStartPos();
  if (Math.hypot(wx - start.x, wy - start.y) < START_DECOR_CLEAR + pad) return false;
  const fire = campFirePos();
  if (Math.hypot(wx - fire.x, wy - fire.y) < CAMP_SAFE_RADIUS + pad) return false;
  const portalR = PORTAL_DECOR_CLEAR + pad;
  for (const portal of decorPortals()) {
    if (Math.hypot(wx - portal.x, wy - portal.y) < portalR) return false;
  }
  return roadAllowsDecor(worldSeed, wx, wy, pad);
}

/** Alla förbud: säker glänta, start_pos, portaler, och vägmasken när steg 7 finns. */
export function shouldPlaceDecorAt(worldSeed: number, wx: number, wy: number): boolean {
  return clearsForbidden(worldSeed, wx, wy, 0);
}

export function decorPoolForBiome(biomeId: string): DecorLayerPool {
  const id = canonicalBiomeId(biomeId || 'skog');
  const raw = DATA.varldStor.biomer[id]?.dekor_pool;
  if (raw && raw.stor.length + raw.mellan.length + raw.liten.length > 0) return copyPool(raw);
  const fallback = FALLBACK_POOLS[id] ?? FALLBACK_POOLS.skog;
  return copyPool(fallback ?? { stor: [], mellan: [], liten: [] });
}

function zoneAt(noise: number): ZoneKind {
  if (noise > DENSE_ABOVE) return 'dense';
  if (noise < GLADE_BELOW) return 'glade';
  return 'mid';
}

function hash01(worldSeed: number, tag: string, gx: number, gy: number): number {
  return new Rng(Rng.hash(worldSeed, tag, gx, gy)).next();
}

/** Sant på ett världsrutnät med steg stepMin..stepMin+stepSpan-1, stabilt inom STEP_BLOCK. */
function onStepGrid(worldSeed: number, gx: number, gy: number, tag: string, stepMin: number, stepSpan: number): boolean {
  const bx = Math.floor(gx / STEP_BLOCK);
  const by = Math.floor(gy / STEP_BLOCK);
  const step = stepMin + (Rng.hash(worldSeed, tag, bx, by) % stepSpan);
  const lx = gx - bx * STEP_BLOCK;
  const ly = gy - by * STEP_BLOCK;
  return lx % step === 0 && ly % step === 0;
}

function slotForTile(worldSeed: number, gx: number, gy: number): Slot | null {
  const noise = worldValueNoise(worldSeed, gx, gy);
  const zone = zoneAt(noise);
  if (zone === 'glade') {
    if (!onStepGrid(worldSeed, gx, gy, 'glanta-steg', 7, 3)) return null;
    return { gx, gy, wanted: 'liten', onlyLiten: true };
  }
  if (zone === 'dense') {
    if (onStepGrid(worldSeed, gx, gy, 'dung-steg', 3, 3)) {
      const roll = hash01(worldSeed, 'dung-lager', gx, gy);
      const wanted: DecorLayer = roll < 0.74 ? 'stor' : roll < 0.9 ? 'mellan' : 'liten';
      return { gx, gy, wanted, onlyLiten: false };
    }
    if (hash01(worldSeed, 'dung-under', gx, gy) < 0.012) {
      const under: DecorLayer = hash01(worldSeed, 'dung-under-lag', gx, gy) < 0.55 ? 'mellan' : 'liten';
      return { gx, gy, wanted: under, onlyLiten: false };
    }
    return null;
  }
  if (!onStepGrid(worldSeed, gx, gy, 'mellan-steg', 6, 3)) return null;
  const roll = hash01(worldSeed, 'mellan-lager', gx, gy);
  const wanted: DecorLayer = roll < 0.24 ? 'stor' : roll < 0.6 ? 'mellan' : 'liten';
  return { gx, gy, wanted, onlyLiten: false };
}

function resolveLayer(wanted: DecorLayer, pool: DecorLayerPool, onlyLiten: boolean): DecorLayer | null {
  if (onlyLiten) return pool.liten.length > 0 ? 'liten' : null;
  const order: readonly DecorLayer[] =
    wanted === 'stor' ? ['stor', 'mellan', 'liten'] : wanted === 'mellan' ? ['mellan', 'liten', 'stor'] : ['liten', 'mellan', 'stor'];
  for (const layer of order) {
    if (pool[layer].length > 0) return layer;
  }
  return null;
}

function colliderRadius(id: string): number {
  return ROCK_IDS.has(id) ? ROCK_RADIUS : TREE_RADIUS;
}

function pickDecorId(
  worldSeed: number,
  chunkSeed: number,
  gx: number,
  gy: number,
  layer: DecorLayer,
  pool: DecorLayerPool,
  biomeId: string,
): string | null {
  const list = pool[layer];
  if (list.length === 0) return null;
  const rng = new Rng(Rng.hash(worldSeed, chunkSeed, 'dekor-art', gx, gy, layer));
  if (layer !== 'stor') return rng.pick(list);
  const liveliness = worldValueNoise(worldSeed, gx + LIVELINESS_SHIFT_X, gy + LIVELINESS_SHIFT_Y);
  const highland = worldValueNoise(worldSeed, gx + HIGHLAND_SHIFT_X, gy + HIGHLAND_SHIFT_Y);
  const fjall = biomeId === 'fjall';
  if (list.includes('fjallbjork') && (fjall || highland > HIGHLAND_PREF) && rng.chance(fjall ? 0.5 : 0.65)) {
    return 'fjallbjork';
  }
  if (list.includes('dod_ek') && liveliness < LIVELINESS_DEAD && rng.chance(0.6)) return 'dod_ek';
  const ordinary = list.filter((id) => id !== 'dod_ek' && id !== 'fjallbjork');
  if (ordinary.length > 0) return rng.pick(ordinary);
  return rng.pick(list);
}

function materialize(
  worldSeed: number,
  chunkSeed: number,
  cx: number,
  cy: number,
  slot: Slot,
  pool: DecorLayerPool,
  biomeId: string,
): PlannedDecor | null {
  const layer = resolveLayer(slot.wanted, pool, slot.onlyLiten);
  if (!layer) return null;
  const id = pickDecorId(worldSeed, chunkSeed, slot.gx, slot.gy, layer, pool, biomeId);
  if (!id) return null;
  const rng = new Rng(Rng.hash(worldSeed, chunkSeed, 'dekor-form', slot.gx, slot.gy));
  const scale = 0.35 + rng.next() * 0.25;
  const mirror = rng.next() < 0.5;
  const jx = (0.12 + rng.next() * 0.76) * TILE_WORLD;
  const jy = (0.12 + rng.next() * 0.76) * TILE_WORLD;
  const wx = slot.gx * TILE_WORLD + jx;
  const wy = slot.gy * TILE_WORLD + jy;
  const owner = worldToChunk(wx, wy);
  if (owner.cx !== cx || owner.cy !== cy) return null;
  if (!shouldPlaceDecorAt(worldSeed, wx, wy)) return null;
  const radius = layer === 'stor' ? colliderRadius(id) : 0;
  if (radius > 0 && !clearsForbidden(worldSeed, wx, wy, radius)) return null;
  return {
    id,
    wx,
    wy,
    layer,
    scaleX: mirror ? -scale : scale,
    scaleY: scale,
    collider: radius > 0 ? { x: wx, y: wy, r: radius } : null,
  };
}

function collectSlots(worldSeed: number, cx: number, cy: number): Slot[] {
  const tiles = chunkTileCount();
  const slots: Slot[] = [];
  for (let ti = 0; ti < tiles; ti++) {
    for (let tj = 0; tj < tiles; tj++) {
      const { gx, gy } = worldTileIndex(cx, cy, ti, tj);
      const slot = slotForTile(worldSeed, gx, gy);
      if (slot) slots.push(slot);
    }
  }
  return slots;
}

function thinToCap(list: PlannedDecor[], worldSeed: number, chunkSeed: number, pool: DecorLayerPool): PlannedDecor[] {
  if (list.length <= COUNT_HI) return list;
  const ranked: RankedDecor[] = list.map((item, index) => ({
    item,
    index,
    keep:
      new Rng(Rng.hash(worldSeed, chunkSeed, 'gallra', item.wx, item.wy)).next() +
      (item.layer === 'stor' ? 0.08 : item.layer === 'mellan' ? 0.03 : 0),
  }));
  ranked.sort((a, b) => b.keep - a.keep || a.index - b.index);
  const chosen = ranked.slice(0, COUNT_HI);
  const minLiten = pool.liten.length >= 3 ? MIN_LITEN : 0;
  let litenKept = chosen.reduce((n, row) => n + (row.item.layer === 'liten' ? 1 : 0), 0);
  if (litenKept < minLiten) {
    const droppedLiten = ranked.slice(COUNT_HI).filter((row) => row.item.layer === 'liten');
    const replaceable = chosen.filter((row) => row.item.layer !== 'liten').sort((a, b) => a.keep - b.keep);
    let di = 0;
    for (const slot of replaceable) {
      if (litenKept >= minLiten || di >= droppedLiten.length) break;
      const swap = droppedLiten[di];
      di += 1;
      if (!swap) break;
      const at = chosen.indexOf(slot);
      if (at >= 0) chosen[at] = swap;
      litenKept += 1;
    }
  }
  chosen.sort((a, b) => a.index - b.index);
  return chosen.map((row) => row.item);
}

function fillToFloor(
  list: PlannedDecor[],
  worldSeed: number,
  chunkSeed: number,
  cx: number,
  cy: number,
  pool: DecorLayerPool,
  biomeId: string,
): PlannedDecor[] {
  if (list.length >= COUNT_LO || pool.liten.length === 0) return list;
  const occupied = new Set<string>();
  for (const item of list) {
    const gx = Math.floor(item.wx / TILE_WORLD);
    const gy = Math.floor(item.wy / TILE_WORLD);
    occupied.add(`${gx},${gy}`);
  }
  const tiles = chunkTileCount();
  const extra: { gx: number; gy: number; roll: number }[] = [];
  for (let ti = 0; ti < tiles; ti++) {
    for (let tj = 0; tj < tiles; tj++) {
      const { gx, gy } = worldTileIndex(cx, cy, ti, tj);
      if (occupied.has(`${gx},${gy}`)) continue;
      const zone = zoneAt(worldValueNoise(worldSeed, gx, gy));
      const bias = zone === 'glade' ? 0 : zone === 'mid' ? 0.2 : 0.45;
      extra.push({ gx, gy, roll: hash01(worldSeed, 'fyll', gx, gy) + bias });
    }
  }
  extra.sort((a, b) => a.roll - b.roll || a.gx - b.gx || a.gy - b.gy);
  const out = list.slice();
  for (const spot of extra) {
    if (out.length >= COUNT_LO) break;
    const made = materialize(worldSeed, chunkSeed, cx, cy, { gx: spot.gx, gy: spot.gy, wanted: 'liten', onlyLiten: true }, pool, biomeId);
    if (!made) continue;
    out.push(made);
  }
  return out;
}

export function planDecorForChunk(args: {
  worldSeed: number;
  chunkSeed: number;
  cx: number;
  cy: number;
  biomeId: string;
  pool?: DecorLayerPool;
}): PlannedDecor[] {
  const biomeId = canonicalBiomeId(args.biomeId || 'skog');
  const pool = args.pool ?? decorPoolForBiome(biomeId);
  if (poolSize(pool) === 0) return [];
  const placed: PlannedDecor[] = [];
  for (const slot of collectSlots(args.worldSeed, args.cx, args.cy)) {
    const made = materialize(args.worldSeed, args.chunkSeed, args.cx, args.cy, slot, pool, biomeId);
    if (made) placed.push(made);
  }
  const thinned = thinToCap(placed, args.worldSeed, args.chunkSeed, pool);
  return fillToFloor(thinned, args.worldSeed, args.chunkSeed, args.cx, args.cy, pool, biomeId);
}

/**
 * Håller summan av levande sprites under taket.
 * Närmast fokus (hjälten) behålls. Lika långt bort vinner större lager.
 * Ordningen i resultatet följer den planerade listan.
 */
export function applyDecorBudget<T extends { wx: number; wy: number; layer: DecorLayer }>(
  planned: readonly T[],
  alreadyLive: number,
  cap: number,
  focus?: { x: number; y: number },
): T[] {
  const room = Math.max(0, Math.floor(cap - alreadyLive));
  if (room === 0 || planned.length === 0) return [];
  if (planned.length <= room) return planned.slice();
  const fx = focus?.x ?? 0;
  const fy = focus?.y ?? 0;
  const order = planned.map((item, index) => {
    const size = item.layer === 'stor' ? 2 : item.layer === 'mellan' ? 1 : 0;
    return { index, dist: Math.hypot(item.wx - fx, item.wy - fy), size };
  });
  order.sort((a, b) => a.dist - b.dist || b.size - a.size || a.index - b.index);
  const keep = new Set(order.slice(0, room).map((row) => row.index));
  return planned.filter((_, index) => keep.has(index));
}
