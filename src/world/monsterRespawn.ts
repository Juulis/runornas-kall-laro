import type { World } from '../systems/World';
import { Rng } from '../core/Rng';
import { isBossMonsterId } from './bossIds';
import { chunkSpawnToWorld, parseBigWorldSpawnUid } from './bigWorld/bigWorldCoords';
import { campMonsterSpecs, isCampFieldUid } from './bigWorld/campMonsterField';
import { generateChunkWorldData } from './bigWorld/worldGenerator';
import { releaseStartskogenQueueSlot } from './bigWorld/startskogenSpawn';

/** Vanliga monster kommer tillbaka så skogen inte töms efter några strider. Boss och quest stannar döda. */
export const MONSTER_RESPAWN_S = 75;
/** Slump kring bas-tiden, samma för läger och vanliga monster. Intervallet blir bas ± det här. */
export const MONSTER_RESPAWN_JITTER_S = 15;
/** Lägerflocken kommer tillbaka långsammare än de vanliga monstren. */
export const CAMP_MONSTER_RESPAWN_S = 120;
/** Återuppstå inte medan hjälten är närmare än så här (världsenheter) från död- eller spawnpositionen. */
export const MONSTER_RESPAWN_MIN_DIST = 40;

interface PendingRespawn {
  left: number;
  x: number | null;
  y: number | null;
}

const pending = new Map<string, PendingRespawn>();

export function isRespawnableUid(uid: string): boolean {
  if (!uid || uid.startsWith('quest:') || uid.endsWith(':boss')) return false;
  if (isBossMonsterId(uid)) return false;
  const last = uid.slice(uid.lastIndexOf(':') + 1);
  if (last !== uid && isBossMonsterId(last)) return false;
  return true;
}

/** Deterministisk tid per uid, så tester inte beror på Math.random. */
function respawnDelayS(uid: string): number {
  const base = isCampFieldUid(uid) ? CAMP_MONSTER_RESPAWN_S : MONSTER_RESPAWN_S;
  const rng = new Rng(Rng.hash(uid, 'respawn-jitter'));
  const jitter = (rng.next() * 2 - 1) * MONSTER_RESPAWN_JITTER_S;
  return base + jitter;
}

export function scheduleMonsterRespawn(uid: string, boss: boolean, pos?: { x: number; y: number } | null): void {
  if (boss || !isRespawnableUid(uid)) return;
  pending.set(uid, {
    left: respawnDelayS(uid),
    x: pos?.x ?? null,
    y: pos?.y ?? null,
  });
}

/**
 * Sparade dödslistor ska inte lämna världen tom efter omladdning.
 * Positionen saknas här. tickMonsterRespawns slår upp den senare: spawnkön,
 * campMonsterSpecs för lägerflocken, sedan chunkens spawnrulle för bw-uid.
 * Om positionen fortfarande saknas gäller bara tiden. Avståndet går inte att
 * mäta, och monstret ska inte fastna i pending för alltid.
 */
export function armRespawnsForKilled(killed: ReadonlySet<string>): void {
  for (const uid of killed) {
    if (!isRespawnableUid(uid) || pending.has(uid)) continue;
    pending.set(uid, { left: respawnDelayS(uid), x: null, y: null });
  }
}

function lookupRespawnPos(w: World, uid: string): { x: number; y: number } | null {
  for (const q of w.spawnQueue) {
    if (q.spec.uid === uid) return { x: q.pos.x, y: q.pos.y };
  }
  if (isCampFieldUid(uid)) {
    const spec = campMonsterSpecs(w.session.seed, w.session.worldSeed).find((s) => s.uid === uid);
    if (spec) return { x: spec.pos[0], y: spec.pos[1] };
  }
  const parsed = parseBigWorldSpawnUid(uid);
  if (parsed) {
    const data = generateChunkWorldData(w.session.worldSeed, w.session.seed, parsed.cx, parsed.cy);
    const sp = data.spawns.find((s) => s.uid === uid);
    if (sp) return chunkSpawnToWorld(parsed.cx, parsed.cy, sp.localX, sp.localY);
  }
  return null;
}

export function tickMonsterRespawns(w: World, dt: number): void {
  if (pending.size === 0 || dt <= 0) return;
  const hero = w.hero?.pos;
  for (const [uid, rec] of pending) {
    const next = rec.left - dt;
    if (next > 0) {
      rec.left = next;
      continue;
    }
    rec.left = 0;
    if (rec.x == null || rec.y == null) {
      const found = lookupRespawnPos(w, uid);
      if (found) {
        rec.x = found.x;
        rec.y = found.y;
      }
    }
    if (rec.x != null && rec.y != null && hero) {
      const dist = Math.hypot(rec.x - hero.x, rec.y - hero.y);
      if (dist < MONSTER_RESPAWN_MIN_DIST) continue;
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
