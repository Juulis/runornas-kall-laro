import type { BigWorldRegion, BigWorldRoad } from '../../data/bigWorldTypes';
import type { PlayableCityZone } from '../cityZones';
import { DATA } from '../../data';
import { Rng } from '../../core/Rng';
import { canonicalBiomeId } from '../../render/biomeAssetGroups';
import { TILE_WORLD } from '../../render/Iso';
import { chunkMinWorld, chunkTileCount, chunkWorldSpan, worldToChunk } from './bigWorldCoords';
import { bigWorldCityPortalWorld } from './bigWorldPortals';

/**
 * Vägar som polylinjer i världsenheter.
 * Chunkindexet är seed-löst: osvajad Catmull-Rom plus marginal så svajet (6 enheter) ryms.
 * Masken rastreras med worldSeed. Konsumenter som läser masken måste skicka samma seed.
 * Steg 6 (DecorPlanner) finns inte än. Anropa isRoadMaskAtWorld eller roadMaskTileInChunk
 * så dekor och kolliderare inte hamnar på vägen. shouldSpawnDecorAt gör samma sak idag.
 */

const SWAY_AMPLITUDE = 6;
/** Osvajad kurva + svaj + väghalvbredd. 32 enheter är långt under en chunk (128). */
const INDEX_MARGIN_WORLD = 32;
const POLY_STEP = 4;
const INDEX_STEP = 8;
const MASK_HALO = 6;

const PORTAL_REGION: Readonly<Record<string, PlayableCityZone>> = {
  vargaby: 'wolfstead',
  dimmerstrand: 'dimmerstrand',
  kopparberg: 'kopparberg',
  askeborg: 'askeborg',
};

interface Pt {
  x: number;
  y: number;
}

interface RoadLine {
  index: number;
  id: string;
  typ: string;
  width: number;
  pts: Pt[];
}

interface SegRef {
  road: number;
  seg: number;
}

interface ChunkMask {
  on: Uint8Array;
  dist: Uint8Array;
  road: Uint8Array;
}

interface SeedGeom {
  byId: Map<string, RoadLine>;
  lines: RoadLine[];
  buckets: Map<string, SegRef[]>;
  masks: Map<string, ChunkMask>;
  ready: boolean;
}

const geoms = new Map<number, SeedGeom>();
let indexSingleton: RoadIndex | null = null;

function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function roadAnchorWorld(regionId: string, regions: readonly BigWorldRegion[] = DATA.varldStor.regioner): Pt | null {
  const region = regions.find((r) => r.id === regionId);
  if (!region) return null;
  const city = PORTAL_REGION[regionId];
  if (city) return bigWorldCityPortalWorld(city);
  return chunkCenter(region.chunk[0], region.chunk[1]);
}

function chunkCenter(cx: number, cy: number): Pt {
  const span = chunkWorldSpan();
  const min = chunkMinWorld(cx, cy);
  return { x: min.x + span * 0.5, y: min.y + span * 0.5 };
}

/** Bredd i rutor. 0 betyder att typen inte ritas (trappa, schakt). */
export function roadWidthTiles(typ: string): number {
  if (typ === 'väg' || typ === 'gata') return 3;
  if (typ === 'stig' || typ === 'bergspass' || typ === 'spång' || typ === 'ebbstig') return 2;
  return 0;
}

/** Sant om typen får ett tilelager i världen. Trappa och schakt har bara kurva. */
export function roadIsDrawn(typ: string): boolean {
  return roadWidthTiles(typ) > 0;
}

function swayedMid(worldSeed: number, roadId: string, seg: number, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: a.x, y: a.y };
  const rng = new Rng(Rng.hash('vag-svaj', worldSeed, roadId, seg));
  const mag = (rng.next() * 2 - 1) * SWAY_AMPLITUDE;
  const px = -dy / len;
  const py = dx / len;
  return { x: (a.x + b.x) / 2 + px * mag, y: (a.y + b.y) / 2 + py * mag };
}

/** Ankare ligger kvar. Mellankontrollpunkten svajar vinkelrätt, utom när amplituden är 0. */
function roadControls(road: BigWorldRoad, worldSeed: number, sway: number, regions: readonly BigWorldRegion[]): Pt[] {
  const anchors: Pt[] = [];
  for (const id of road.strackning) {
    const anchor = roadAnchorWorld(id, regions);
    if (anchor) anchors.push(anchor);
  }
  const first = anchors[0];
  if (!first) return [];
  if (anchors.length === 1) return [first];
  const out: Pt[] = [first];
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (!a || !b) continue;
    if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-4) {
      out.push(sway > 0 ? swayedMid(worldSeed, road.id, i, a, b) : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    out.push(b);
  }
  return out;
}

function catmull(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

function sampleCatmull(controls: readonly Pt[], step: number): Pt[] {
  const first = controls[0];
  if (!first) return [];
  if (controls.length === 1) return [{ x: first.x, y: first.y }];
  const last = controls[controls.length - 1] ?? first;
  const ext: Pt[] = [first, ...controls, last];
  const out: Pt[] = [];
  for (let i = 1; i < ext.length - 2; i++) {
    const p0 = ext[i - 1];
    const p1 = ext[i];
    const p2 = ext[i + 1];
    const p3 = ext[i + 2];
    if (!p0 || !p1 || !p2 || !p3) continue;
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const n = Math.max(1, Math.ceil(dist / Math.max(0.5, step)));
    for (let s = 0; s < n; s++) {
      if (s === 0) out.push({ x: p1.x, y: p1.y });
      else out.push(catmull(p0, p1, p2, p3, s / n));
    }
  }
  out.push({ x: last.x, y: last.y });
  return out;
}

/** Catmull-Rom genom ankare. Ankare flyttas inte. Mellankontrollpunkter svajar med worldSeed. */
export function roadPolylineWorld(road: BigWorldRoad, worldSeed: number): Pt[] {
  const cached = ensureGeom(worldSeed).byId.get(road.id);
  if (cached) return cached.pts;
  return sampleCatmull(roadControls(road, worldSeed, SWAY_AMPLITUDE, DATA.varldStor.regioner), POLY_STEP);
}

function ensureGeom(worldSeed: number): SeedGeom {
  const existing = geoms.get(worldSeed);
  if (existing?.ready) return existing;
  const g: SeedGeom = existing ?? {
    byId: new Map(),
    lines: [],
    buckets: new Map(),
    masks: new Map(),
    ready: false,
  };
  if (!existing) geoms.set(worldSeed, g);
  const regions = DATA.varldStor.regioner;
  DATA.varldStor.vagar.forEach((road, index) => {
    const pts = sampleCatmull(roadControls(road, worldSeed, SWAY_AMPLITUDE, regions), POLY_STEP);
    const line: RoadLine = { index, id: road.id, typ: road.typ, width: roadWidthTiles(road.typ), pts };
    g.lines.push(line);
    g.byId.set(road.id, line);
    if (line.width <= 0) return;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a || !b) continue;
      bucketSegment(g, index, i - 1, a, b);
    }
  });
  g.ready = true;
  return g;
}

function bucketSegment(g: SeedGeom, road: number, seg: number, a: Pt, b: Pt): void {
  const lo = worldToChunk(Math.min(a.x, b.x), Math.min(a.y, b.y));
  const hi = worldToChunk(Math.max(a.x, b.x), Math.max(a.y, b.y));
  for (let cx = lo.cx; cx <= hi.cx; cx++) {
    for (let cy = lo.cy; cy <= hi.cy; cy++) {
      const k = chunkKey(cx, cy);
      const list = g.buckets.get(k);
      const ref: SegRef = { road, seg };
      if (list) list.push(ref);
      else g.buckets.set(k, [ref]);
    }
  }
}

export interface RoadIndex {
  /** chunkKey -> vag-id */
  byChunk: Map<string, string[]>;
  /** chunkKey -> vägtyp (väg, stig, …) */
  typeByChunk: Map<string, string[]>;
}

/** Förbyggd karta: chunkar som den osvajade kurvan kan nå, med marginal för svaj. */
export function buildRoadIndex(roads: readonly BigWorldRoad[], regions: readonly BigWorldRegion[]): RoadIndex {
  const byChunk = new Map<string, string[]>();
  const typeByChunk = new Map<string, string[]>();

  const add = (cx: number, cy: number, road: BigWorldRoad) => {
    const k = chunkKey(cx, cy);
    const ids = byChunk.get(k) ?? [];
    if (!ids.includes(road.id)) ids.push(road.id);
    byChunk.set(k, ids);
    const types = typeByChunk.get(k) ?? [];
    if (!types.includes(road.typ)) types.push(road.typ);
    typeByChunk.set(k, types);
  };

  const cover = (x: number, y: number, road: BigWorldRoad) => {
    const lo = worldToChunk(x - INDEX_MARGIN_WORLD, y - INDEX_MARGIN_WORLD);
    const hi = worldToChunk(x + INDEX_MARGIN_WORLD, y + INDEX_MARGIN_WORLD);
    for (let cx = lo.cx; cx <= hi.cx; cx++) {
      for (let cy = lo.cy; cy <= hi.cy; cy++) add(cx, cy, road);
    }
  };

  for (const road of roads) {
    const controls = roadControls(road, 0, 0, regions);
    const pts = controls.length >= 2 ? sampleCatmull(controls, INDEX_STEP) : controls;
    for (const p of pts) cover(p.x, p.y, road);
  }

  return { byChunk, typeByChunk };
}

function worldRoadIndex(): RoadIndex {
  if (!indexSingleton) indexSingleton = buildRoadIndex(DATA.varldStor.vagar, DATA.varldStor.regioner);
  return indexSingleton;
}

function chunkIndexed(cx: number, cy: number): boolean {
  return (worldRoadIndex().byChunk.get(chunkKey(cx, cy)) ?? []).length > 0;
}

export function roadsAtChunk(index: RoadIndex, cx: number, cy: number): { ids: string[]; types: string[] } {
  const k = chunkKey(cx, cy);
  return {
    ids: index.byChunk.get(k) ?? [],
    types: index.typeByChunk.get(k) ?? [],
  };
}

function gxGy(cx: number, cy: number, ti: number, tj: number): { gx: number; gy: number } {
  const min = chunkMinWorld(cx, cy);
  return {
    gx: Math.round((min.x + ti * TILE_WORLD) / TILE_WORLD),
    gy: Math.round((min.y + tj * TILE_WORLD) / TILE_WORLD),
  };
}

function chunkOfGx(gx: number, gy: number): { cx: number; cy: number } {
  return worldToChunk(gx * TILE_WORLD + TILE_WORLD * 0.5, gy * TILE_WORLD + TILE_WORLD * 0.5);
}

function localOfGx(cx: number, cy: number, gx: number, gy: number): { ti: number; tj: number } {
  const min = chunkMinWorld(cx, cy);
  return {
    ti: Math.round((gx * TILE_WORLD - min.x) / TILE_WORLD),
    tj: Math.round((gy * TILE_WORLD - min.y) / TILE_WORLD),
  };
}

function normalizeLocal(
  cx: number,
  cy: number,
  ti: number,
  tj: number,
  tileSize: number,
): { cx: number; cy: number; ti: number; tj: number } {
  const tiles = tileSize > 0 ? Math.floor(tileSize) : chunkTileCount();
  const dcx = Math.floor(ti / tiles);
  const dcy = Math.floor(tj / tiles);
  return { cx: cx + dcx, cy: cy + dcy, ti: ti - dcx * tiles, tj: tj - dcy * tiles };
}

function segsNear(g: SeedGeom, cx: number, cy: number): SegRef[] {
  const out: SegRef[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const list = g.buckets.get(chunkKey(cx + dx, cy + dy));
      if (list) out.push(...list);
    }
  }
  return out;
}

function segHits(a: Pt, b: Pt, minX: number, minY: number, maxX: number, maxY: number): boolean {
  const sx0 = Math.min(a.x, b.x);
  const sx1 = Math.max(a.x, b.x);
  const sy0 = Math.min(a.y, b.y);
  const sy1 = Math.max(a.y, b.y);
  return sx1 >= minX && sx0 <= maxX && sy1 >= minY && sy0 <= maxY;
}

/** Supercover mellan två världspunkter. Hörnpunkter tar med sidocellerna så mittbandet inte spricker. */
function rasterSegment(x0: number, y0: number, x1: number, y1: number, visit: (gx: number, gy: number) => void): void {
  const tw = TILE_WORLD;
  let gx = Math.floor(x0 / tw);
  let gy = Math.floor(y0 / tw);
  visit(gx, gy);
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx === 0 && dy === 0) return;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const tDeltaX = dx === 0 ? Number.POSITIVE_INFINITY : Math.abs(tw / dx);
  const tDeltaY = dy === 0 ? Number.POSITIVE_INFINITY : Math.abs(tw / dy);
  const boundX = stepX > 0 ? (gx + 1) * tw : gx * tw;
  const boundY = stepY > 0 ? (gy + 1) * tw : gy * tw;
  let tMaxX = dx === 0 ? Number.POSITIVE_INFINITY : (boundX - x0) / dx;
  let tMaxY = dy === 0 ? Number.POSITIVE_INFINITY : (boundY - y0) / dy;
  if (tMaxX < 0) tMaxX = 0;
  if (tMaxY < 0) tMaxY = 0;
  let guard = 0;
  while (guard++ < 2048) {
    if (tMaxX < tMaxY) {
      if (tMaxX > 1) break;
      gx += stepX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxX) {
      if (tMaxY > 1) break;
      gy += stepY;
      tMaxY += tDeltaY;
    } else {
      if (tMaxX > 1) break;
      const sx = gx + stepX;
      const sy = gy + stepY;
      if (stepX !== 0) visit(sx, gy);
      if (stepY !== 0) visit(gx, sy);
      gx = sx;
      gy = sy;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    }
    visit(gx, gy);
  }
  visit(Math.floor(x1 / tw), Math.floor(y1 / tw));
}

function betterRoad(lines: readonly RoadLine[], a: number, b: number): number {
  const la = lines[a];
  const lb = lines[b];
  if (!la) return b;
  if (!lb) return a;
  if (la.width !== lb.width) return la.width > lb.width ? a : b;
  return la.id <= lb.id ? a : b;
}

function fringeOn(worldSeed: number, gx: number, gy: number): boolean {
  return Rng.hash('vag-frans', worldSeed, gx, gy) % 4 !== 0;
}

function buildChunkMask(g: SeedGeom, worldSeed: number, cx: number, cy: number): ChunkMask {
  const tiles = chunkTileCount();
  const halo = MASK_HALO;
  const side = tiles + halo * 2;
  const which = new Int16Array(side * side);
  which.fill(-1);
  const base = gxGy(cx, cy, 0, 0);
  const min = chunkMinWorld(cx, cy);
  const span = chunkWorldSpan();
  const pad = halo * TILE_WORLD;
  const minX = min.x - pad;
  const minY = min.y - pad;
  const maxX = min.x + span + pad;
  const maxY = min.y + span + pad;

  const mark = (gx: number, gy: number, road: number) => {
    const ix = gx - base.gx + halo;
    const iy = gy - base.gy + halo;
    if (ix < 0 || iy < 0 || ix >= side || iy >= side) return;
    const i = iy * side + ix;
    const prev = which[i] ?? -1;
    which[i] = prev < 0 ? road : betterRoad(g.lines, prev, road);
  };

  for (const ref of segsNear(g, cx, cy)) {
    const line = g.lines[ref.road];
    const a = line?.pts[ref.seg];
    const b = line?.pts[ref.seg + 1];
    if (!line || line.width <= 0 || !a || !b) continue;
    if (!segHits(a, b, minX, minY, maxX, maxY)) continue;
    rasterSegment(a.x, a.y, b.x, b.y, (gx, gy) => mark(gx, gy, line.index));
  }

  const dist = new Uint8Array(side * side);
  dist.fill(255);
  const qx: number[] = [];
  const qy: number[] = [];
  for (let iy = 0; iy < side; iy++) {
    for (let ix = 0; ix < side; ix++) {
      if ((which[iy * side + ix] ?? -1) < 0) continue;
      dist[iy * side + ix] = 0;
      qx.push(ix);
      qy.push(iy);
    }
  }
  for (let q = 0; q < qx.length; q++) {
    const x = qx[q];
    const y = qy[q];
    if (x === undefined || y === undefined) continue;
    const d = dist[y * side + x] ?? 255;
    if (d >= halo) continue;
    const nbrs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const;
    for (const [dx, dy] of nbrs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= side || ny >= side) continue;
      const ni = ny * side + nx;
      if ((dist[ni] ?? 255) <= d + 1) continue;
      dist[ni] = d + 1;
      qx.push(nx);
      qy.push(ny);
    }
  }

  const on = new Uint8Array(tiles * tiles);
  const outDist = new Uint8Array(tiles * tiles);
  const road = new Uint8Array(tiles * tiles);
  outDist.fill(255);
  road.fill(255);
  for (let tj = 0; tj < tiles; tj++) {
    for (let ti = 0; ti < tiles; ti++) {
      const ix = ti + halo;
      const iy = tj + halo;
      const di = iy * side + ix;
      const d = dist[di] ?? 255;
      const self = which[di] ?? -1;
      let claim = -1;
      if (self >= 0) claim = self;
      else {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nix = ix + dx;
            const niy = iy + dy;
            if (nix < 0 || niy < 0 || nix >= side || niy >= side) continue;
            const n = which[niy * side + nix] ?? -1;
            if (n < 0) continue;
            const line = g.lines[n];
            if (!line || line.width <= 0) continue;
            const manh = Math.abs(dx) + Math.abs(dy);
            if (line.width < 3 && manh !== 1) continue;
            claim = claim < 0 ? n : betterRoad(g.lines, claim, n);
          }
        }
        if (claim >= 0 && !fringeOn(worldSeed, base.gx + ti, base.gy + tj)) claim = -1;
      }
      const i = tj * tiles + ti;
      if (claim >= 0) {
        on[i] = 1;
        road[i] = claim;
      }
      outDist[i] = d >= 254 ? 255 : d;
    }
  }
  return { on, dist: outDist, road };
}

function cachedMask(worldSeed: number, cx: number, cy: number): ChunkMask {
  const g = ensureGeom(worldSeed);
  const k = chunkKey(cx, cy);
  const hit = g.masks.get(k);
  if (hit) return hit;
  const built = buildChunkMask(g, worldSeed, cx, cy);
  g.masks.set(k, built);
  return built;
}

function readLocal(
  worldSeed: number,
  cx: number,
  cy: number,
  ti: number,
  tj: number,
): { on: number; dist: number; road: number; gx: number; gy: number } | null {
  const { gx, gy } = gxGy(cx, cy, ti, tj);
  const own = chunkOfGx(gx, gy);
  if (!chunkIndexed(own.cx, own.cy)) return null;
  const mask = cachedMask(worldSeed, own.cx, own.cy);
  const local = localOfGx(own.cx, own.cy, gx, gy);
  const tiles = chunkTileCount();
  if (local.ti < 0 || local.tj < 0 || local.ti >= tiles || local.tj >= tiles) return null;
  const i = local.tj * tiles + local.ti;
  return {
    on: mask.on[i] ?? 0,
    dist: mask.dist[i] ?? 255,
    road: mask.road[i] ?? 255,
    gx,
    gy,
  };
}

/** Ruta (cx,cy,ti,tj) ligger på den rastrerade masken. Sömlös: samma världsruta ger samma svar. */
export function roadMaskTileInChunk(worldSeed: number, cx: number, cy: number, ti: number, tj: number): boolean {
  return (readLocal(worldSeed, cx, cy, ti, tj)?.on ?? 0) === 1;
}

/** Manhattan-rutor till närmaste ritade vägs mittlinje, eller Infinity. */
export function roadCenterTileDistance(worldSeed: number, cx: number, cy: number, ti: number, tj: number): number {
  const dist = readLocal(worldSeed, cx, cy, ti, tj)?.dist ?? 255;
  return dist >= 254 ? Number.POSITIVE_INFINITY : dist;
}

/**
 * Sant om världspunkten ligger på den ritade vägmasken.
 * Mittbandet är alltid med. Ytterkanten är med när fransen är på.
 * extraWorldUnits vidgar träffen, till exempel för röktest.
 * Steg 6 (DecorPlanner) anropar den här, eller roadMaskTileInChunk, så dekor inte läggs på vägen.
 */
export function isRoadMaskAtWorld(worldSeed: number, wx: number, wy: number, extraWorldUnits = 0): boolean {
  const extra = Math.max(0, extraWorldUnits);
  const gx = Math.floor(wx / TILE_WORLD);
  const gy = Math.floor(wy / TILE_WORLD);
  const r = extra === 0 ? 0 : Math.ceil(extra / TILE_WORLD) + 1;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (distPointToCell(wx, wy, gx + dx, gy + dy) > extra) continue;
      const own = chunkOfGx(gx + dx, gy + dy);
      const local = localOfGx(own.cx, own.cy, gx + dx, gy + dy);
      if (roadMaskTileInChunk(worldSeed, own.cx, own.cy, local.ti, local.tj)) return true;
    }
  }
  return false;
}

function distPointToCell(wx: number, wy: number, gx: number, gy: number): number {
  const x0 = gx * TILE_WORLD;
  const y0 = gy * TILE_WORLD;
  const nearestX = Math.max(x0, Math.min(wx, x0 + TILE_WORLD));
  const nearestY = Math.max(y0, Math.min(wy, y0 + TILE_WORLD));
  return Math.hypot(wx - nearestX, wy - nearestY);
}

type DecorKeepout = (worldSeed: number, wx: number, wy: number) => boolean;

/** waymarks.ts registrerar skyltfri zon så slumpdekor inte växer in i skylten. */
let decorKeepout: DecorKeepout | null = null;

export function registerDecorKeepout(fn: DecorKeepout): void {
  decorKeepout = fn;
}

/** Dekor hoppar över vägmasken och, när waymarks är laddat, skyltarnas keepout. */
export function shouldSpawnDecorAt(worldSeed: number, wx: number, wy: number): boolean {
  if (isRoadMaskAtWorld(worldSeed, wx, wy)) return false;
  if (decorKeepout?.(worldSeed, wx, wy)) return false;
  return true;
}

function tilePair(typ: string, biomeId: string): readonly [string, string] {
  const biome = canonicalBiomeId(biomeId);
  const vagEllerStig = typ === 'väg' || typ === 'stig';
  if (typ === 'spång' || (vagEllerStig && biome === 'trask')) return ['spang_1', 'spang_2'];
  if (typ === 'bergspass' || (vagEllerStig && biome === 'fjall')) return ['bergsvag_1', 'bergsvag_2'];
  if (typ === 'väg' || typ === 'gata') return ['kullersten', 'kullersten_mossig'];
  if (typ === 'stig' || typ === 'ebbstig') return ['grus_1', 'grus_2'];
  return ['kullersten', 'kullersten_mossig'];
}

/** Tile-id för maskrutan, eller null om rutan inte är väg. */
export function roadTileIdAt(worldSeed: number, cx: number, cy: number, ti: number, tj: number, biomeId: string): string | null {
  const hit = readLocal(worldSeed, cx, cy, ti, tj);
  if (!hit || hit.on !== 1 || hit.road >= 254) return null;
  const line = ensureGeom(worldSeed).lines[hit.road];
  if (!line) return null;
  const pair = tilePair(line.typ, biomeId);
  const h = Rng.hash('vag-tile', worldSeed, hit.gx, hit.gy);
  return (h & 1) === 0 ? pair[0] : pair[1];
}

/**
 * Mittlinjens ruta, inte hela masken. Spawn mäter Manhattan-avstånd härifrån
 * (ring 0–1: 2 rutor, från ring 2: 4). Trappa och schakt räknas inte.
 */
export function roadTileInChunk(
  index: RoadIndex,
  cx: number,
  cy: number,
  localTileI: number,
  localTileJ: number,
  tileSize: number,
  worldSeed = 0,
): boolean {
  const norm = normalizeLocal(cx, cy, localTileI, localTileJ, tileSize);
  if ((index.byChunk.get(chunkKey(norm.cx, norm.cy)) ?? []).length === 0) return false;
  return roadCenterTileDistance(worldSeed, norm.cx, norm.cy, norm.ti, norm.tj) === 0;
}
