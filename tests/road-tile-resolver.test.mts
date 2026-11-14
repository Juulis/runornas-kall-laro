import assert from 'node:assert/strict';
import { DATA } from '../src/data';
import { TILES } from '../src/render/biomeAssetGroups';
import { TILE_WORLD } from '../src/render/Iso';
import { ensureProceduralRoadTile } from '../src/render/roadMaskTextures';
import { ROAD_MASK_TEX_H, ROAD_MASK_TEX_W, roadMaskPixelAlpha, roadMaskPixels } from '../src/world/bigWorld/roadMaskPixels';
import {
  ROAD_FAMILIES,
  ROAD_MASK_N,
  ROAD_MASK_O,
  ROAD_MASK_S,
  ROAD_MASK_TILES,
  ROAD_MASK_V,
  isProceduralRoadTile,
  parseRoadMaskTileId,
  resolveRoadMaskTile,
  roadFamilyAt,
  roadMaskFamilyEnabled,
  roadMaskTileId,
  roadNeighborMask,
  roadSurfaceTileIdAt,
  setRoadMaskFamilyEnabled,
  type RoadFamily,
} from '../src/world/bigWorld/roadTileResolver';
import { chunkMinWorld, worldToChunk } from '../src/world/bigWorld/bigWorldCoords';
import {
  roadCenterTileDistance,
  roadMaskAtWorldTile,
  roadMaskHitAt,
  roadMaskTileInChunk,
  roadPolylineWorld,
  roadTileIdAt,
} from '../src/world/bigWorld/roads';

const seed = 1;

assert.equal(ROAD_MASK_TILES.length, 64);
assert.equal(new Set(ROAD_MASK_TILES).size, 64);

for (const family of ROAD_FAMILIES) {
  for (let mask = 0; mask < 16; mask++) {
    const id = roadMaskTileId(family, mask);
    const nn = mask.toString().padStart(2, '0');
    const expected = family === 'spang' ? `spang_mask_${nn}` : `${family}_${nn}`;
    assert.equal(id, expected);
    assert.equal(isProceduralRoadTile(id), true);
    assert.equal(resolveRoadMaskTile(family, mask), id);
    assert.equal(
      resolveRoadMaskTile(family, mask, () => true),
      id,
    );
    assert.equal(
      resolveRoadMaskTile(family, mask, () => false),
      null,
    );
    assert.equal(TILES.includes(id), false, `${id} ska inte ligga i TILES`);
    const parsed = parseRoadMaskTileId(id);
    assert.deepEqual(parsed, { family, mask });
  }
}

assert.equal(isProceduralRoadTile('kullersten'), false);
assert.equal(isProceduralRoadTile('spang_1'), false);
assert.equal(isProceduralRoadTile('stig_jord_16'), false);
assert.equal(isProceduralRoadTile('stig_jord_7'), false);
assert.equal(
  resolveRoadMaskTile('vag_sten', 3, () => false),
  null,
);

assert.equal(roadFamilyAt('stig', 'skog'), 'stig_jord');
assert.equal(roadFamilyAt('ebbstig', 'skog'), 'stig_jord');
assert.equal(roadFamilyAt('stig', 'kust'), 'stig_jord');
assert.equal(roadFamilyAt('väg', 'skog'), 'vag_sten');
assert.equal(roadFamilyAt('gata', 'ask'), 'vag_sten');
assert.equal(roadFamilyAt('gata', 'fjall'), 'vag_sten');
assert.equal(roadFamilyAt('spång', 'skog'), 'spang');
assert.equal(roadFamilyAt('spång', 'fjäll'), 'spang');
assert.equal(roadFamilyAt('stig', 'trask'), 'spang');
assert.equal(roadFamilyAt('stig', 'träsk'), 'spang');
assert.equal(roadFamilyAt('väg', 'träsk'), 'spang');
assert.equal(roadFamilyAt('bergspass', 'ask'), 'vag_grus');
assert.equal(roadFamilyAt('bergspass', 'skog'), 'vag_grus');
assert.equal(roadFamilyAt('stig', 'fjäll'), 'vag_grus');
assert.equal(roadFamilyAt('väg', 'fjall'), 'vag_grus');
assert.equal(roadFamilyAt('okänd', 'skog'), 'vag_sten');

function cellsOf(list: readonly (readonly [number, number])[]): (gx: number, gy: number) => boolean {
  const set = new Set(list.map(([x, y]) => `${x},${y}`));
  return (gx, gy) => set.has(`${gx},${gy}`);
}

function maskAt(list: readonly (readonly [number, number])[], gx: number, gy: number): number {
  return roadNeighborMask(0, gx, gy, cellsOf(list));
}

assert.equal(maskAt([[0, 0]], 0, 0), 0, 'solitär');
assert.equal(
  maskAt(
    [
      [0, 0],
      [0, -1],
    ],
    0,
    0,
  ),
  ROAD_MASK_N,
  'ände bara norr, norr är −y',
);
assert.equal(
  maskAt(
    [
      [0, 0],
      [0, -1],
    ],
    0,
    -1,
  ),
  ROAD_MASK_S,
);
assert.equal(
  maskAt(
    [
      [0, -1],
      [0, 0],
      [0, 1],
    ],
    0,
    0,
  ),
  ROAD_MASK_N | ROAD_MASK_S,
  'rak norr–söder',
);
assert.equal(
  maskAt(
    [
      [-1, 0],
      [0, 0],
      [1, 0],
    ],
    0,
    0,
  ),
  ROAD_MASK_O | ROAD_MASK_V,
  'rak öster–väster',
);
assert.equal(
  maskAt(
    [
      [0, -1],
      [0, 0],
      [1, 0],
    ],
    0,
    0,
  ),
  ROAD_MASK_N | ROAD_MASK_O,
  'hörn norr+öster',
);
assert.equal(
  maskAt(
    [
      [0, -1],
      [0, 0],
      [0, 1],
      [1, 0],
    ],
    0,
    0,
  ),
  ROAD_MASK_N | ROAD_MASK_O | ROAD_MASK_S,
  'T',
);
assert.equal(
  maskAt(
    [
      [0, -1],
      [0, 0],
      [0, 1],
      [1, 0],
      [-1, 0],
    ],
    0,
    0,
  ),
  15,
  'kors',
);
assert.equal(
  roadNeighborMask(
    1,
    0,
    0,
    cellsOf([
      [0, 0],
      [0, -1],
    ]),
  ),
  roadNeighborMask(
    99,
    0,
    0,
    cellsOf([
      [0, 0],
      [0, -1],
    ]),
  ),
);

let boundaryX = 0;
const gyLine = 4;
for (let gx = -80; gx < 80; gx++) {
  const a = worldToChunk(gx * TILE_WORLD + TILE_WORLD * 0.5, gyLine * TILE_WORLD + TILE_WORLD * 0.5);
  const b = worldToChunk((gx + 1) * TILE_WORLD + TILE_WORLD * 0.5, gyLine * TILE_WORLD + TILE_WORLD * 0.5);
  if (a.cx !== b.cx) {
    boundaryX = gx;
    break;
  }
}
const straight: (readonly [number, number])[] = [];
for (let gx = boundaryX - 3; gx <= boundaryX + 4; gx++) straight.push([gx, gyLine]);
const onStraight = cellsOf(straight);
assert.notEqual(
  worldToChunk(boundaryX * TILE_WORLD + 1, gyLine * TILE_WORLD + 1).cx,
  worldToChunk((boundaryX + 1) * TILE_WORLD + 1, gyLine * TILE_WORLD + 1).cx,
);
assert.equal(roadNeighborMask(seed, boundaryX, gyLine, onStraight), ROAD_MASK_O | ROAD_MASK_V);
assert.equal(roadNeighborMask(seed, boundaryX + 1, gyLine, onStraight), ROAD_MASK_O | ROAD_MASK_V);
assert.equal(roadNeighborMask(7, boundaryX, gyLine, onStraight), roadNeighborMask(8, boundaryX, gyLine, onStraight));
assert.equal(roadNeighborMask(seed, boundaryX - 3, gyLine, onStraight), ROAD_MASK_O, 'ände mot öster');
assert.equal(roadNeighborMask(seed, boundaryX + 4, gyLine, onStraight), ROAD_MASK_V, 'ände mot väster');

const tips = [
  { bit: ROAD_MASK_N, x: 64, y: 0, name: 'norr' },
  { bit: ROAD_MASK_O, x: 127, y: 32, name: 'öster' },
  { bit: ROAD_MASK_S, x: 64, y: 63, name: 'söder' },
  { bit: ROAD_MASK_V, x: 0, y: 32, name: 'väster' },
] as const;

for (const family of ROAD_FAMILIES) {
  for (const tip of tips) {
    assert.ok(roadMaskPixelAlpha(family, tip.bit, tip.x, tip.y) > 200, `${family} ${tip.name} når sitt hörn`);
    assert.ok(roadMaskPixelAlpha(family, tip.bit, 64, 32) > 200, `${family} ${tip.name} har kropp i mitten`);
    for (const other of tips) {
      if (other.bit === tip.bit) continue;
      assert.ok(roadMaskPixelAlpha(family, tip.bit, other.x, other.y) < 12, `${family} ${tip.name} ska inte nå ${other.name}`);
    }
  }
  const straightNs = ROAD_MASK_N | ROAD_MASK_S;
  assert.ok(roadMaskPixelAlpha(family, straightNs, 64, 0) > 200);
  assert.ok(roadMaskPixelAlpha(family, straightNs, 64, 63) > 200);
  assert.ok(roadMaskPixelAlpha(family, straightNs, 0, 32) < 12);
  assert.ok(roadMaskPixelAlpha(family, straightNs, 127, 32) < 12);
  assert.ok(roadMaskPixelAlpha(family, 0, 64, 32) > 200, 'solitär i mitten');
  for (const tip of tips) assert.ok(roadMaskPixelAlpha(family, 0, tip.x, tip.y) < 12, 'solitär når inte hörnet');
  for (const tip of tips) assert.ok(roadMaskPixelAlpha(family, 15, tip.x, tip.y) > 200, 'kors fyller armen');
  assert.equal(roadMaskPixelAlpha(family, 15, 0, 0), 0, 'hörnet utanför diamanten');
  assert.equal(roadMaskPixelAlpha(family, 15, 127, 0), 0);
}

const nsPx = roadMaskPixels('stig_jord', ROAD_MASK_N | ROAD_MASK_S);
let soft = 0;
let opaque = 0;
for (let i = 3; i < nsPx.length; i += 4) {
  const a = nsPx[i] ?? 0;
  if (a > 200) opaque++;
  else if (a > 8) soft++;
}
assert.ok(soft > 30, `kanten ska vara mjuk, fick ${soft} mellanpixlar`);
assert.ok(opaque > 200 && opaque < 2500, `norr–söder ska vara en arm, inte hela diamanten (${opaque})`);

const crossPx = roadMaskPixels('vag_sten', 15);
let crossOpaque = 0;
for (let i = 3; i < crossPx.length; i += 4) if ((crossPx[i] ?? 0) > 200) crossOpaque++;
assert.ok(crossOpaque > 3000, `kors ska fylla det mesta av diamanten (${crossOpaque})`);
assert.ok(crossOpaque < ROAD_MASK_TEX_W * ROAD_MASK_TEX_H);

function average(family: RoadFamily): { r: number; g: number; b: number } {
  const px = roadMaskPixels(family, 15);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = 24; y <= 40; y++) {
    for (let x = 48; x <= 80; x++) {
      const i = (y * ROAD_MASK_TEX_W + x) * 4;
      if ((px[i + 3] ?? 0) < 200) continue;
      r += px[i] ?? 0;
      g += px[i + 1] ?? 0;
      b += px[i + 2] ?? 0;
      n++;
    }
  }
  assert.ok(n > 20, family);
  return { r: r / n, g: g / n, b: b / n };
}

const jord = average('stig_jord');
const sten = average('vag_sten');
const grus = average('vag_grus');
const spang = average('spang');
const sum = (c: { r: number; g: number; b: number }) => c.r + c.g + c.b;
assert.ok(sum(jord) < 105, `jord ska vara mörkare än grus_1, summa ${sum(jord).toFixed(0)}`);
assert.ok(sum(grus) > sum(jord) + 30, 'grus ljusare än jord');
assert.ok(sum(grus) > 130, `grus ska vara ljust, summa ${sum(grus).toFixed(0)}`);
assert.ok(Math.abs(sten.r - sten.g) < 10 && Math.abs(sten.g - sten.b) < 12, 'kullersten är grå');
assert.ok(spang.r > spang.b + 8, 'spång är brun');

function tileOf(x: number, y: number): { gx: number; gy: number; cx: number; cy: number; ti: number; tj: number } {
  const gx = Math.floor(x / TILE_WORLD);
  const gy = Math.floor(y / TILE_WORLD);
  const wx = gx * TILE_WORLD + TILE_WORLD * 0.5;
  const wy = gy * TILE_WORLD + TILE_WORLD * 0.5;
  const { cx, cy } = worldToChunk(wx, wy);
  const min = chunkMinWorld(cx, cy);
  return {
    gx,
    gy,
    cx,
    cy,
    ti: Math.round((gx * TILE_WORLD - min.x) / TILE_WORLD),
    tj: Math.round((gy * TILE_WORLD - min.y) / TILE_WORLD),
  };
}

function firstTile(roadId: string, typ?: string): { gx: number; gy: number; cx: number; cy: number; ti: number; tj: number } {
  const road = DATA.varldStor.vagar.find((r) => r.id === roadId);
  assert.ok(road, roadId);
  const poly = roadPolylineWorld(road, seed);
  for (const p of poly) {
    const t = tileOf(p.x, p.y);
    const hit = roadMaskHitAt(seed, t.cx, t.cy, t.ti, t.tj);
    if (!hit) continue;
    if (typ && hit.typ !== typ) continue;
    return t;
  }
  assert.fail(`${roadId} saknar maskruta${typ ? ` av typ ${typ}` : ''}`);
}

const vag = firstTile('vag_ostra');
const vagHit = roadMaskHitAt(seed, vag.cx, vag.cy, vag.ti, vag.tj);
assert.ok(vagHit);
assert.equal(vagHit.gx, vag.gx);
assert.equal(vagHit.gy, vag.gy);
const vagMask = roadNeighborMask(seed, vag.gx, vag.gy);
assert.equal(vagMask, roadNeighborMask(seed, vag.gx, vag.gy));
assert.ok(vagMask >= 0 && vagMask <= 15);
let manual = 0;
if (roadMaskAtWorldTile(seed, vag.gx, vag.gy - 1)) manual |= ROAD_MASK_N;
if (roadMaskAtWorldTile(seed, vag.gx + 1, vag.gy)) manual |= ROAD_MASK_O;
if (roadMaskAtWorldTile(seed, vag.gx, vag.gy + 1)) manual |= ROAD_MASK_S;
if (roadMaskAtWorldTile(seed, vag.gx - 1, vag.gy)) manual |= ROAD_MASK_V;
assert.equal(vagMask, manual);

const fromOtherChunk = roadSurfaceTileIdAt(seed, vag.cx - 1, vag.cy, vag.ti + 64, vag.tj, 'skog');
const fromHome = roadSurfaceTileIdAt(seed, vag.cx, vag.cy, vag.ti, vag.tj, 'skog');
assert.equal(fromHome, fromOtherChunk, 'söm i mask-tile');
assert.equal(fromHome, roadMaskTileId('vag_sten', vagMask));
assert.equal(roadMaskTileInChunk(seed, vag.cx, vag.cy, vag.ti, vag.tj), roadMaskTileInChunk(seed, vag.cx - 1, vag.cy, vag.ti + 64, vag.tj));
for (const [dx, dy] of [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const) {
  const n = tileOf((vag.gx + dx) * TILE_WORLD + 1, (vag.gy + dy) * TILE_WORLD + 1);
  assert.equal(
    roadMaskTileInChunk(seed, n.cx, n.cy, n.ti, n.tj),
    roadMaskTileInChunk(seed, n.cx - 1, n.cy, n.ti + 64, n.tj),
    `granne ${dx},${dy} sömlös`,
  );
}

const legacy = roadTileIdAt(seed, vag.cx, vag.cy, vag.ti, vag.tj, 'skog');
assert.ok(legacy === 'kullersten' || legacy === 'kullersten_mossig');
assert.notEqual(fromHome, legacy);
assert.equal(roadSurfaceTileIdAt(seed, vag.cx, vag.cy, vag.ti, vag.tj, 'fjall'), roadMaskTileId('vag_grus', vagMask));
assert.equal(roadSurfaceTileIdAt(seed, vag.cx, vag.cy, vag.ti, vag.tj, 'trask'), roadMaskTileId('spang', vagMask));
const legacyFjall = roadTileIdAt(seed, vag.cx, vag.cy, vag.ti, vag.tj, 'fjall');
assert.ok(legacyFjall === 'bergsvag_1' || legacyFjall === 'bergsvag_2');

const stig = firstTile('stig_idet', 'stig');
const stigHit = roadMaskHitAt(seed, stig.cx, stig.cy, stig.ti, stig.tj);
assert.ok(stigHit);
assert.equal(
  roadSurfaceTileIdAt(seed, stig.cx, stig.cy, stig.ti, stig.tj, 'skog'),
  roadMaskTileId('stig_jord', roadNeighborMask(seed, stig.gx, stig.gy)),
);
const stigLegacy = roadTileIdAt(seed, stig.cx, stig.cy, stig.ti, stig.tj, 'skog');
assert.ok(stigLegacy === 'grus_1' || stigLegacy === 'grus_2');

const spangRoad = firstTile('klockstigen', 'spång');
assert.equal(roadSurfaceTileIdAt(seed, spangRoad.cx, spangRoad.cy, spangRoad.ti, spangRoad.tj, 'skog')?.startsWith('spang_mask_'), true);

const pass = firstTile('stig_klostret', 'bergspass');
assert.equal(roadSurfaceTileIdAt(seed, pass.cx, pass.cy, pass.ti, pass.tj, 'ask')?.startsWith('vag_grus_'), true);

const gata = firstTile('katedralgatan', 'gata');
assert.equal(roadSurfaceTileIdAt(seed, gata.cx, gata.cy, gata.ti, gata.tj, 'ask')?.startsWith('vag_sten_'), true);

assert.equal(
  roadSurfaceTileIdAt(seed, vag.cx, vag.cy, vag.ti, vag.tj, 'skog', () => false),
  legacy,
);

let sawFringeOn = false;
let sawFringeOff = false;
const vagRoad = DATA.varldStor.vagar.find((r) => r.id === 'vag_ostra');
assert.ok(vagRoad);
const poly = roadPolylineWorld(vagRoad, seed);
for (const p of poly) {
  const gx = Math.floor(p.x / TILE_WORLD);
  const gy = Math.floor(p.y / TILE_WORLD);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const t = tileOf((gx + dx) * TILE_WORLD + 1, (gy + dy) * TILE_WORLD + 1);
    if (roadCenterTileDistance(seed, t.cx, t.cy, t.ti, t.tj) !== 1) continue;
    const id = roadTileIdAt(seed, t.cx, t.cy, t.ti, t.tj, 'skog');
    const fallen = roadSurfaceTileIdAt(seed, t.cx, t.cy, t.ti, t.tj, 'skog', () => false);
    assert.equal(fallen, id);
    if (id) {
      sawFringeOn = true;
      assert.match(id, /^(kullersten|kullersten_mossig)$/);
      const shown = roadSurfaceTileIdAt(seed, t.cx, t.cy, t.ti, t.tj, 'skog');
      assert.match(shown ?? '', /^vag_sten_\d{2}$/);
    } else sawFringeOff = true;
  }
  if (sawFringeOn && sawFringeOff) break;
}
assert.ok(sawFringeOn, 'fransen ska kunna vara på');
assert.ok(sawFringeOff, 'fransen ska kunna vara av');

setRoadMaskFamilyEnabled('vag_sten', false);
try {
  assert.equal(roadMaskFamilyEnabled('vag_sten'), false);
  assert.equal(resolveRoadMaskTile('vag_sten', vagMask), null);
  assert.equal(roadSurfaceTileIdAt(seed, vag.cx, vag.cy, vag.ti, vag.tj, 'skog'), legacy);
  assert.equal(resolveRoadMaskTile('stig_jord', 1), roadMaskTileId('stig_jord', 1));
} finally {
  setRoadMaskFamilyEnabled('vag_sten', true);
}
assert.equal(resolveRoadMaskTile('vag_sten', vagMask), roadMaskTileId('vag_sten', vagMask));

for (const family of ROAD_FAMILIES) setRoadMaskFamilyEnabled(family, false);
try {
  for (const family of ROAD_FAMILIES) assert.equal(resolveRoadMaskTile(family, 0), null);
} finally {
  for (const family of ROAD_FAMILIES) setRoadMaskFamilyEnabled(family, true);
}

const store = { tiles: new Map() };
const tex = ensureProceduralRoadTile(store, 'stig_jord_05');
assert.ok(tex);
assert.equal(store.tiles.get('stig_jord_05'), tex);
assert.equal(ensureProceduralRoadTile(store, 'stig_jord_05'), tex);
assert.equal(tex.width, ROAD_MASK_TEX_W);
assert.equal(tex.height, ROAD_MASK_TEX_H);
assert.equal(ensureProceduralRoadTile(store, 'kullersten'), null);
assert.equal(store.tiles.has('kullersten'), false);
for (const family of ROAD_FAMILIES) {
  const id = roadMaskTileId(family, 15);
  const made = ensureProceduralRoadTile(store, id);
  assert.ok(made, id);
  assert.equal(store.tiles.get(id), made);
}

console.log('road-tile-resolver.test.mts: ok');
