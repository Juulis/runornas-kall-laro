import type { Vec2 } from '../core/GameContext';
import type { MonsterFactory } from '../entities/MonsterFactory';
import { FOREST_SPAWN_ACTIVE_RADIUS, MAX_LIVE_MONSTERS } from '../world/forestConstants';
import type { World } from './World';
import { isCampFieldUid } from '../world/bigWorld/campMonsterField';
import { peekBigWorldRuntime } from '../world/bigWorld/runtime';

/** Levande monster inom radien. Döda räknas inte, monster längre bort räknas inte. */
export function countLiveMonstersNear(w: World, hero: Vec2, radius = FOREST_SPAWN_ACTIVE_RADIUS): number {
  let n = 0;
  for (const m of w.monsters) {
    if ((m.dead ?? 0) > 0) continue;
    if (m.hp != null && m.hp <= 0) continue;
    if (Math.hypot(m.pos.x - hero.x, m.pos.y - hero.y) <= radius) n++;
  }
  return n;
}

/** Instansierar köade monster när hjälten är nära (Startskogen och lägerflocken). */
export function syncProximitySpawns(w: World, factory: MonsterFactory, hero: Vec2, cityState = 'besatt'): void {
  const streaming = w.zone.bigWorldStreaming;
  const insideLegacy = !streaming || peekBigWorldRuntime()?.heroInsideStartskogenRegion(hero) === true;
  if (streaming) {
    if (insideLegacy) factory.refillStartskogenQueue(w, cityState);
  } else if (w.zone.areaId !== 'startskogen') return;
  const r = FOREST_SPAWN_ACTIVE_RADIUS;
  let room = MAX_LIVE_MONSTERS - countLiveMonstersNear(w, hero, r);
  for (const q of w.spawnQueue) {
    if (room <= 0) break;
    if (streaming && !insideLegacy && !isCampFieldUid(q.spec.uid)) continue;
    if (q.done) continue;
    if (w.session.killed.has(q.spec.uid)) {
      q.done = true;
      continue;
    }
    if (Math.hypot(q.pos.x - hero.x, q.pos.y - hero.y) > r) continue;
    if (w.monsters.some((m) => m.uid === q.spec.uid)) {
      q.done = true;
      continue;
    }
    factory.create(w, q.spec.enemy, q.pos, q.spec.boss ? null : q.spec.level, q.spec);
    q.done = true;
    room--;
  }
}
