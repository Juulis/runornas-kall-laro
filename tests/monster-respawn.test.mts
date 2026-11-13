import assert from 'node:assert/strict';
import type { World } from '../src/systems/World';
import { Zone } from '../src/world/Zone';
import {
  CAMP_MONSTER_RESPAWN_S,
  MONSTER_RESPAWN_JITTER_S,
  MONSTER_RESPAWN_MIN_DIST,
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
const spawn = { x: 100, y: 40 };
const w = {
  zone,
  session: { seed: 1, worldSeed: 1, killed },
  spawnQueue: [
    { spec: { uid: 'lager:1' }, pos: { x: 0, y: 0 }, done: true },
    { spec: { uid: 'startskogen:0:0' }, pos: { x: 1, y: 1 }, done: true },
  ],
  monsters: [],
  hero: { pos: { x: spawn.x + 10, y: spawn.y } },
} as unknown as World;

const regularUid = 'bw:4,4:0:skogsvarg';
killed.add(regularUid);
scheduleMonsterRespawn(regularUid, false, spawn);
scheduleMonsterRespawn('quest:miras_bror:champion', false);
scheduleMonsterRespawn('gamla_byn:boss', true);
assert.equal(pendingRespawnCount(), 1, 'bara vanliga monster köas');

const early = MONSTER_RESPAWN_S - MONSTER_RESPAWN_JITTER_S;
tickMonsterRespawns(w, early - 0.05);
assert.equal(killed.has(regularUid), true, 'vanligt monster återuppstår inte före 60 s');

w.hero.pos.x = spawn.x + 10;
w.hero.pos.y = spawn.y;
tickMonsterRespawns(w, 80);
assert.equal(killed.has(regularUid), true, 'inte medan hjälten är närmare än 40');
assert.equal(pendingRespawnCount(), 1);

w.hero.pos.x = spawn.x + MONSTER_RESPAWN_MIN_DIST + 5;
w.hero.pos.y = spawn.y;
tickMonsterRespawns(w, 0.1);
assert.equal(killed.has(regularUid), false, 'tillbaka när tiden är ute och hjälten är långt borta');
assert.equal(pendingRespawnCount(), 0);

resetMonsterRespawns();
const campPos = { x: 0, y: 0 };
w.hero.pos.x = 10;
w.hero.pos.y = 0;
scheduleMonsterRespawn('lager:1', false, campPos);
const campEarly = CAMP_MONSTER_RESPAWN_S - MONSTER_RESPAWN_JITTER_S;
tickMonsterRespawns(w, campEarly - 0.05);
assert.equal(killed.has('lager:1'), true, 'lägerflock återuppstår inte före 105 s');
tickMonsterRespawns(w, 80);
assert.equal(killed.has('lager:1'), true, 'lägerflock väntar när hjälten är nära');
w.hero.pos.x = MONSTER_RESPAWN_MIN_DIST + 5;
tickMonsterRespawns(w, 0.1);
assert.equal(killed.has('lager:1'), false, 'lägerflock kommer tillbaka när hjälten är långt borta');
assert.equal(w.spawnQueue[0]?.done, false, 'lägerkön öppnas när monstret återvänder');
assert.equal(killed.has('quest:miras_bror:champion'), true);
assert.equal(killed.has('gamla_byn:boss'), true);

resetMonsterRespawns();
armRespawnsForKilled(killed);
assert.equal(pendingRespawnCount(), 1, 'bw-uid från sparfilen ska rustas, quest ska inte');
w.hero.pos.x = 10000;
w.hero.pos.y = 10000;
tickMonsterRespawns(w, MONSTER_RESPAWN_S + MONSTER_RESPAWN_JITTER_S + 1);
assert.equal(killed.has('bw:0,1:0:skogsvarg'), false);
assert.equal(killed.has('quest:miras_bror:champion'), true);
resetMonsterRespawns();

console.log('monster-respawn.test.mts: ok');
