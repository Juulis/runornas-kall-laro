import type { Vec2 } from '../../core/GameContext';
import type { MonsterFactory } from '../../entities/MonsterFactory';
import { FOREST_SPAWN_ACTIVE_RADIUS, MAX_LIVE_MONSTERS } from '../forestConstants';
import { countLiveMonstersNear } from '../../systems/SpawnProximity';
import type { World } from '../../systems/World';
import type { SpawnSpec } from '../../systems/SpawnSystem';
import type { ChunkWorldCache } from './chunkCache';
import { chunkSpawnToWorld, parseBigWorldSpawnUid, worldToChunk } from './bigWorldCoords';
import { BIG_WORLD_MONSTER_SPAWN_BUDGET } from './bigWorldConfig';
import { isCampFieldUid } from './campMonsterField';
import { releaseStartskogenQueueSlot } from './startskogenSpawn';

function bwSpec(uid: string, enemy: string, level: number, elite: SpawnSpec['elite'] = null): SpawnSpec {
  return {
    uid,
    enemy,
    pos: [0, 0],
    level,
    elite,
    modifiers: [],
    boss: false,
  };
}

let lastHeroChunkCx = NaN;
let lastHeroChunkCy = NaN;
const liveUids = new Set<string>();
const nearChunksBuf: { cx: number; cy: number }[] = [];

function fillNearChunks(wx: number, wy: number, r: number): { cx: number; cy: number }[] {
  nearChunksBuf.length = 0;
  const c0 = worldToChunk(wx - r, wy - r);
  const c1 = worldToChunk(wx + r, wy - r);
  const c2 = worldToChunk(wx - r, wy + r);
  const c3 = worldToChunk(wx + r, wy + r);
  const corners = [c0, c1, c2, c3];
  let minCx = c0.cx;
  let maxCx = c0.cx;
  let minCy = c0.cy;
  let maxCy = c0.cy;
  for (const c of corners) {
    minCx = Math.min(minCx, c.cx);
    maxCx = Math.max(maxCx, c.cx);
    minCy = Math.min(minCy, c.cy);
    maxCy = Math.max(maxCy, c.cy);
  }
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) nearChunksBuf.push({ cx, cy });
  }
  return nearChunksBuf;
}

function refreshLiveUids(w: World): Set<string> {
  liveUids.clear();
  for (const m of w.monsters) {
    if (m.uid) liveUids.add(m.uid);
  }
  return liveUids;
}

function isStreamedMonsterUid(uid: string): boolean {
  if (parseBigWorldSpawnUid(uid)) return true;
  if (uid.startsWith('startskogen:')) return true;
  if (isCampFieldUid(uid)) return true;
  return false;
}

/** Avlägsnar bw:- och legacy startskogen-monster utanför aktiv radie — quest/boss lämnas. */
function despawnFarStreamed(w: World, hero: Vec2, r: number): void {
  for (let i = w.monsters.length - 1; i >= 0; i--) {
    const mon = w.monsters[i];
    if (!mon?.uid) continue;
    if (mon.boss) continue;
    if (mon.uid.startsWith('quest:')) continue;
    if (!isStreamedMonsterUid(mon.uid)) continue;
    if (Math.hypot(mon.pos.x - hero.x, mon.pos.y - hero.y) <= r) continue;
    releaseStartskogenQueueSlot(w, mon.uid);
    mon.view.destroy({ children: true });
    w.objects.removeChild(mon.view);
    w.monsters.splice(i, 1);
  }
}

function spawnNearHero(
  w: World,
  cache: ChunkWorldCache,
  factory: MonsterFactory,
  worldSeed: number,
  gameSeed: number,
  hero: Vec2,
  live: Set<string>,
  budget: number,
): number {
  let spawned = 0;
  const spawnR = FOREST_SPAWN_ACTIVE_RADIUS;
  let room = MAX_LIVE_MONSTERS - countLiveMonstersNear(w, hero, spawnR);
  for (const { cx: ccx, cy: ccy } of fillNearChunks(hero.x, hero.y, spawnR)) {
    if (spawned >= budget || room <= 0) break;
    const data = cache.get(worldSeed, gameSeed, ccx, ccy);
    if (data.safe) continue;
    if (data.spawns.length === 0) continue;
    for (const s of data.spawns) {
      if (spawned >= budget || room <= 0) break;
      if (w.session.killed.has(s.uid)) continue;
      if (live.has(s.uid)) continue;
      const pos = chunkSpawnToWorld(ccx, ccy, s.localX, s.localY);
      if (Math.hypot(pos.x - hero.x, pos.y - hero.y) > spawnR) continue;
      w.zone.collide(pos, 0.5);
      factory.create(w, s.enemy, pos, s.level, bwSpec(s.uid, s.enemy, s.level, s.elite ?? null));
      live.add(s.uid);
      spawned++;
      room--;
    }
  }
  return spawned;
}

/** Instansierar/avlässnar chunk-monster; spawn fylls på varje frame, cache-sync vid chunkbyte. */
export function syncBigWorldChunkMonsters(
  w: World,
  cache: ChunkWorldCache,
  factory: MonsterFactory,
  worldSeed: number,
  gameSeed: number,
  hero: Vec2,
): void {
  if (!w.zone.bigWorldStreaming) return;

  const { cx, cy } = worldToChunk(hero.x, hero.y);
  const chunkChanged = cx !== lastHeroChunkCx || cy !== lastHeroChunkCy;
  if (chunkChanged) {
    lastHeroChunkCx = cx;
    lastHeroChunkCy = cy;
  }
  cache.syncNear(worldSeed, gameSeed, cx, cy);

  const despawnR = FOREST_SPAWN_ACTIVE_RADIUS + 8;
  despawnFarStreamed(w, hero, despawnR);

  const live = refreshLiveUids(w);
  spawnNearHero(w, cache, factory, worldSeed, gameSeed, hero, live, BIG_WORLD_MONSTER_SPAWN_BUDGET);
}

export function resetBigWorldMonsterSync(): void {
  lastHeroChunkCx = NaN;
  lastHeroChunkCy = NaN;
  liveUids.clear();
}
