import assert from 'node:assert/strict';
import type { World } from '../src/systems/World';
import { Zone } from '../src/world/Zone';
import {
  MONSTER_RESPAWN_S,
  armRespawnsForKilled,
  isRespawnableUid,
  pendingRespawnCount,
  resetMonsterRespawns,
  scheduleMonsterRespawn,
  tickMonsterRespawns,
} from '../src/world/monsterRespawn';

resetMonsterRespawns();
assert.equal(isRespawnableUid('lager:3'), true);
assert.equal(isRespawnableUid('bw:1,1:0:skogsvarg'), true);
assert.equal(isRespawnableUid('startskogen:2:1'), true);
assert.equal(isRespawnableUid('quest:ulvhilds_pals:boss'), false);
assert.equal(isRespawnableUid('startskogen:boss'), false);
assert.equal(isRespawnableUid('grabjornen_ulvhild'), false);

const zone = new Zone('forest', 'startskogen', 64, 64);
zone.bigWorldStreaming = true;
const killed = new Set<string>(['lager:1', 'bw:0,1:0:skogsvarg', 'quest:miras_bror:champion', 'gamla_byn:boss']);
const w = {
  zone,
  session: { seed: 1, worldSeed: 1, killed },
  spawnQueue: [
    { spec: { uid: 'lager:1' }, pos: { x: 0, y: 0 }, done: true },
    { spec: { uid: 'startskogen:0:0' }, pos: { x: 1, y: 1 }, done: true },
  ],
  monsters: [],
} as unknown as World;

scheduleMonsterRespawn('lager:1', false);
scheduleMonsterRespawn('quest:miras_bror:champion', false);
scheduleMonsterRespawn('gamla_byn:boss', true);
assert.equal(pendingRespawnCount(), 1, 'bara vanliga monster köas');

tickMonsterRespawns(w, MONSTER_RESPAWN_S - 0.5);
assert.equal(killed.has('lager:1'), true);
tickMonsterRespawns(w, 1);
assert.equal(killed.has('lager:1'), false, 'vanligt monster ska kunna spawnas igen');
assert.equal(w.spawnQueue[0]?.done, false, 'lägerkön öppnas när monstret återvänder');
assert.equal(killed.has('quest:miras_bror:champion'), true);
assert.equal(killed.has('gamla_byn:boss'), true);

resetMonsterRespawns();
armRespawnsForKilled(killed);
assert.equal(pendingRespawnCount(), 1, 'bw-uid från sparfilen ska rustas, quest ska inte');
tickMonsterRespawns(w, MONSTER_RESPAWN_S);
assert.equal(killed.has('bw:0,1:0:skogsvarg'), false);
assert.equal(killed.has('quest:miras_bror:champion'), true);
resetMonsterRespawns();

console.log('monster-respawn.test.mts: ok');
