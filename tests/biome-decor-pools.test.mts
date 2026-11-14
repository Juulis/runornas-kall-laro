/**
 * Dekor per biom: egna pooler, laddade sprites och gång mellan dungar.
 * Kör: npx tsx tests/biome-decor-pools.test.mts
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECOR, STARTUP_DECOR, canonicalBiomeId, decorForBiome } from '../src/render/biomeAssetGroups';
import { decorPoolForBiome, planDecorForChunk, type PlannedDecor } from '../src/world/bigWorld/decorPlanner';
import { blendWeightsAtTile, pickWeightedBiomeId } from '../src/world/bigWorld/transitionResolver';
import { chunkRegionBiome, chunkWorldSeed } from '../src/world/bigWorld/worldGenerator';

const BIOMES = ['skog', 'trask', 'fjall', 'kust', 'ask'] as const;
const MIN_PASSAGE = 2.2;
const decorSet = new Set<string>(DECOR);
const decorDir = join(dirname(fileURLToPath(import.meta.url)), '../public/assets/2d/dekor');

function unionIds(biomeId: string): string[] {
  const pool = decorPoolForBiome(biomeId);
  return [...new Set([...pool.stor, ...pool.mellan, ...pool.liten])];
}

function shareCount(a: readonly string[], b: readonly string[]): number {
  const right = new Set(b);
  let n = 0;
  for (const id of a) if (right.has(id)) n += 1;
  return n;
}

for (const biomeId of BIOMES) {
  const ids = unionIds(biomeId);
  assert.ok(ids.length >= 8, `${biomeId} har bara ${ids.length} dekorsprites`);
  const loaded = new Set([...STARTUP_DECOR, ...decorForBiome(biomeId)]);
  for (const id of ids) {
    assert.ok(decorSet.has(id), `${biomeId} pool har id som saknas i DECOR: ${id}`);
    assert.ok(existsSync(join(decorDir, `${id}.png`)), `${biomeId} saknar dekor-png ${id}`);
    assert.ok(loaded.has(id), `${biomeId} laddar inte ${id}`);
  }
}

for (let i = 0; i < BIOMES.length; i += 1) {
  for (let j = i + 1; j < BIOMES.length; j += 1) {
    const left = BIOMES[i] ?? 'skog';
    const right = BIOMES[j] ?? 'skog';
    const shared = shareCount(unionIds(left), unionIds(right));
    assert.ok(shared <= 3, `${left} och ${right} delar ${shared} sprites`);
  }
}

function planAt(worldSeed: number, cx: number, cy: number): { biomeId: string; decor: PlannedDecor[] } {
  const biomeId = canonicalBiomeId(chunkRegionBiome(cx, cy));
  const decor = planDecorForChunk({
    worldSeed,
    chunkSeed: chunkWorldSeed(worldSeed, cx, cy),
    cx,
    cy,
    biomeId,
    pool: decorPoolForBiome(biomeId),
    blendBiomeAt: (gx, gy) => pickWeightedBiomeId(worldSeed, gx, gy, blendWeightsAtTile(worldSeed, gx, gy)),
  });
  return { biomeId, decor };
}

/** Minst fyra riktiga regionchunkar per biom. Gravåsen är skog. */
const SAMPLE: Record<(typeof BIOMES)[number], readonly (readonly [number, number])[]> = {
  skog: [
    [1, 1],
    [0, 1],
    [1, 0],
    [-1, 4],
  ],
  trask: [
    [-4, 1],
    [-5, 1],
    [-6, 1],
    [-7, 0],
  ],
  fjall: [
    [0, 7],
    [0, 8],
    [0, 9],
    [-1, 8],
  ],
  kust: [
    [-7, 3],
    [-8, 3],
    [-8, 2],
    [-6, 3],
  ],
  ask: [
    [0, -10],
    [0, -9],
    [1, -11],
    [-1, -10],
  ],
};

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let inter = 0;
  for (const id of a) if (b.has(id)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

const merged = new Map<string, Set<string>>();
for (const biomeId of BIOMES) {
  const bag = new Set<string>();
  for (const [cx, cy] of SAMPLE[biomeId]) {
    assert.equal(canonicalBiomeId(chunkRegionBiome(cx, cy)), biomeId, `${cx},${cy} ska vara ${biomeId}`);
    const { decor } = planAt(42, cx, cy);
    const own = new Set(unionIds(biomeId));
    const fromOwn = new Set(decor.map((item) => item.id).filter((id) => own.has(id)));
    assert.ok(fromOwn.size >= 3, `${biomeId} [${cx},${cy}] har bara ${fromOwn.size} egna sprites`);
    for (const id of decor.map((item) => item.id)) bag.add(id);
  }
  assert.ok(SAMPLE[biomeId].length >= 4, biomeId);
  merged.set(biomeId, bag);
}

const traskIds = merged.get('trask') ?? new Set<string>();
const fjallIds = merged.get('fjall') ?? new Set<string>();
const kustIds = merged.get('kust') ?? new Set<string>();
const skogIds = merged.get('skog') ?? new Set<string>();
const askIds = merged.get('ask') ?? new Set<string>();
assert.ok(jaccard(traskIds, fjallIds) < 0.35, `träsk/fjäll Jaccard ${jaccard(traskIds, fjallIds)}`);
assert.ok(jaccard(kustIds, skogIds) < 0.35, `kust/skog Jaccard ${jaccard(kustIds, skogIds)}`);
assert.ok(jaccard(askIds, skogIds) < 0.35, `ask/skog Jaccard ${jaccard(askIds, skogIds)}`);

const seenCollider = new Map<string, PlannedDecor>();
const seenOpen = new Map<string, PlannedDecor>();

function noteColliders(decor: readonly PlannedDecor[]): void {
  for (const item of decor) {
    if (
      item.layer === 'stor' &&
      (item.id === 'gran' || item.id === 'vindtall' || item.id === 'dod_tall' || item.id === 'stenblock' || item.id === 'pelare')
    ) {
      if (!seenCollider.has(item.id)) seenCollider.set(item.id, item);
    }
    if (item.id === 'kaveldun' || item.id === 'ljungtuva' || item.id === 'buske' || item.id === 'myrull') {
      if (!seenOpen.has(item.id)) seenOpen.set(item.id, item);
    }
  }
}

function gap(a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
}

function assertGaps(list: readonly PlannedDecor[], label: string): void {
  const cols = list.flatMap((item) => (item.collider ? [item.collider] : []));
  for (let i = 0; i < cols.length; i += 1) {
    for (let j = i + 1; j < cols.length; j += 1) {
      const left = cols[i];
      const right = cols[j];
      if (!left || !right) continue;
      const free = gap(left, right);
      assert.ok(free >= MIN_PASSAGE, `${label} gång ${free.toFixed(3)} < ${MIN_PASSAGE}`);
    }
  }
}

function assertCrossGaps(a: readonly PlannedDecor[], b: readonly PlannedDecor[], label: string): number {
  const left = a.flatMap((item) => (item.collider ? [item.collider] : []));
  const right = b.flatMap((item) => (item.collider ? [item.collider] : []));
  let pairs = 0;
  for (const one of left) {
    for (const other of right) {
      pairs += 1;
      const free = gap(one, other);
      assert.ok(free >= MIN_PASSAGE, `${label} gång över gräns ${free.toFixed(3)} < ${MIN_PASSAGE}`);
    }
  }
  return pairs;
}

const seeds = [3, 11, 42];
const anchors: readonly (readonly [number, number])[] = [
  [1, 1],
  [-1, 4],
  [-4, 1],
  [0, 8],
  [-7, 3],
  [0, -10],
];

const planned = new Map<string, PlannedDecor[]>();
let chunkCount = 0;
let crossPairs = 0;
for (const worldSeed of seeds) {
  for (const [ax, ay] of anchors) {
    for (let dx = -1; dx <= 2; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const cx = ax + dx;
        const cy = ay + dy;
        const key = `${worldSeed}:${cx}:${cy}`;
        if (planned.has(key)) continue;
        const { decor } = planAt(worldSeed, cx, cy);
        planned.set(key, decor);
        chunkCount += 1;
        noteColliders(decor);
        assertGaps(decor, `seed ${worldSeed} [${cx},${cy}]`);
      }
    }
  }
  for (const [key, decor] of planned) {
    const [seedText, cxText, cyText] = key.split(':');
    if (Number(seedText) !== worldSeed) continue;
    const cx = Number(cxText);
    const cy = Number(cyText);
    const east = planned.get(`${worldSeed}:${cx + 1}:${cy}`);
    const north = planned.get(`${worldSeed}:${cx}:${cy + 1}`);
    if (east) crossPairs += assertCrossGaps(decor, east, `seed ${worldSeed} [${cx},${cy}]-[${cx + 1},${cy}]`);
    if (north) crossPairs += assertCrossGaps(decor, north, `seed ${worldSeed} [${cx},${cy}]-[${cx},${cy + 1}]`);
  }
}

assert.ok(chunkCount >= 200, `bara ${chunkCount} chunkar`);
assert.ok(seeds.length >= 3);
assert.ok(crossPairs > 0, 'inget par över chunkgräns jämfördes');
assert.equal(canonicalBiomeId(chunkRegionBiome(-1, 4)), 'skog', 'Gravåsen ska vara skog');
assert.ok(planned.has('42:-1:4'), 'Gravåsen ska ingå i passageprovet');

for (const id of ['gran', 'vindtall', 'dod_tall', 'stenblock', 'pelare']) {
  const item = seenCollider.get(id);
  assert.ok(item, `hittade ingen ${id} i lager stor`);
  assert.equal(item.layer, 'stor');
  assert.ok(item.collider, `${id} i lager stor ska ha collider`);
  assert.ok(item.collider.r === 0.9 || item.collider.r === 0.8);
}

for (const id of ['kaveldun', 'ljungtuva', 'buske', 'myrull']) {
  const item = seenOpen.get(id);
  assert.ok(item, `hittade ingen ${id}`);
  assert.equal(item.collider, null, `${id} ska inte blockera`);
  assert.notEqual(item.layer, 'stor');
}

console.log('biome-decor-pools.test.mts: ok', {
  chunkCount,
  crossPairs,
  jaccard: {
    traskFjall: Number(jaccard(traskIds, fjallIds).toFixed(3)),
    kustSkog: Number(jaccard(kustIds, skogIds).toFixed(3)),
    askSkog: Number(jaccard(askIds, skogIds).toFixed(3)),
  },
});
