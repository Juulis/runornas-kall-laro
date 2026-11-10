/**
 * Hjältens världsfart och kollisionssubsteg (#33).
 * Kör: npx tsx tests/hero-move-speed.test.mts
 */
import assert from 'node:assert/strict';
import { HERO_WORLD_SPEED_MULT, heroWorldSpeed, moveWithCollision } from '../src/logic/heroMovement';
import { Zone } from '../src/world/Zone';

assert.ok(HERO_WORLD_SPEED_MULT >= 1.6 && HERO_WORLD_SPEED_MULT <= 2);

const base = 5.2;
function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ~= ${expected}`);
}

const walk = heroWorldSpeed({ baseSpeed: base, moveSpeedMult: 1, runMult: 1, blocking: false, cursed: false });
near(walk, base * HERO_WORLD_SPEED_MULT);

const sprint = heroWorldSpeed({ baseSpeed: base, moveSpeedMult: 1, runMult: 1.55, blocking: false, cursed: false });
near(sprint, base * HERO_WORLD_SPEED_MULT * 1.55);

const blocking = heroWorldSpeed({ baseSpeed: base, moveSpeedMult: 1, runMult: 1, blocking: true, cursed: false });
near(blocking, base * HERO_WORLD_SPEED_MULT * 0.4);

const cursed = heroWorldSpeed({ baseSpeed: base, moveSpeedMult: 1, runMult: 1, blocking: false, cursed: true });
near(cursed, base * HERO_WORLD_SPEED_MULT * 0.8);

const both = heroWorldSpeed({ baseSpeed: base, moveSpeedMult: 1, runMult: 1.55, blocking: true, cursed: true });
near(both, base * HERO_WORLD_SPEED_MULT * 1.55 * 0.4 * 0.8);

const open = new Zone('forest', 'open', 80, 80);
const free = { x: 0, y: 0 };
const freeStep = 0.2;
const freeMove = moveWithCollision(free, 1, 0, freeStep, 0.5, (p, r) => open.collide(p, r));
assert.equal(free.x, freeStep);
assert.equal(free.y, 0);
assert.equal(freeMove.moved, freeStep);
assert.equal(freeMove.pushedHard, false);
assert.equal(freeMove.stalled, false);

const along = { x: 0, y: 0 };
const alongStep = 0.5;
const alongMove = moveWithCollision(along, 0, 1, alongStep, 0.5, (p, r) => open.collide(p, r));
assert.equal(along.x, 0);
assert.equal(along.y, alongStep);
assert.equal(alongMove.moved, alongStep);

const blocked = new Zone('forest', 'blocked', 80, 80);
blocked.colliders.push({ x: 2, y: 0, r: 0.4 });
const hero = { x: 0, y: 0 };
const distance = 4;
const hit = moveWithCollision(hero, 10, 0, distance, 0.5, (p, r) => blocked.collide(p, r));
assert.ok(hero.x <= 2, `hjälten tunnlar, x=${hero.x}`);
assert.ok(hero.x <= 1.15, `hjälten ska stanna mot hindret, x=${hero.x}`);
assert.ok(hero.x > 1, `hjälten ska nå fram till hindret, x=${hero.x}`);
assert.ok(Math.abs(hero.y) < 1e-6);
assert.equal(hit.pushedHard, true);

console.log('hero-move-speed.test.mts: ok');
