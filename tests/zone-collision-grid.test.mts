/**
 * Spatialt kollisionsrutnät: samma putt som den gamla linjära listan, plus blocked-API.
 * Kör: npx tsx tests/zone-collision-grid.test.mts
 */
import assert from 'node:assert/strict';
import type { Collider } from '../src/core/GameContext';
import { Rng } from '../src/core/Rng';
import { TILE_WORLD } from '../src/render/Iso';
import { chunkMinWorld, chunkTileCount, worldToChunk } from '../src/world/bigWorld/bigWorldCoords';
import { COLLIDER_CELL } from '../src/world/ColliderGrid';
import { Zone } from '../src/world/Zone';

assert.equal(COLLIDER_CELL, 8);

/** Referens: dagens linjära collide (en genomgång + circle/rect-gräns). */
function linearCollide(
  colliders: readonly Collider[],
  bounds: { circle?: number; rect?: readonly [number, number] },
  p: { x: number; y: number },
  r: number,
): void {
  for (const c of colliders) {
    if (c.off) continue;
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const d = Math.hypot(dx, dy);
    const m = c.r + r;
    if (d < m && d > 1e-4) {
      p.x = c.x + (dx / d) * m;
      p.y = c.y + (dy / d) * m;
    }
  }
  if (bounds.circle) {
    const d = Math.hypot(p.x, p.y);
    const lim = bounds.circle - r;
    if (d > lim) {
      p.x *= lim / d;
      p.y *= lim / d;
    }
  } else if (bounds.rect) {
    const [a, b] = bounds.rect;
    p.x = Math.max(a + r, Math.min(b - r, p.x));
    p.y = Math.max(a + r, Math.min(b - r, p.y));
  }
}

function samePoint(actual: { x: number; y: number }, expected: { x: number; y: number }, label: string): void {
  assert.ok(
    Object.is(actual.x, expected.x) && Object.is(actual.y, expected.y),
    `${label}: (${actual.x}, ${actual.y}) !== (${expected.x}, ${expected.y})`,
  );
}

function expectSame(zone: Zone, linear: readonly Collider[], x: number, y: number, r: number, label: string): void {
  const a = { x, y };
  const b = { x, y };
  linearCollide(linear, zone, a, r);
  zone.collide(b, r);
  samePoint(b, a, label);
}

const built = buildSample();
assert.equal(built.linear.length, 500);
assert.equal(built.zone.colliders.length, 500);
let order = 0;
for (const c of built.zone.colliders) {
  assert.equal(c, built.linear[order]);
  order += 1;
}

const sameCell = new Zone('forest', 'samma-cell', 40, 40);
const sameLinear: Collider[] = [
  { x: 0, y: 0, r: 2 },
  { x: 3, y: 0, r: 2 },
  { x: 6, y: 0, r: 2 },
];
for (const c of sameLinear) sameCell.colliders.push(c);
expectSame(sameCell, sameLinear, 0.5, 0, 0.5, 'kedja i samma cell');

const crossCell = new Zone('forest', 'ny-cell', 40, 40);
const crossLinear: Collider[] = [
  { x: 0, y: 0, r: 6 },
  { x: 8, y: 0, r: 6 },
];
for (const c of crossLinear) crossCell.colliders.push(c);
expectSame(crossCell, crossLinear, 0.5, 0, 0.5, 'putt över cellgräns');
const crossOnce = { x: 0.5, y: 0 };
crossCell.collide(crossOnce, 0.5);
assert.ok(crossOnce.x < 6.5, `utan omfrågning stannar p på 6.5, fick ${crossOnce.x}`);

const rngPoints = new Rng(0x0c0111de);
for (let i = 0; i < 10000; i++) {
  const x = rngPoints.float(-240, 240);
  const y = rngPoints.float(-240, 240);
  const r = rngPoints.float(0.05, 2.8);
  expectSame(built.zone, built.linear, x, y, r, `cirkelzon punkt ${i}`);
}

const rectZone = new Zone('forest', 'eq-rect', 800, 800);
rectZone.rect = [-160, 160];
for (const c of built.linear) rectZone.colliders.push(c);
const rngRect = new Rng(0x0c0111df);
for (let i = 0; i < 10000; i++) {
  const x = rngRect.float(-240, 240);
  const y = rngRect.float(-240, 240);
  const r = rngRect.float(0.05, 2.8);
  expectSame(rectZone, built.linear, x, y, r, `rektangelzon punkt ${i}`);
}

const bench = new Zone('forest', 'bench', 400, 400);
const benchRng = new Rng(0xbe7c);
for (let i = 0; i < 2000; i++) {
  bench.colliders.push({
    x: benchRng.float(-128, 128),
    y: benchRng.float(-128, 128),
    r: benchRng.float(0.45, 1.4),
  });
}
const bodies = Array.from({ length: 60 }, () => ({ x: 0, y: 0 }));
for (const body of bodies) {
  body.x = benchRng.float(-128, 128);
  body.y = benchRng.float(-128, 128);
}
const home = bodies.map((body) => ({ x: body.x, y: body.y }));
const radius = 0.45;
function benchFrame(): void {
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const start = home[i];
    if (!body || !start) continue;
    body.x = start.x;
    body.y = start.y;
    bench.collide(body, radius);
  }
}
for (let i = 0; i < 20; i++) benchFrame();
const samples: number[] = [];
for (let i = 0; i < 21; i++) {
  const t0 = performance.now();
  benchFrame();
  samples.push(performance.now() - t0);
}
samples.sort((a, b) => a - b);
const median = samples[10] ?? Number.POSITIVE_INFINITY;
console.log(`zone-collision-grid microbench: median ${median.toFixed(3)} ms`);
assert.ok(median < 1, `en frame tog ${median.toFixed(3)} ms, gränsen är 1 ms`);

const edit = new Zone('forest', 'edit', 80, 80);
assert.equal(edit.colliders.length, 0);
assert.equal(
  edit.colliders.every(() => false),
  true,
);
const ghost = { x: 3, y: 3, r: 1 };
edit.colliders.remove(ghost);
assert.equal(edit.colliders.length, 0);

const keep = { x: 30, y: 0, r: 1.2 };
const drop = { x: 0, y: 0, r: 1.2 };
edit.colliders.push(drop);
edit.colliders.push(keep);
const hit = { x: 0.4, y: 0 };
edit.collide(hit, 0.4);
assert.notEqual(hit.x, 0.4);
edit.colliders.remove(drop);
const after = { x: 0.4, y: 0 };
edit.collide(after, 0.4);
assert.equal(after.x, 0.4);
assert.equal(after.y, 0);
assert.deepEqual(
  [...edit.colliders].map((c) => c),
  [keep],
);
edit.colliders.remove(drop);
assert.equal(edit.colliders.length, 1);
edit.colliders.push(drop);
assert.deepEqual([...edit.colliders], [keep, drop]);
const again = { x: 0.4, y: 0 };
edit.collide(again, 0.4);
assert.notEqual(again.x, 0.4);

const chunks = new Zone('forest', 'chunks', 200, 200);
const chunkA = [
  { x: 1, y: 1, r: 0.8 },
  { x: 2, y: 1.2, r: 0.8 },
  { x: 20, y: 1, r: 0.8 },
];
const chunkB = [
  { x: 100, y: 40, r: 0.9 },
  { x: 104, y: 42, r: 0.7 },
];
for (const c of chunkA) chunks.colliders.push(c);
for (const c of chunkB) chunks.colliders.push(c);
for (const c of chunkA) chunks.colliders.remove(c);
assert.equal(chunks.colliders.length, chunkB.length);
const left = [...chunks.colliders];
for (const c of chunkB) assert.equal(left.includes(c), true);
for (const c of chunkA) {
  assert.equal(left.includes(c), false);
  const p = { x: c.x + 0.15, y: c.y };
  chunks.collide(p, 0.3);
  assert.equal(p.x, c.x + 0.15);
  assert.equal(p.y, c.y);
}
const b0 = chunkB[0];
assert.ok(b0);
const nearB = { x: b0.x + 0.2, y: b0.y };
chunks.collide(nearB, 0.3);
assert.notEqual(nearB.x, b0.x + 0.2);

const off = { x: 0, y: 0, r: 5, off: true };
chunks.colliders.push(off);
const ignored = { x: 0.2, y: 0.1 };
chunks.collide(ignored, 0.4);
assert.equal(ignored.x, 0.2);
assert.equal(ignored.y, 0.1);
assert.equal([...chunks.colliders].includes(off), true);
chunks.colliders.remove(off);
assert.equal([...chunks.colliders].includes(off), false);
assert.equal(
  chunks.colliders.every((c) => c !== off),
  true,
);

const walk = new Zone('forest', 'blocked-walk', 20, 20);
walk.setBlocked(0, 0, true);
const free = { x: 0, y: 0 };
walk.collide(free, 0.5);
assert.equal(free.x, 0);
assert.equal(free.y, 0);

const mask = new Zone('village', 'spärr', 64, 64);
assert.equal(mask.blocked(0, 0), false);
assert.equal(mask.blocked(-1000, 800), false);
const spotX = 10;
const spotY = -20;
assert.equal(mask.blocked(spotX, spotY), false);
mask.setBlocked(spotX, spotY, true);
const here = worldToChunk(spotX, spotY);
const origin = chunkMinWorld(here.cx, here.cy);
const ti = Math.floor((spotX - origin.x) / TILE_WORLD);
const tj = Math.floor((spotY - origin.y) / TILE_WORLD);
const x0 = origin.x + ti * TILE_WORLD;
const y0 = origin.y + tj * TILE_WORLD;
assert.equal(mask.blocked(x0, y0), true);
assert.equal(mask.blocked(x0 + 0.25, y0 + 0.5), true);
assert.equal(mask.blocked(x0 + TILE_WORLD - 0.001, y0 + TILE_WORLD - 0.001), true);
assert.equal(mask.blocked(x0 + TILE_WORLD, y0), false);
assert.equal(mask.blocked(x0 - 0.001, y0), false);
assert.equal(mask.blocked(x0, y0 + TILE_WORLD), false);
assert.equal(mask.blocked(x0, y0 - 0.001), false);

const tiles = chunkTileCount();
const cornerX = origin.x + (tiles - 1) * TILE_WORLD + 0.25;
const cornerY = origin.y + (tiles - 1) * TILE_WORLD + 0.25;
mask.setBlocked(cornerX, cornerY, true);
assert.equal(mask.blocked(cornerX, cornerY), true);
mask.setBlocked(spotX, spotY, false);
assert.equal(mask.blocked(spotX, spotY), false);
assert.equal(mask.blocked(x0 + 0.1, y0 + 0.1), false);
assert.equal(mask.blocked(cornerX, cornerY), true);

const other = chunkMinWorld(here.cx + 2, here.cy - 1);
const otherX = other.x + TILE_WORLD * 3 + 0.5;
const otherY = other.y + TILE_WORLD * 4 + 0.5;
assert.equal(mask.blocked(otherX, otherY), false);
mask.setBlocked(otherX, otherY, true);
assert.equal(mask.blocked(otherX, otherY), true);
mask.clearBlockedChunk(here.cx, here.cy);
assert.equal(mask.blocked(cornerX, cornerY), false);
assert.equal(mask.blocked(spotX, spotY), false);
assert.equal(mask.blocked(otherX, otherY), true);
mask.clearBlockedChunk(here.cx + 2, here.cy - 1);
assert.equal(mask.blocked(otherX, otherY), false);
mask.clearBlockedChunk(here.cx + 9, here.cy + 9);
assert.equal(mask.blocked(0, 0), false);
mask.setBlocked(otherX, otherY, true);
assert.equal(mask.blocked(otherX, otherY), true);

console.log('zone-collision-grid.test.mts: ok');

function buildSample(): { zone: Zone; linear: Collider[] } {
  const rng = new Rng(0x5e6705);
  const linear: Collider[] = [];
  const zone = new Zone('forest', 'eq-circle', 900, 900);
  zone.circle = 180;
  const add = (c: Collider): void => {
    linear.push(c);
    zone.colliders.push(c);
  };
  // Kedja i en cell: senare cirklar ska puttas efter att den första flyttat p.
  add({ x: 0, y: 0, r: 2 });
  add({ x: 3, y: 0, r: 2 });
  add({ x: 6, y: 0, r: 2 });
  // Stor radie så en putt når en cirkel i nästa cell, utanför första uppslaget.
  add({ x: 0, y: 40, r: 6 });
  add({ x: 8, y: 40, r: 6 });
  let guard = 0;
  while (linear.length < 70 && guard < 400) {
    guard += 1;
    const c: Collider = {
      x: 12 + rng.float(-3, 3),
      y: -6 + rng.float(-3, 3),
      r: rng.float(0.35, 2.4),
    };
    if (rng.chance(0.12)) c.off = true;
    add(c);
  }
  while (linear.length < 100) {
    add({
      x: rng.float(-360, 360),
      y: rng.float(-360, 360),
      r: rng.float(4, 14),
      ...(rng.chance(0.1) ? { off: true } : {}),
    });
  }
  while (linear.length < 480) {
    const c: Collider = {
      x: rng.float(-420, 420),
      y: rng.float(-420, 420),
      r: rng.float(0.2, 3.2),
    };
    if (rng.chance(0.08)) c.off = true;
    add(c);
  }
  while (linear.length < 500) {
    const i = linear.length - 480;
    const c: Collider = { x: i * COLLIDER_CELL, y: -i * COLLIDER_CELL, r: 1.25 };
    if (i % 5 === 0) c.off = true;
    add(c);
  }
  return { zone, linear };
}
