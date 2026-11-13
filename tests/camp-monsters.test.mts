import assert from 'node:assert/strict';
import { DATA } from '../src/data';
import { Zone } from '../src/world/Zone';
import type { World } from '../src/systems/World';
import {
  CAMP_SAFE_RADIUS,
  START_POS_SAFE_RADIUS,
  campFirePos,
  campMonsterSpecs,
  keepOutsideSafeRadius,
} from '../src/world/bigWorld/campMonsterField';
import { worldToChunk } from '../src/world/bigWorld/bigWorldCoords';
import { generateChunkWorldData } from '../src/world/bigWorld/worldGenerator';
import { campStartPos } from '../src/world/bigWorld/startskogenFootprint';
import { ensureStartskogenSpawnQueue, spawnPointInsideStartskogenFootprint } from '../src/world/bigWorld/startskogenSpawn';
import { syncProximitySpawns } from '../src/systems/SpawnProximity';
import { FOREST_SPAWN_ACTIVE_RADIUS } from '../src/world/forestConstants';
import { HERO_WORLD_SPEED_MULT } from '../src/logic/heroMovement';

const start = campStartPos();
const fire = campFirePos();
const chunk = worldToChunk(start.x, start.y);
assert.deepEqual(chunk, { cx: 0, cy: 0 }, 'hjälten startar i lägrets chunk');

const home = generateChunkWorldData(7, 7, chunk.cx, chunk.cy);
assert.equal(home.safe, true, 'startlagret är en säker chunk');
assert.equal(home.spawns.length, 0, 'chunk-generatorn lägger inga monster i lägret');

const distToGlade = Math.hypot(start.x, start.y);
assert.ok(distToGlade > 100, 'Rungläntans pack vid origo ligger långt från lägret');

const specs = campMonsterSpecs(7);
assert.ok(specs.length >= 40, `lägerflocken ska vara stor (${specs.length})`);
const walkSpeed = 6.2 * HERO_WORLD_SPEED_MULT;
const walk6 = walkSpeed * 6;
let near = 0;
let inView = 0;
let withinWalk = 0;
for (const s of specs) {
  const dFire = Math.hypot(s.pos[0] - fire.x, s.pos[1] - fire.y);
  assert.ok(dFire >= CAMP_SAFE_RADIUS + 0.5, `${s.uid} inne i gläntan`);
  const d = Math.hypot(s.pos[0] - start.x, s.pos[1] - start.y);
  assert.ok(d >= START_POS_SAFE_RADIUS - 0.05, `${s.uid} för nära start (${d.toFixed(2)})`);
  assert.equal(
    spawnPointInsideStartskogenFootprint({ x: s.pos[0], y: s.pos[1] }),
    false,
    'lägerflock får inte filtreras bort som legacy-chunk',
  );
  assert.ok(d <= FOREST_SPAWN_ACTIVE_RADIUS, `${s.uid} ska aktiveras från start`);
  if (d <= 36) near++;
  if (d <= 28) inView++;
  if (d <= walk6) withinWalk++;
}
assert.ok(near >= 16, `minst en ring nära start, fick ${near}`);
assert.ok(inView >= 8, `inre ringen ska synas från start, fick ${inView}`);
assert.ok(withinWalk >= 1, `minst ett lägermonster inom 6 s gång (${walkSpeed.toFixed(2)} enheter/s), fick ${withinWalk}`);

const again = campMonsterSpecs(7);
assert.deepEqual(
  again.map((s) => [s.uid, s.enemy, s.pos[0], s.pos[1]]),
  specs.map((s) => [s.uid, s.enemy, s.pos[0], s.pos[1]]),
  'samma seed ger samma flock',
);

const zone = new Zone('forest', 'startskogen', 4096, 4096);
zone.bigWorldStreaming = true;
zone.safeRadius = CAMP_SAFE_RADIUS;
zone.safeCenter = fire;
const w = {
  zone,
  session: { seed: 7, worldSeed: 7, killed: new Set<string>() },
  spawnQueue: [],
  monsters: [] as { uid: string; pos: { x: number; y: number }; dead: number }[],
} as unknown as World;

ensureStartskogenSpawnQueue(w, () => {
  const area = DATA.spawn.areas.find((a) => a.id === 'startskogen');
  assert.ok(area);
  return [];
});
const lager = w.spawnQueue.filter((q) => q.spec.uid.startsWith('lager:'));
assert.equal(lager.length, specs.length);

const factory = {
  refillStartskogenQueue() {},
  create(_w: World, _id: string, p: { x: number; y: number }, _lvl: number, spec: { uid: string }) {
    w.monsters.push({ uid: spec.uid, pos: { ...p }, dead: 0 });
  },
};
syncProximitySpawns(w, factory as never, start, 'besatt');
const aliveNear = w.monsters.filter((m) => Math.hypot(m.pos.x - start.x, m.pos.y - start.y) <= 36);
assert.ok(aliveNear.length >= 16, `aktiva monster nära start: ${aliveNear.length}`);

const chased = { x: fire.x + 2, y: fire.y };
keepOutsideSafeRadius(chased, fire, CAMP_SAFE_RADIUS);
assert.ok(Math.hypot(chased.x - fire.x, chased.y - fire.y) >= CAMP_SAFE_RADIUS - 0.01, 'jagande lägermonster puttas ut ur gläntan');
const outside = { x: fire.x + CAMP_SAFE_RADIUS + 6, y: fire.y };
keepOutsideSafeRadius(outside, fire, CAMP_SAFE_RADIUS);
assert.equal(outside.x, fire.x + CAMP_SAFE_RADIUS + 6, 'monster utanför gläntan ska stå kvar');
const center = { x: fire.x, y: fire.y };
keepOutsideSafeRadius(center, fire, CAMP_SAFE_RADIUS);
assert.ok(Math.hypot(center.x - fire.x, center.y - fire.y) >= CAMP_SAFE_RADIUS - 0.01, 'mittpunkten puttas ut');

console.log('camp-monsters.test.mts: ok');
