import { DATA } from '../../data';
import type { BigWorldRegion, BigWorldRoad } from '../../data/bigWorldTypes';
import { Rng } from '../../core/Rng';
import type { Key, Params } from '../../i18n/types';
import type { PlayableCityZone } from '../cityZones';
import { TILE_WORLD } from '../../render/Iso';
import { chunkMinWorld, worldToChunk } from './bigWorldCoords';
import { bigWorldCityPortalWorld } from './bigWorldPortals';
import { isRoadMaskAtWorld, registerDecorKeepout, roadAnchorWorld, roadCenterTileDistance, roadIsDrawn, roadPolylineWorld } from './roads';

/**
 * Vägvisare, milstenar, lyktor och välkomststenar.
 * Ren data från worldSeed. Ingen Pixi. BigWorldStreamGround ritar listan.
 * Skyltar och milstenar står bredvid vägen. Inga kolliderare.
 */

export type WaymarkKind = 'sign' | 'milestone' | 'lamp' | 'portal_stone';

export interface Waymark {
  kind: WaymarkKind;
  wx: number;
  wy: number;
  /** i18n-nyckel för skylt eller milsten. Lyktor och välkomststenar saknar text. */
  textKey?: Key;
  params?: Record<string, string | number>;
  /** Region eller by som skylten hör till. */
  regionId?: string;
  /** Vägar som möts eller slutar här, eller vägen en milsten följer. */
  roadIds?: string[];
  assetId: string;
}

const SIGN_ASSET = 'anslagstavla';
const LAMP_ASSET = 'fackla_stolpe';
const STONE_ASSET = 'orange_portal';

const DEDUPE_WORLD = 8;
const BESIDE_DIST = [5, 6.5, 8, 9.2] as const;
const MILESTONE_STEP = 40;
const MILESTONE_CLEAR = 16;

/** Svenska strängar är region.namn. Städernas engelska matchar map.zones. */
export const REGION_LABEL_KEYS = {
  startlagret: 'map.regions.startlagret',
  vargaby: 'map.regions.vargaby',
  startskogen: 'map.regions.startskogen',
  ulvhilds_ide: 'map.regions.ulvhilds_ide',
  kopparberg: 'map.regions.kopparberg',
  gravasen: 'map.regions.gravasen',
  gamla_byn: 'map.regions.gamla_byn',
  kapellets_krypta: 'map.regions.kapellets_krypta',
  jarnklostret: 'map.regions.jarnklostret',
  gruvdjupen: 'map.regions.gruvdjupen',
  dimmerstrand: 'map.regions.dimmerstrand',
  kolarmon: 'map.regions.kolarmon',
  korpholmarna: 'map.regions.korpholmarna',
  sjunkna_kyrkan: 'map.regions.sjunkna_kyrkan',
  askeborg: 'map.regions.askeborg',
  askfalten: 'map.regions.askfalten',
  kultens_katakomber: 'map.regions.kultens_katakomber',
  katedralen: 'map.regions.katedralen',
  ruttmarken: 'map.regions.ruttmarken',
  sprickans_botten: 'map.regions.sprickans_botten',
  sista_ljuset: 'map.regions.sista_ljuset',
} as const satisfies Record<string, Key>;

const PORTAL_TOWNS: readonly { city: PlayableCityZone; regionId: string }[] = [
  { city: 'wolfstead', regionId: 'vargaby' },
  { city: 'dimmerstrand', regionId: 'dimmerstrand' },
  { city: 'kopparberg', regionId: 'kopparberg' },
  { city: 'askeborg', regionId: 'askeborg' },
];

interface Pt {
  x: number;
  y: number;
}

interface SignSpot {
  x: number;
  y: number;
  regionId: string;
  roadIds: string[];
}

const cache = new Map<number, Waymark[]>();

export function regionMapLabelKey(regionId: string): Key {
  const known = REGION_LABEL_KEYS[regionId as keyof typeof REGION_LABEL_KEYS];
  if (known) return known;
  return `map.regions.${regionId}` as Key;
}

export function hasRegionMapLabel(regionId: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGION_LABEL_KEYS, regionId);
}

/** Kartetikett och skylt delar nyckel. Utan översättare används region.namn. */
export function regionMapLabel(regionId: string, namn: string, t?: (key: Key, params?: Params) => string): string {
  if (t && hasRegionMapLabel(regionId)) {
    const text = t(regionMapLabelKey(regionId));
    if (text) return text;
  }
  return namn || regionId;
}

/** Visningstext. Milstenens platsnamn slås upp från regionId så språket kan bytas. */
export function waymarkCaption(wm: Waymark, t?: (key: Key, params?: Params) => string): string {
  if (wm.kind === 'lamp' || wm.kind === 'portal_stone') return '';
  if (wm.kind === 'milestone' && wm.regionId) {
    const hundreds = typeof wm.params?.hundreds === 'number' ? wm.params.hundreds : 0;
    if (!t) return `${regionNamn(wm.regionId)} ${hundreds}`;
    const place = t(regionMapLabelKey(wm.regionId));
    return t('map.milestone', { place, hundreds });
  }
  if (wm.textKey && t) return t(wm.textKey, wm.params);
  if (wm.regionId) return regionNamn(wm.regionId);
  return '';
}

export function planWaymarks(worldSeed: number): Waymark[] {
  const hit = cache.get(worldSeed);
  if (hit) return hit;
  const built = buildWaymarks(worldSeed);
  cache.set(worldSeed, built);
  return built;
}

export function waymarksInChunk(worldSeed: number, cx: number, cy: number): Waymark[] {
  const out: Waymark[] = [];
  for (const wm of planWaymarks(worldSeed)) {
    const c = worldToChunk(wm.wx, wm.wy);
    if (c.cx === cx && c.cy === cy) out.push(wm);
  }
  return out;
}

/** Sant om en slumpdekor skulle hamna för nära en skylt, milsten, lykta eller sten. */
export function isWaymarkKeepoutAt(worldSeed: number, wx: number, wy: number, radius = 4): boolean {
  const r2 = radius * radius;
  for (const wm of planWaymarks(worldSeed)) {
    const dx = wm.wx - wx;
    const dy = wm.wy - wy;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

function regionNamn(regionId: string): string {
  return DATA.varldStor.regioner.find((r) => r.id === regionId)?.namn ?? regionId;
}

function buildWaymarks(worldSeed: number): Waymark[] {
  const regions = DATA.varldStor.regioner;
  const roads = DATA.varldStor.vagar;
  const spots = dedupeSpots([...anchorSpots(regions, roads), ...geometricSpots(worldSeed, roads)]);
  const marks: Waymark[] = [];
  for (const spot of spots) {
    const poly = polylineFor(roads, spot.roadIds[0] ?? '', worldSeed);
    const tan = tangentAt(poly, spot.x, spot.y);
    const pos = placeBeside(worldSeed, spot.x, spot.y, tan, `skylt:${spot.regionId}`);
    marks.push({
      kind: 'sign',
      wx: pos.x,
      wy: pos.y,
      textKey: regionMapLabelKey(spot.regionId),
      regionId: spot.regionId,
      roadIds: spot.roadIds,
      assetId: SIGN_ASSET,
    });
  }
  const portals = portalPoints();
  marks.push(...portalDressing(worldSeed, roads));
  marks.push(...milestones(worldSeed, roads, regions, marks, portals));
  marks.sort((a, b) => a.wy - b.wy || a.wx - b.wx || a.kind.localeCompare(b.kind) || (a.regionId ?? '').localeCompare(b.regionId ?? ''));
  return marks;
}

function anchorSpots(regions: readonly BigWorldRegion[], roads: readonly BigWorldRoad[]): SignSpot[] {
  const roadsByRegion = new Map<string, string[]>();
  for (const road of roads) {
    for (const id of road.strackning) {
      const list = roadsByRegion.get(id) ?? [];
      if (!list.includes(road.id)) list.push(road.id);
      roadsByRegion.set(id, list);
    }
  }
  const wanted = new Set<string>();
  for (const road of roads) {
    const first = road.strackning[0];
    const last = road.strackning[road.strackning.length - 1];
    if (first) wanted.add(first);
    if (last) wanted.add(last);
  }
  for (const [id, list] of roadsByRegion) {
    if (list.length >= 2) wanted.add(id);
    const region = regions.find((r) => r.id === id);
    if (region && (region.typ === 'by' || region.typ === 'stad')) wanted.add(id);
  }
  const spots: SignSpot[] = [];
  for (const id of wanted) {
    const anchor = roadAnchorWorld(id, regions);
    if (!anchor) continue;
    const roadIds = [...(roadsByRegion.get(id) ?? [])].sort();
    spots.push({ x: anchor.x, y: anchor.y, regionId: id, roadIds });
  }
  spots.sort((a, b) => a.regionId.localeCompare(b.regionId));
  return spots;
}

function geometricSpots(worldSeed: number, roads: readonly BigWorldRoad[]): SignSpot[] {
  const polys = roads.map((road) => ({
    id: road.id,
    regions: road.strackning,
    pts: roadPolylineWorld(road, worldSeed),
  }));
  const spots: SignSpot[] = [];
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      const a = polys[i];
      const b = polys[j];
      if (!a || !b) continue;
      const hit = closestWithin(a.pts, b.pts, DEDUPE_WORLD);
      if (!hit) continue;
      const x = (hit.ax + hit.bx) / 2;
      const y = (hit.ay + hit.by) / 2;
      const regionId = nearestLabeledRegion([...a.regions, ...b.regions], x, y);
      if (!regionId) continue;
      spots.push({ x, y, regionId, roadIds: [a.id, b.id].sort() });
    }
  }
  return spots;
}

function nearestLabeledRegion(ids: readonly string[], x: number, y: number): string {
  let best = '';
  let bd = Infinity;
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id) || !hasRegionMapLabel(id)) continue;
    seen.add(id);
    const anchor = roadAnchorWorld(id);
    if (!anchor) continue;
    const d = Math.hypot(anchor.x - x, anchor.y - y);
    if (d < bd) {
      bd = d;
      best = id;
    }
  }
  return best;
}

function dedupeSpots(spots: readonly SignSpot[]): SignSpot[] {
  const out: SignSpot[] = [];
  for (const spot of spots) {
    const hit = out.find((o) => Math.hypot(o.x - spot.x, o.y - spot.y) < DEDUPE_WORLD);
    if (hit) {
      for (const id of spot.roadIds) if (!hit.roadIds.includes(id)) hit.roadIds.push(id);
      hit.roadIds.sort();
      continue;
    }
    out.push({ x: spot.x, y: spot.y, regionId: spot.regionId, roadIds: [...spot.roadIds].sort() });
  }
  return out;
}

function portalPoints(): Pt[] {
  return PORTAL_TOWNS.map((p) => bigWorldCityPortalWorld(p.city));
}

function portalDressing(worldSeed: number, roads: readonly BigWorldRoad[]): Waymark[] {
  const marks: Waymark[] = [];
  for (const town of PORTAL_TOWNS) {
    const portal = bigWorldCityPortalWorld(town.city);
    const road = roads.find((r) => r.strackning.includes(town.regionId) && roadIsDrawn(r.typ));
    const poly = road ? roadPolylineWorld(road, worldSeed) : [];
    const tan = tangentAt(poly, portal.x, portal.y);
    const px = -tan.y;
    const py = tan.x;
    const lamps = [
      { x: portal.x + px * 6.5 + tan.x * 3.2, y: portal.y + py * 6.5 + tan.y * 3.2 },
      { x: portal.x - px * 6.5 - tan.x * 3.2, y: portal.y - py * 6.5 - tan.y * 3.2 },
    ];
    for (const lamp of lamps) {
      const pos = nudgeNear(worldSeed, lamp.x, lamp.y, portal.x, portal.y);
      marks.push({ kind: 'lamp', wx: pos.x, wy: pos.y, regionId: town.regionId, assetId: LAMP_ASSET });
    }
    const stone = { x: portal.x + px * 7.2 - tan.x * 2.4, y: portal.y + py * 7.2 - tan.y * 2.4 };
    const stonePos = nudgeNear(worldSeed, stone.x, stone.y, portal.x, portal.y);
    marks.push({
      kind: 'portal_stone',
      wx: stonePos.x,
      wy: stonePos.y,
      regionId: town.regionId,
      assetId: STONE_ASSET,
    });
  }
  return marks;
}

function milestones(
  worldSeed: number,
  roads: readonly BigWorldRoad[],
  regions: readonly BigWorldRegion[],
  signs: readonly Waymark[],
  portals: readonly Pt[],
): Waymark[] {
  const out: Waymark[] = [];
  const signPts = signs.filter((s) => s.kind === 'sign').map((s) => ({ x: s.wx, y: s.wy }));
  const blocked = [...signPts, ...portals];
  for (const road of roads) {
    if (!roadIsDrawn(road.typ)) continue;
    const towns = road.strackning
      .map((id) => regions.find((r) => r.id === id))
      .filter((r): r is BigWorldRegion => !!r && (r.typ === 'by' || r.typ === 'stad'));
    if (towns.length === 0) continue;
    const poly = roadPolylineWorld(road, worldSeed);
    const cum = arcCum(poly);
    const total = cum[cum.length - 1] ?? 0;
    if (total < MILESTONE_STEP) continue;
    const stations = towns.map((town) => {
      const anchor = roadAnchorWorld(town.id, regions);
      return { regionId: town.id, s: anchor ? arcAt(poly, cum, anchor.x, anchor.y) : 0 };
    });
    const phase = (Rng.hash('milsten-fas', worldSeed, road.id) % 11) - 5;
    for (let s = MILESTONE_STEP + phase; s < total - 12; s += MILESTONE_STEP) {
      const sample = pointAt(poly, cum, s);
      if (nearAny(sample, blocked, MILESTONE_CLEAR)) continue;
      const tan = tangentAt(poly, sample.x, sample.y);
      const pos = placeBeside(worldSeed, sample.x, sample.y, tan, `milsten:${road.id}:${Math.round(s)}`);
      if (nearAny(pos, blocked, 12)) continue;
      let best = stations[0];
      let bd = Infinity;
      for (const station of stations) {
        const d = Math.abs(station.s - s);
        if (d < bd) {
          bd = d;
          best = station;
        }
      }
      if (!best) continue;
      out.push({
        kind: 'milestone',
        wx: pos.x,
        wy: pos.y,
        textKey: 'map.milestone',
        params: { hundreds: Math.round(bd / 100) },
        regionId: best.regionId,
        roadIds: [road.id],
        assetId: SIGN_ASSET,
      });
    }
  }
  return out;
}

function polylineFor(roads: readonly BigWorldRoad[], roadId: string, worldSeed: number): Pt[] {
  const road = roads.find((r) => r.id === roadId);
  return road ? roadPolylineWorld(road, worldSeed) : [];
}

function tangentAt(poly: readonly Pt[], x: number, y: number): Pt {
  if (poly.length < 2) return { x: 1, y: 0 };
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    if (!p) continue;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  const a = poly[Math.max(0, bestI - 1)] ?? poly[0];
  const b = poly[Math.min(poly.length - 1, bestI + 1)] ?? poly[poly.length - 1];
  if (!a || !b) return { x: 1, y: 0 };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}

function placeBeside(worldSeed: number, x: number, y: number, tan: Pt, salt: string): Pt {
  const side = (Rng.hash('vagvisare-sida', worldSeed, salt) & 1) === 0 ? 1 : -1;
  const base = Math.atan2(tan.y, tan.x);
  const angles = [side * (Math.PI / 2), -side * (Math.PI / 2), side * 1.15, -side * 1.15, side * 0.65, -side * 0.65];
  for (const dist of BESIDE_DIST) {
    for (const ang of angles) {
      const a = base + ang;
      const wx = x + Math.cos(a) * dist;
      const wy = y + Math.sin(a) * dist;
      if (clearOfRoad(worldSeed, wx, wy)) return { x: wx, y: wy };
    }
  }
  const a = base + side * (Math.PI / 2);
  return { x: x + Math.cos(a) * 9.2, y: y + Math.sin(a) * 9.2 };
}

function nudgeNear(worldSeed: number, x: number, y: number, px: number, py: number): Pt {
  if (clearOfRoad(worldSeed, x, y) && Math.hypot(x - px, y - py) <= 11.5) return { x, y };
  const dx = x - px;
  const dy = y - py;
  const base = Math.atan2(dy, dx);
  for (const dist of [5.5, 7, 8.5, 10.5]) {
    for (const ang of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4]) {
      const wx = px + Math.cos(base + ang) * dist;
      const wy = py + Math.sin(base + ang) * dist;
      if (clearOfRoad(worldSeed, wx, wy)) return { x: wx, y: wy };
    }
  }
  return { x, y };
}

function clearOfRoad(worldSeed: number, wx: number, wy: number): boolean {
  if (isRoadMaskAtWorld(worldSeed, wx, wy)) return false;
  const q = roadQueryAt(wx, wy);
  return roadCenterTileDistance(worldSeed, q.cx, q.cy, q.ti, q.tj) > 0;
}

function roadQueryAt(wx: number, wy: number): { cx: number; cy: number; ti: number; tj: number } {
  const gx = Math.floor(wx / TILE_WORLD);
  const gy = Math.floor(wy / TILE_WORLD);
  const own = worldToChunk(gx * TILE_WORLD + TILE_WORLD * 0.5, gy * TILE_WORLD + TILE_WORLD * 0.5);
  const min = chunkMinWorld(own.cx, own.cy);
  return {
    cx: own.cx,
    cy: own.cy,
    ti: Math.round((gx * TILE_WORLD - min.x) / TILE_WORLD),
    tj: Math.round((gy * TILE_WORLD - min.y) / TILE_WORLD),
  };
}

function closestWithin(a: readonly Pt[], b: readonly Pt[], limit: number): { ax: number; ay: number; bx: number; by: number } | null {
  if (a.length === 0 || b.length === 0) return null;
  const cell = 16;
  const buckets = new Map<string, number[]>();
  const key = (x: number, y: number): string => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (let i = 0; i < b.length; i++) {
    const p = b[i];
    if (!p) continue;
    const k = key(p.x, p.y);
    const list = buckets.get(k);
    if (list) list.push(i);
    else buckets.set(k, [i]);
  }
  let best = limit;
  let hit: { ax: number; ay: number; bx: number; by: number } | null = null;
  for (const p of a) {
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = buckets.get(`${cx + dx},${cy + dy}`);
        if (!list) continue;
        for (const i of list) {
          const q = b[i];
          if (!q) continue;
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d < best) {
            best = d;
            hit = { ax: p.x, ay: p.y, bx: q.x, by: q.y };
          }
        }
      }
    }
  }
  return hit;
}

function arcCum(poly: readonly Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const prev = cum[i - 1] ?? 0;
    cum.push(a && b ? prev + Math.hypot(b.x - a.x, b.y - a.y) : prev);
  }
  return cum;
}

function pointAt(poly: readonly Pt[], cum: readonly number[], s: number): Pt {
  const first = poly[0];
  if (!first) return { x: 0, y: 0 };
  if (s <= 0) return { x: first.x, y: first.y };
  for (let i = 1; i < poly.length; i++) {
    const end = cum[i] ?? 0;
    if (end < s) continue;
    const a = poly[i - 1];
    const b = poly[i];
    const start = cum[i - 1] ?? 0;
    if (!a || !b) return { x: first.x, y: first.y };
    const span = end - start;
    const t = span < 1e-6 ? 0 : (s - start) / span;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  const last = poly[poly.length - 1] ?? first;
  return { x: last.x, y: last.y };
}

function arcAt(poly: readonly Pt[], cum: readonly number[], x: number, y: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    if (!p) continue;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = cum[i] ?? 0;
    }
  }
  return best;
}

function nearAny(p: Pt, pts: readonly Pt[], radius: number): boolean {
  for (const q of pts) if (Math.hypot(p.x - q.x, p.y - q.y) < radius) return true;
  return false;
}

registerDecorKeepout((worldSeed, wx, wy) => isWaymarkKeepoutAt(worldSeed, wx, wy));
