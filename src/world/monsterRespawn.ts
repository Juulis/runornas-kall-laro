import type { World } from '../systems/World';
import { isBossMonsterId } from './bossIds';
import { releaseStartskogenQueueSlot } from './bigWorld/startskogenSpawn';

/** Vanliga monster kommer tillbaka så skogen inte töms efter några strider. Boss och quest stannar döda. */
export const MONSTER_RESPAWN_S = 20;

const pending = new Map<string, number>();

export function isRespawnableUid(uid: string): boolean {
  if (!uid || uid.startsWith('quest:') || uid.endsWith(':boss')) return false;
  if (isBossMonsterId(uid)) return false;
  const last = uid.slice(uid.lastIndexOf(':') + 1);
  if (last !== uid && isBossMonsterId(last)) return false;
  return true;
}

export function scheduleMonsterRespawn(uid: string, boss: boolean): void {
  if (boss || !isRespawnableUid(uid)) return;
  pending.set(uid, MONSTER_RESPAWN_S);
}

/** Sparade dödslistor ska inte lämna världen tom efter omladdning. */
export function armRespawnsForKilled(killed: ReadonlySet<string>): void {
  for (const uid of killed) {
    if (!isRespawnableUid(uid) || pending.has(uid)) continue;
    pending.set(uid, MONSTER_RESPAWN_S);
  }
}

export function tickMonsterRespawns(w: World, dt: number): void {
  if (pending.size === 0 || dt <= 0) return;
  for (const [uid, left] of pending) {
    const next = left - dt;
    if (next > 0) {
      pending.set(uid, next);
      continue;
    }
    pending.delete(uid);
    w.session.killed.delete(uid);
    releaseStartskogenQueueSlot(w, uid);
  }
}

export function resetMonsterRespawns(): void {
  pending.clear();
}

/** Syns i tester. */
export function pendingRespawnCount(): number {
  return pending.size;
}
