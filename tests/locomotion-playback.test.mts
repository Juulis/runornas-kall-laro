import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HERO_WORLD_SPEED_MULT } from '../src/logic/heroMovement';
import { locomotionPlaybackRate, WALK_CALIB_SPEED } from '../src/render/locomotionPlayback';
import type { Anim } from '../src/render/spriteAnim';

const HERO = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets/2d/sprites/hero');

function walkMeta(cls: string): { fps: number; frames: number } {
  const file = cls === 'riddare' ? path.join(HERO, 'riddare_walk_8dir.json') : path.join(HERO, cls, `${cls}_walk_8dir.json`);
  const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { fps: number; frames: number };
  return { fps: j.fps, frames: j.frames };
}

for (const cls of ['riddare', 'amazon', 'barbar'] as const) {
  const m = walkMeta(cls);
  assert.equal(m.frames, 12, `${cls} walk frames`);
  assert.equal(m.fps, 18, `${cls} walk fps`);
}

const walkAnim: Anim = {
  frames: [new Array(12).fill(null)],
  anchor: [0, 0],
  w: 1,
  h: 1,
  fps: 18,
  loop: true,
};
assert.equal(locomotionPlaybackRate(walkAnim, WALK_CALIB_SPEED), 1);
assert.ok(Math.abs(locomotionPlaybackRate(walkAnim, 6.2) - 6.2 / WALK_CALIB_SPEED) < 0.01);

const faster = WALK_CALIB_SPEED * HERO_WORLD_SPEED_MULT;
const fasterRate = locomotionPlaybackRate(walkAnim, faster);
assert.ok(Math.abs(fasterRate - HERO_WORLD_SPEED_MULT) < 0.01, `gång ${fasterRate} ska följa världsfarten`);
assert.ok(fasterRate > 1.65, 'taket 1.65 ska inte klippa den nya gångfarten');

const sprintSpeed = WALK_CALIB_SPEED * HERO_WORLD_SPEED_MULT * 1.55;
const sprintRate = locomotionPlaybackRate(walkAnim, sprintSpeed);
assert.ok(Math.abs(sprintRate - HERO_WORLD_SPEED_MULT * 1.55) < 0.01, `sprint ${sprintRate} ska följa farten`);

console.log('locomotion-playback.test.mts: ok');
