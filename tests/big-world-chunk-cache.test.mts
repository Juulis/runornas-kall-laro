import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChunkWorldCache } from '../src/world/bigWorld/chunkCache';
import { chunkWorldSeed } from '../src/world/bigWorld/worldGenerator';
import { Zone } from '../src/world/Zone';

const cache = new ChunkWorldCache({ maxEntries: 64, keepRadius: 2 });
const worldSeed = 99;
const gameSeed = 99;
cache.syncNear(worldSeed, gameSeed, 0, 0);
assert.equal(cache.size(), 25);
cache.syncNear(worldSeed, gameSeed, 20, 20);
assert.ok(cache.size() <= 25);
for (let dx = -2; dx <= 2; dx++) {
  for (let dy = -2; dy <= 2; dy++) {
    assert.equal(cache.get(worldSeed, gameSeed, 20 + dx, 20 + dy).cx, 20 + dx);
  }
}

const bounded = new ChunkWorldCache({ maxEntries: 12, keepRadius: 1 });
for (let step = 0; step < 40; step++) {
  bounded.syncNear(worldSeed, gameSeed, step, 0);
  assert.ok(bounded.size() <= 12);
}

const evict = new ChunkWorldCache({ maxEntries: 9, keepRadius: 1 });
for (let i = 0; i < 20; i++) evict.get(worldSeed, gameSeed, i, 0);
assert.ok(evict.size() <= 9);

const worldA = 111;
const worldB = 222;
const gs = 333;
const cx = 0;
const cy = -3;
const cache2 = new ChunkWorldCache({ maxEntries: 64, keepRadius: 2 });
cache2.syncNear(worldA, gs, cx, cy);
const rollA = cache2.get(worldA, gs, cx, cy);
assert.equal(rollA.chunkSeed, chunkWorldSeed(worldA, cx, cy));
assert.ok(rollA.spawns.length > 0);
cache2.syncNear(worldB, gs, cx, cy);
const rollB = cache2.get(worldB, gs, cx, cy);
assert.equal(rollB.chunkSeed, chunkWorldSeed(worldB, cx, cy));
assert.ok(rollB.spawns.length > 0);
assert.notEqual(rollA.chunkSeed, rollB.chunkSeed);

const cache3 = new ChunkWorldCache({ maxEntries: 64, keepRadius: 1 });
cache3.get(worldA, gs, 0, 0);
cache3.get(worldB, gs, 0, 0);
assert.equal(cache3.get(worldB, gs, 0, 0).chunkSeed, chunkWorldSeed(worldB, 0, 0));

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const groundSrc = readFileSync(join(root, 'src/world/bigWorld/BigWorldStreamGround.ts'), 'utf8');
assert.equal(groundSrc.includes('colliders.remove('), true);
assert.equal(groundSrc.includes('colliders.push('), true);
assert.equal(groundSrc.includes('colliders.indexOf'), false);
assert.equal(groundSrc.includes('colliders.splice'), false);

// Samma kontrakt som dropChunkVisual: cirklar pushas per chunk och remove tar bort just den chunken.
const streamed = new Zone('forest', 'stream-kollision', 256, 256);
function pushChunk(baseX: number, count: number): { x: number; y: number; r: number }[] {
  const list: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < count; i++) {
    const collider = { x: baseX + i * 4, y: 6, r: 0.9 };
    streamed.colliders.push(collider);
    list.push(collider);
  }
  return list;
}
const unloaded = pushChunk(0, 5);
const kept = pushChunk(80, 4);
assert.equal(streamed.colliders.length, unloaded.length + kept.length);
for (const collider of unloaded) streamed.colliders.remove(collider);
assert.equal(streamed.colliders.length, kept.length);
const still = [...streamed.colliders];
for (const collider of kept) assert.equal(still.includes(collider), true);
for (const collider of unloaded) {
  assert.equal(still.includes(collider), false);
  const p = { x: collider.x + 0.2, y: collider.y };
  streamed.collide(p, 0.4);
  assert.equal(p.x, collider.x + 0.2);
  assert.equal(p.y, collider.y);
}
const kept0 = kept[0];
assert.ok(kept0);
const keptHit = { x: kept0.x + 0.2, y: kept0.y };
streamed.collide(keptHit, 0.4);
assert.notEqual(keptHit.x, kept0.x + 0.2);

console.log('big-world-chunk-cache.test.mts: ok');
