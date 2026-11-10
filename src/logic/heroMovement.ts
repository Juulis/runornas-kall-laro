import type { Vec2 } from '../core/GameContext';

/** Hjältens gång- och springhastighet i världen relativt klassens basfart. */
export const HERO_WORLD_SPEED_MULT = 1.8;

/** Största delsteg i världsenheter så hjälten inte hoppar genom kolliderare. */
export const HERO_MOVE_SUBSTEP = 0.25;

export interface HeroWorldSpeedInput {
  baseSpeed: number;
  moveSpeedMult: number;
  /** 1 vid gång, annars sprintens speed_mult. */
  runMult: number;
  blocking: boolean;
  /** Sant när hjälten är förbannad (curse > 0). */
  cursed: boolean;
}

/** Fart i världsenheter per sekund. Klassens basfart lämnas orörd. */
export function heroWorldSpeed(input: HeroWorldSpeedInput): number {
  const block = input.blocking ? 0.4 : 1;
  const curse = input.cursed ? 0.8 : 1;
  return input.baseSpeed * input.moveSpeedMult * input.runMult * HERO_WORLD_SPEED_MULT * block * curse;
}

export interface MoveWithCollisionResult {
  /** Faktisk förflyttning från startpositionen. */
  moved: number;
  /** Collide puttade ut mer än 90 % av ett delsteg. */
  pushedHard: boolean;
  /** Nästan ingen förflyttning (fast mot hinder eller redan framme). */
  stalled: boolean;
}

/**
 * Flyttar pos i riktningen (dirX, dirY) med längden step.
 * Delar upp steget och anropar collide efter varje del.
 */
export function moveWithCollision(
  pos: Vec2,
  dirX: number,
  dirY: number,
  step: number,
  radius: number,
  collide: (p: Vec2, radius: number) => void,
): MoveWithCollisionResult {
  const len = Math.hypot(dirX, dirY);
  const startX = pos.x;
  const startY = pos.y;
  if (!(len > 0) || !(step > 0) || !Number.isFinite(step)) {
    return { moved: 0, pushedHard: false, stalled: true };
  }
  const ux = dirX / len;
  const uy = dirY / len;
  const count = Math.ceil(step / HERO_MOVE_SUBSTEP);
  let pushedHard = false;
  let consumed = 0;
  for (let i = 0; i < count; i++) {
    const sub = Math.min(HERO_MOVE_SUBSTEP, step - consumed);
    pos.x += ux * sub;
    pos.y += uy * sub;
    const beforeX = pos.x;
    const beforeY = pos.y;
    collide(pos, radius);
    // Samma gräns som det gamla helsteget (push > step * 0.9), fast per delsteg.
    if (Math.hypot(pos.x - beforeX, pos.y - beforeY) > sub * 0.9) pushedHard = true;
    consumed += sub;
  }
  const moved = Math.hypot(pos.x - startX, pos.y - startY);
  return { moved, pushedHard, stalled: moved < Math.max(step * 0.25, 1e-4) };
}
