import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA } from '../src/data';
import { TILE_WORLD } from '../src/render/Iso';
import { ROAD_TILES, STARTUP_TILES } from '../src/render/biomeAssetGroups';
import { bigWorldMapRoadPolyline } from '../src/map/bigWorldMapDraw';
import { chunkMinWorld, worldToChunk } from '../src/world/bigWorld/bigWorldCoords';
import { bigWorldCityPortalWorld } from '../src/world/bigWorld/bigWorldPortals';
import { roadSkipRadius, spawnTileNearRoad } from '../src/world/bigWorld/spawnDensity';
import { getBigWorldCatalog } from '../src/world/bigWorld/worldGenerator';
import {
  isRoadMaskAtWorld,
  roadAnchorWorld,
  roadCenterTileDistance,
  roadIsDrawn,
  roadMaskTileInChunk,
  roadPolylineWorld,
  roadTileIdAt,
  roadWidthTiles,
  roadsAtChunk,
  shouldSpawnDecorAt,
} from '../src/world/bigWorld/roads';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const roads = DATA.varldStor.vagar;
assert.equal(roads.length, 15, 'varld_stor ska ha 15 vägar');
assert.equal(STARTUP_TILES.length, 39, 'STARTUP_TILES ska vara orörd');
for (const id of ['kullersten', 'kullersten_mossig', 'grus_1', 'grus_2', 'spang_1', 'spang_2', 'bergsvag_1', 'bergsvag_2']) {
  assert.ok((ROAD_TILES as readonly string[]).includes(id), id);
}

assert.equal(roadWidthTiles('väg'), 3);
assert.equal(roadWidthTiles('gata'), 3);
assert.equal(roadWidthTiles('stig'), 2);
assert.equal(roadWidthTiles('bergspass'), 2);
assert.equal(roadWidthTiles('spång'), 2);
assert.equal(roadWidthTiles('ebbstig'), 2);
assert.equal(roadWidthTiles('trappa'), 0);
assert.equal(roadWidthTiles('schakt'), 0);
assert.equal(roadIsDrawn('trappa'), false);
assert.equal(roadIsDrawn('schakt'), false);
assert.equal(roadSkipRadius(0), 2);
assert.equal(roadSkipRadius(1), 2);
assert.equal(roadSkipRadius(2), 4);

const catalog = getBigWorldCatalog();
assert.ok(roadsAtChunk(catalog.roads, 0, 0).ids.includes('vag_ostra'));
assert.ok(roadsAtChunk(catalog.roads, 1, 1).ids.includes('vag_ostra'));

function nearest(poly: readonly { x: number; y: number }[], x: number, y: number): number {
  let best = Infinity;
  for (const p of poly) best = Math.min(best, Math.hypot(p.x - x, p.y - y));
  return best;
}

function maxDeviation(a: readonly { x: number; y: number }[], b: readonly { x: number; y: number }[]): number {
  let worst = 0;
  for (let i = 0; i < a.length; i += 3) {
    const p = a[i];
    if (!p) continue;
    worst = Math.max(worst, nearest(b, p.x, p.y));
  }
  return worst;
}

interface TileHit {
  gx: number;
  gy: number;
}

function tilesAlong(poly: readonly { x: number; y: number }[]): TileHit[] {
  const out: TileHit[] = [];
  const push = (x: number, y: number) => {
    const gx = Math.floor(x / TILE_WORLD);
    const gy = Math.floor(y / TILE_WORLD);
    const prev = out[out.length - 1];
    if (!prev || prev.gx !== gx || prev.gy !== gy) out.push({ gx, gy });
  };
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    if (!a || !b) continue;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(dist / 0.5));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    }
  }
  return out;
}

function queryOf(gx: number, gy: number): { cx: number; cy: number; ti: number; tj: number } {
  const wx = gx * TILE_WORLD + TILE_WORLD * 0.5;
  const wy = gy * TILE_WORLD + TILE_WORLD * 0.5;
  const { cx, cy } = worldToChunk(wx, wy);
  const min = chunkMinWorld(cx, cy);
  return {
    cx,
    cy,
    ti: Math.round((gx * TILE_WORLD - min.x) / TILE_WORLD),
    tj: Math.round((gy * TILE_WORLD - min.y) / TILE_WORLD),
  };
}

const seedA = 1;
const seedB = 99;
let sawSway = false;

for (const road of roads) {
  const poly = roadPolylineWorld(road, seedA);
  const again = roadPolylineWorld(road, seedA);
  assert.deepEqual(again, poly, `${road.id} ska vara deterministisk`);
  assert.ok(poly.length >= 2, `${road.id} saknar polylinje`);
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    assert.ok(a && b && Number.isFinite(a.x) && Number.isFinite(b.y), `${road.id} har ogiltig punkt`);
    if (!a || !b) continue;
    const step = Math.hypot(b.x - a.x, b.y - a.y);
    assert.ok(step < 16, `${road.id} hoppar ${step.toFixed(2)} enheter`);
  }
  for (const id of road.strackning) {
    const anchor = roadAnchorWorld(id);
    assert.ok(anchor, `${road.id} saknar ankare ${id}`);
    if (!anchor) continue;
    const gap = nearest(poly, anchor.x, anchor.y);
    assert.ok(gap < 0.01, `${road.id} missar ankare ${id} med ${gap}`);
  }
  assert.deepEqual(bigWorldMapRoadPolyline(road, seedA), poly, `kartan och världen ska dela ${road.id}`);
  assert.deepEqual(bigWorldMapRoadPolyline(road, seedB), roadPolylineWorld(road, seedB));

  if (!roadIsDrawn(road.typ)) continue;
  const sway = maxDeviation(poly, roadPolylineWorld(road, seedB));
  if (sway > 0.2) sawSway = true;
  assert.ok(sway < 14, `${road.id} svajar ${sway.toFixed(2)}, mer än amplituden tillåter`);

  const band = tilesAlong(poly);
  assert.ok(band.length > 1, `${road.id} saknar mittband`);
  for (let i = 0; i < band.length; i++) {
    const tile = band[i];
    if (!tile) continue;
    const q = queryOf(tile.gx, tile.gy);
    assert.equal(roadMaskTileInChunk(seedA, q.cx, q.cy, q.ti, q.tj), true, `${road.id} hål vid ${tile.gx},${tile.gy}`);
    assert.equal(roadCenterTileDistance(seedA, q.cx, q.cy, q.ti, q.tj), 0, `${road.id} mittlinje`);
    if (i === 0) continue;
    const prev = band[i - 1];
    if (!prev) continue;
    const cheb = Math.max(Math.abs(tile.gx - prev.gx), Math.abs(tile.gy - prev.gy));
    assert.ok(cheb <= 1, `${road.id} hål större än 1 ruta (${cheb})`);
  }
}

assert.ok(sawSway, 'olika worldSeed ska kunna ge olika svaj');

const vag = roads.find((r) => r.id === 'vag_ostra');
assert.ok(vag);
if (vag) {
  const poly = roadPolylineWorld(vag, seedA);
  const other = roadMaskTileInChunk(seedA, 0, 0, 0, 0);
  const otherSeed = roadMaskTileInChunk(seedB, 0, 0, 0, 0);
  assert.equal(typeof other, 'boolean');
  assert.equal(typeof otherSeed, 'boolean');
  const band = tilesAlong(poly);
  const sample = band[Math.min(8, band.length - 1)];
  assert.ok(sample);
  if (sample) {
    const q = queryOf(sample.gx, sample.gy);
    const on = roadMaskTileInChunk(seedA, q.cx, q.cy, q.ti, q.tj);
    const onFromNeighbor = roadMaskTileInChunk(seedA, q.cx - 1, q.cy, q.ti + 64, q.tj);
    assert.equal(on, true);
    assert.equal(onFromNeighbor, on, 'söm i masken');
    const idA = roadTileIdAt(seedA, q.cx, q.cy, q.ti, q.tj, 'skog');
    const idB = roadTileIdAt(seedA, q.cx - 1, q.cy, q.ti + 64, q.tj, 'skog');
    assert.equal(idA, idB, 'söm i tile-id');
    assert.ok(idA === 'kullersten' || idA === 'kullersten_mossig', `skogsväg ${idA}`);
    const fjall = roadTileIdAt(seedA, q.cx, q.cy, q.ti, q.tj, 'fjall');
    const trask = roadTileIdAt(seedA, q.cx, q.cy, q.ti, q.tj, 'trask');
    assert.ok(fjall === 'bergsvag_1' || fjall === 'bergsvag_2');
    assert.ok(trask === 'spang_1' || trask === 'spang_2', 'träsk vinner över vägens standard');
    assert.equal(roadTileIdAt(seedA, q.cx, q.cy, q.ti, q.tj, 'skog'), idA);

    const hasCenter = (ccx: number, ccy: number, ti: number, tj: number) => roadCenterTileDistance(seedA, ccx, ccy, ti, tj) === 0;
    assert.equal(spawnTileNearRoad(q.ti, q.tj, q.cx, q.cy, ['vag_ostra'], hasCenter, 2), true);
    let off: { ti: number; tj: number } | null = null;
    for (let n = 3; n <= 8 && !off; n++) {
      if (roadCenterTileDistance(seedA, q.cx, q.cy, q.ti + n, q.tj) > 2) off = { ti: q.ti + n, tj: q.tj };
    }
    if (off) assert.equal(spawnTileNearRoad(off.ti, off.tj, q.cx, q.cy, ['vag_ostra'], hasCenter, 2), false);
  }
  const wx = sample ? sample.gx * TILE_WORLD + 0.4 : (poly[0]?.x ?? 0);
  const wy = sample ? sample.gy * TILE_WORLD + 0.4 : (poly[0]?.y ?? 0);
  assert.equal(isRoadMaskAtWorld(seedA, wx, wy), true);
  assert.equal(shouldSpawnDecorAt(seedA, wx, wy), false);
  assert.equal(shouldSpawnDecorAt(seedA, 8000, 8000), true);
}

const stig = roads.find((r) => r.id === 'stig_idet');
assert.ok(stig);
if (stig) {
  const hit = tilesAlong(roadPolylineWorld(stig, seedA))[3];
  assert.ok(hit);
  if (hit) {
    const q = queryOf(hit.gx, hit.gy);
    const id = roadTileIdAt(seedA, q.cx, q.cy, q.ti, q.tj, 'skog');
    assert.ok(id === 'grus_1' || id === 'grus_2', `stig ${id}`);
    const pass = roadTileIdAt(seedA, q.cx, q.cy, q.ti, q.tj, 'fjall');
    assert.ok(pass === 'bergsvag_1' || pass === 'bergsvag_2');
  }
}

const spang = roads.find((r) => r.id === 'klockstigen');
assert.ok(spang);
if (spang) {
  const hit = tilesAlong(roadPolylineWorld(spang, seedA))[2];
  if (hit) {
    const q = queryOf(hit.gx, hit.gy);
    const id = roadTileIdAt(seedA, q.cx, q.cy, q.ti, q.tj, 'skog');
    assert.ok(id === 'spang_1' || id === 'spang_2', `spång ${id}`);
  }
}

const pass = roads.find((r) => r.id === 'stig_klostret');
assert.ok(pass);
if (pass) {
  const hit = tilesAlong(roadPolylineWorld(pass, seedA))[2];
  if (hit) {
    const q = queryOf(hit.gx, hit.gy);
    const id = roadTileIdAt(seedA, q.cx, q.cy, q.ti, q.tj, 'ask');
    assert.ok(id === 'bergsvag_1' || id === 'bergsvag_2', `bergspass ${id}`);
  }
}

const gata = roads.find((r) => r.id === 'katedralgatan');
assert.ok(gata);
if (gata) {
  const hit = tilesAlong(roadPolylineWorld(gata, seedA))[2];
  if (hit) {
    const q = queryOf(hit.gx, hit.gy);
    const id = roadTileIdAt(seedA, q.cx, q.cy, q.ti, q.tj, 'ask');
    assert.ok(id === 'kullersten' || id === 'kullersten_mossig', `gata ${id}`);
  }
}

const start = { x: -128, y: -132 };
const portal = bigWorldCityPortalWorld('wolfstead');
let maskNearStart = false;
for (let dy = -12; dy <= 12 && !maskNearStart; dy++) {
  for (let dx = -12; dx <= 12; dx++) {
    const x = start.x + dx;
    const y = start.y + dy;
    if (Math.hypot(x - start.x, y - start.y) > 20) continue;
    if (isRoadMaskAtWorld(seedA, x, y)) maskNearStart = true;
  }
}
assert.ok(maskNearStart, 'första vägtilen ska ligga inom 20 enheter från start_pos');

if (vag) {
  const poly = roadPolylineWorld(vag, seedA);
  const end = poly[poly.length - 1];
  assert.ok(end);
  if (end) assert.ok(Math.hypot(end.x - portal.x, end.y - portal.y) < 0.01, 'Östra vägen slutar vid Vargabys portal');
  for (const p of poly) {
    assert.ok(isRoadMaskAtWorld(seedA, p.x, p.y, 3), `lämnade masken vid ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  }
}

const roadChunks: { cx: number; cy: number }[] = [];
for (let cx = -8; cx <= 12 && roadChunks.length < 20; cx++) {
  for (let cy = -12; cy <= 10 && roadChunks.length < 20; cy++) {
    const types = roadsAtChunk(catalog.roads, cx, cy).types;
    if (types.some((typ) => roadIsDrawn(typ))) roadChunks.push({ cx, cy });
  }
}
assert.ok(roadChunks.length >= 20, `behöver 20 vägchunkar, fick ${roadChunks.length}`);
const times: number[] = [];
for (const chunk of roadChunks) {
  const t0 = performance.now();
  let hits = 0;
  for (let ti = 0; ti < 64; ti++) {
    for (let tj = 0; tj < 64; tj++) {
      if (roadMaskTileInChunk(seedA, chunk.cx, chunk.cy, ti, tj)) hits++;
    }
  }
  const ms = performance.now() - t0;
  times.push(ms);
  assert.ok(ms < 50, `chunk ${chunk.cx},${chunk.cy} tog ${ms.toFixed(1)} ms`);
  assert.ok(hits >= 0);
}
const slowest = Math.max(...times);
console.log('vägchunk-raster ms', times.map((ms) => ms.toFixed(2)).join(', '), `långsammast ${slowest.toFixed(2)}`);

const groundSrc = readFileSync(join(root, 'src/world/bigWorld/BigWorldStreamGround.ts'), 'utf8');
assert.match(groundSrc, /shouldSpawnDecorAt/);
assert.match(groundSrc, /ensureTiles/);
assert.match(groundSrc, /Laddar stigen/);

console.log('big-world-roads.test.mts: ok');
