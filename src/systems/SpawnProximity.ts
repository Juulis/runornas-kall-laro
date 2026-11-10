import type { Vec2 } from '../core/GameContext';
import type { MonsterFactory } from '../entities/MonsterFactory';
import { FOREST_SPAWN_ACTIVE_RADIUS } from '../world/forestConstants';
import type { World } from './World';
import { isCampFieldUid } from '../world/bigWorld/campMonsterField';
import { peekBigWorldRuntime } from '../world/bigWorld/runtime';

/** Instansierar köade monster när hjälten är nära (Startskogen och lägerflocken). */
export function syncProximitySpawns(w: World, factory: MonsterFactory, hero: Vec2, cityState = 'besatt'): void {
  const streaming = w.zone.bigWorldStreaming;
  const insideLegacy = !streaming || peekBigWorldRuntime()?.heroInsideStartskogenRegion(hero) === true;
  if (streaming) {
    if (insideLegacy) factory.refillStartskogenQueue(w, cityState);
  } else if (w.zone.areaId !== 'startskogen') return;
  const r = FOREST_SPAWN_ACTIVE_RADIUS;
  for (const q of w.spawnQueue) {
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
  }
}
