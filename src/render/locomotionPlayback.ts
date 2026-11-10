import type { Anim } from './spriteAnim';

/** Gångcykeln är kalibrerad vid riddarens basfart (12 bildrutor @ 18 fps). */
export const WALK_CALIB_SPEED = 5.2;

/** Undre gräns så långsam gång fortfarande syns. */
const PLAYBACK_RATE_MIN = 0.55;

/**
 * Övre gräns så stegen hinner med snabbare världsfart och sprint.
 * Räcker för ca 1.8 * 1.55 * (6.2 / 5.2).
 */
const PLAYBACK_RATE_MAX = 3.5;

/** Animationshastighet så stegen håller takten med faktisk förflyttning (minskar fotglidning). */
export function locomotionPlaybackRate(anim: Anim | undefined, speedWorldPerSec: number, refSpeed = WALK_CALIB_SPEED): number {
  if (!anim?.loop || anim.fps <= 0) return 1;
  const row = anim.frames[0];
  if (!row?.length) return 1;
  const rate = speedWorldPerSec / refSpeed;
  return Math.max(PLAYBACK_RATE_MIN, Math.min(PLAYBACK_RATE_MAX, rate));
}
