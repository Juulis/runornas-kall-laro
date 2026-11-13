/**
 * Vägvisare, milstenar, lyktor och närmaste byportal.
 * Kör: npx tsx tests/big-world-waymarks.test.mts
 */
import assert from 'node:assert/strict';
import { DATA } from '../src/data';
import type { ZoneView } from '../src/core/GameContext';
import { LocaleManager } from '../src/i18n/LocaleManager';
import { TILE_WORLD } from '../src/render/Iso';
import { STARTUP_DECOR, WAYMARK_DECOR } from '../src/render/biomeAssetGroups';
import { GoalTracker } from '../src/map/GoalTracker';
import { MapModel } from '../src/map/MapModel';
import { regionMapLabel, regionMapLabelKey } from '../src/world/bigWorld/waymarks';
import { chunkMinWorld, worldToChunk } from '../src/world/bigWorld/bigWorldCoords';
import { bigWorldCityPortalWorld } from '../src/world/bigWorld/bigWorldPortals';
import { campStartPos } from '../src/world/bigWorld/startskogenFootprint';
import { PLAYABLE_CITIES } from '../src/world/cityZones';
import {
  isRoadMaskAtWorld,
  roadAnchorWorld,
  roadCenterTileDistance,
  roadIsDrawn,
  roadPolylineWorld,
  shouldSpawnDecorAt,
} from '../src/world/bigWorld/roads';
import { isWaymarkKeepoutAt, planWaymarks, waymarkCaption, waymarksInChunk } from '../src/world/bigWorld/waymarks';

const seed = 1;
const regions = DATA.varldStor.regioner;
const roads = DATA.varldStor.vagar;
assert.equal(roads.length, 15);

assert.deepEqual([...WAYMARK_DECOR], ['anslagstavla', 'orange_portal', 'fackla_stolpe']);
assert.ok((STARTUP_DECOR as readonly string[]).includes('anslagstavla'));
assert.equal((STARTUP_DECOR as readonly string[]).includes('fackla_stolpe'), false);
assert.equal((STARTUP_DECOR as readonly string[]).includes('orange_portal'), false);

const backend = {
  settings: new Map<string, string>(),
  async getSetting(key: string) {
    return backend.settings.get(key) ?? null;
  },
  async setSetting(key: string, value: string) {
    backend.settings.set(key, value);
  },
};
const i18n = new LocaleManager({ dev: false });
await i18n.bindSettings(backend as never);
const model = new MapModel(DATA, i18n);
const goals = new GoalTracker(model);

function expectedSignRegions(): Set<string> {
  const count = new Map<string, number>();
  const out = new Set<string>();
  for (const road of roads) {
    const first = road.strackning[0];
    const last = road.strackning[road.strackning.length - 1];
    if (first) out.add(first);
    if (last) out.add(last);
    for (const id of road.strackning) count.set(id, (count.get(id) ?? 0) + 1);
  }
  for (const [id, n] of count) if (n >= 2) out.add(id);
  for (const region of regions) {
    if ((region.typ === 'by' || region.typ === 'stad') && count.has(region.id)) out.add(region.id);
  }
  return out;
}

function queryOf(wx: number, wy: number): { cx: number; cy: number; ti: number; tj: number } {
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

function arcCum(poly: readonly { x: number; y: number }[]): number[] {
  const cum = [0];
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const prev = cum[i - 1] ?? 0;
    cum.push(a && b ? prev + Math.hypot(b.x - a.x, b.y - a.y) : prev);
  }
  return cum;
}

function arcAt(poly: readonly { x: number; y: number }[], cum: readonly number[], x: number, y: number): number {
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

const marks = planWaymarks(seed);
assert.deepEqual(planWaymarks(seed), marks, 'samma worldSeed ska ge samma lista');

const signs = marks.filter((w) => w.kind === 'sign');
const anchorRegions = expectedSignRegions();
for (const id of anchorRegions) {
  const anchor = roadAnchorWorld(id);
  assert.ok(anchor, id);
  if (!anchor) continue;
  const sign = signs.find((s) => s.regionId === id && Math.hypot(s.wx - anchor.x, s.wy - anchor.y) <= 10);
  assert.ok(sign, `skylt saknas vid ${id}`);
  if (!sign?.roadIds) continue;
  for (const road of roads) {
    if (!road.strackning.includes(id)) continue;
    assert.ok(sign.roadIds.includes(road.id), `${id} saknar väg ${road.id}`);
  }
}

for (const road of roads) {
  for (const id of [road.strackning[0], road.strackning[road.strackning.length - 1]]) {
    if (!id) continue;
    const anchor = roadAnchorWorld(id);
    assert.ok(anchor, `${road.id} ${id}`);
    if (!anchor) continue;
    const sign = signs.find((s) => s.roadIds?.includes(road.id) && Math.hypot(s.wx - anchor.x, s.wy - anchor.y) <= 10);
    assert.ok(sign, `${road.id} saknar skylt vid slutet ${id}`);
  }
}

const start = campStartPos();
assert.equal(start.x, -128);
assert.equal(start.y, -132);
assert.ok(
  signs.some((s) => s.roadIds?.includes('vag_ostra') && Math.hypot(s.wx - start.x, s.wy - start.y) <= 25),
  'Östra vägen ska ha en skylt nära lägret',
);

await i18n.setLocale('sv');
const cityEn: Record<string, string> = {
  vargaby: 'Wolfstead',
  dimmerstrand: 'Dimshore',
  kopparberg: 'Copperberg',
  askeborg: 'Ashburg',
  gamla_byn: 'The Old Village',
};
for (const sign of signs) {
  assert.ok(sign.textKey, sign.regionId);
  assert.ok(sign.regionId, sign.textKey);
  if (!sign.textKey || !sign.regionId) continue;
  const region = regions.find((r) => r.id === sign.regionId);
  assert.ok(region, sign.regionId);
  const sv = i18n.t(sign.textKey);
  assert.ok(sv.length > 0, sign.textKey);
  assert.equal(sv, region?.namn, sign.regionId);
  assert.equal(sign.textKey, regionMapLabelKey(sign.regionId));
  assert.equal(
    regionMapLabel(sign.regionId, region?.namn ?? '', (key) => i18n.t(key)),
    region?.namn,
  );
}
await i18n.setLocale('en');
for (const sign of signs) {
  if (!sign.textKey || !sign.regionId) continue;
  const en = i18n.t(sign.textKey);
  assert.ok(en.length > 0 && en !== sign.textKey, `${sign.regionId} ${en}`);
  const expectEn = cityEn[sign.regionId];
  if (expectEn) assert.equal(en, expectEn, sign.regionId);
}
await i18n.setLocale('sv');

for (const wm of marks) {
  if (wm.kind !== 'sign' && wm.kind !== 'milestone') continue;
  const q = queryOf(wm.wx, wm.wy);
  const dist = roadCenterTileDistance(seed, q.cx, q.cy, q.ti, q.tj);
  assert.ok(dist > 0, `${wm.kind} ${wm.regionId} ligger på mittbandet`);
  assert.equal(isRoadMaskAtWorld(seed, wm.wx, wm.wy), false, `${wm.kind} ${wm.regionId} ligger på vägmasken`);
}

function milestoneGaps(roadId: string, worldSeed: number): number[] {
  const road = roads.find((r) => r.id === roadId);
  assert.ok(road);
  if (!road) return [];
  const poly = roadPolylineWorld(road, worldSeed);
  const cum = arcCum(poly);
  const stones = planWaymarks(worldSeed)
    .filter((w) => w.kind === 'milestone' && w.roadIds?.includes(roadId))
    .map((w) => ({ w, s: arcAt(poly, cum, w.wx, w.wy) }))
    .sort((a, b) => a.s - b.s);
  const gaps: number[] = [];
  for (let i = 1; i < stones.length; i++) {
    const a = stones[i - 1];
    const b = stones[i];
    if (!a || !b) continue;
    gaps.push(Math.hypot(b.w.wx - a.w.wx, b.w.wy - a.w.wy));
  }
  return gaps;
}

function roadLooksMarked(roadId: string): boolean {
  const gaps = milestoneGaps(roadId, seed);
  if (gaps.length < 3) return false;
  const inBand = gaps.filter((g) => g >= 28 && g <= 55).length;
  return inBand >= Math.ceil(gaps.length / 2) && gaps.every((g) => g > 12 && g < 180);
}

assert.ok(roadLooksMarked('vag_ostra') || roadLooksMarked('askvagen'), 'milstenar ungefär var 40:e enhet');

for (const road of roads) {
  if (!roadIsDrawn(road.typ)) continue;
  const towns = road.strackning.filter((id) => {
    const region = regions.find((r) => r.id === id);
    return region?.typ === 'by' || region?.typ === 'stad';
  });
  if (towns.length === 0) continue;
  const poly = roadPolylineWorld(road, seed);
  const cum = arcCum(poly);
  for (const stone of marks.filter((w) => w.kind === 'milestone' && w.roadIds?.includes(road.id))) {
    const s = arcAt(poly, cum, stone.wx, stone.wy);
    let best = Infinity;
    for (const id of towns) {
      const anchor = roadAnchorWorld(id);
      if (!anchor) continue;
      best = Math.min(best, Math.abs(arcAt(poly, cum, anchor.x, anchor.y) - s));
    }
    const hundreds = stone.params?.hundreds;
    assert.equal(typeof hundreds, 'number', road.id);
    if (typeof hundreds !== 'number') continue;
    assert.ok(Math.abs(hundreds - Math.round(best / 100)) <= 1, `${road.id} hundratal ${hundreds} mot ${best.toFixed(0)}`);
    const caption = waymarkCaption(stone, (key, params) => i18n.t(key, params));
    assert.ok(caption.length > 0);
    assert.ok(!caption.includes('{'));
  }
}

for (const city of PLAYABLE_CITIES) {
  const portal = bigWorldCityPortalWorld(city);
  const near = marks.filter((w) => Math.hypot(w.wx - portal.x, w.wy - portal.y) <= 12);
  assert.ok(
    near.some((w) => w.kind === 'lamp' && w.assetId === 'fackla_stolpe'),
    `${city} saknar lykta`,
  );
  assert.ok(
    near.some((w) => w.kind === 'portal_stone' && w.assetId === 'orange_portal'),
    `${city} saknar välkomststen`,
  );
}

function anchorRegionList(worldSeed: number): string[] {
  return [
    ...new Set(
      planWaymarks(worldSeed)
        .filter((w) => w.kind === 'sign' && w.regionId && anchorRegions.has(w.regionId))
        .map((w) => w.regionId ?? ''),
    ),
  ].sort();
}
assert.deepEqual(anchorRegionList(seed), [...anchorRegions].sort());
assert.deepEqual(anchorRegionList(seed), anchorRegionList(99), 'ankar-skyltarnas regioner ska inte bero på seed');

const campSign = signs.find((s) => s.regionId === 'startlagret');
assert.ok(campSign);
if (campSign) {
  const chunk = worldToChunk(campSign.wx, campSign.wy);
  assert.ok(waymarksInChunk(seed, chunk.cx, chunk.cy).some((w) => w.wx === campSign.wx && w.wy === campSign.wy));
  assert.equal(isWaymarkKeepoutAt(seed, campSign.wx, campSign.wy), true);
  assert.equal(isWaymarkKeepoutAt(seed, campSign.wx + 80, campSign.wy + 80), false);
  assert.equal(shouldSpawnDecorAt(seed, campSign.wx, campSign.wy), false);
}
assert.equal(waymarksInChunk(seed, 400, 400).length, 0);

const forest: ZoneView = {
  name: 'forest',
  areaId: 'startskogen',
  width: 200,
  height: 200,
  colliders: [],
  runes: [],
  portals: [
    { x: 0, y: 0, target: 'wolfstead' },
    { x: 100, y: 0, target: 'dimmerstrand' },
    { x: 0, y: 80, target: 'kopparberg' },
  ],
  cleared: {},
};
const nearestDim = goals.goal(forest, { x: 90, y: 0 });
assert.ok(nearestDim);
assert.equal(nearestDim?.x, 100);
assert.equal(nearestDim?.y, 0);
assert.equal(model.t(nearestDim?.text ?? 'map.goal_rune', nearestDim?.params), 'Nästa mål: Dimmerstrand');

const awake: ZoneView = {
  ...forest,
  runes: [
    { x: 1, y: 1, active: true },
    { x: 4, y: 4, active: true },
  ],
};
const nearestCopper = goals.goal(awake, { x: 2, y: 70 });
assert.equal(nearestCopper?.x, 0);
assert.equal(nearestCopper?.y, 80);
assert.equal(model.t(nearestCopper?.text ?? 'map.goal_rune', nearestCopper?.params), 'Nästa mål: Kopparberg');

const stillRune = goals.goal({ ...awake, runes: [{ x: 5, y: 6, active: false }] }, { x: 90, y: 0 });
assert.equal(stillRune?.text, 'map.goal_rune');
assert.equal(stillRune?.x, 5);

const emptyForest: ZoneView = { ...forest, portals: [], runes: [] };
const town = goals.goal(emptyForest, { x: start.x, y: start.y });
const wolf = bigWorldCityPortalWorld('wolfstead');
assert.equal(town?.x, wolf.x);
assert.equal(town?.y, wolf.y);
assert.equal(model.t(town?.text ?? 'map.goal_rune', town?.params), 'Nästa mål: Vargaby');

console.log('big-world-waymarks.test.mts: ok', {
  signs: signs.length,
  milestones: marks.filter((w) => w.kind === 'milestone').length,
  lamps: marks.filter((w) => w.kind === 'lamp').length,
});
