import assert from 'node:assert/strict';
import { DATA } from '../src/data/index';
import { expandStartskogenArea } from '../src/data/startskogenExpand';
import { SpawnSystem } from '../src/systems/SpawnSystem';
import { createSession } from '../src/core/Session';
import { FOREST_AREA_SCALE, FOREST_LEGACY_RADIUS, FOREST_PLAY_RADIUS } from '../src/world/forestConstants';

const base = DATA.spawn.areas.find((a) => a.id === 'startskogen');
assert.ok(base);
const expanded = expandStartskogenArea(base);
assert.equal(expanded.session_roll?.active_spawn_points?.[0], 6);
assert.equal(expanded.session_roll?.active_spawn_points?.[1], 8);
assert.deepEqual(expanded.session_roll?.groups_total, [12, 24]);

const areaRatio = (FOREST_PLAY_RADIUS / FOREST_LEGACY_RADIUS) ** 2;
assert.ok(Math.abs(areaRatio - FOREST_AREA_SCALE) < 0.05, `yta ~10×: ${areaRatio}`);

const spawn = new SpawnSystem();
let totalMonsters = 0;
const seeds = 200;
for (let seed = 0; seed < seeds; seed++) {
  const session = createSession();
  session.worldSeed = seed;
  session.seed = seed;
  totalMonsters += spawn.roll(spawn.area('startskogen'), session, {}).length;
}
const avg = totalMonsters / seeds;
assert.ok(avg >= 31 && avg <= 37, `Rungläntan ~34 monster/game (ca 2–3×), medel ${avg}`);

console.log('forest-scale.test.mts: ok');
