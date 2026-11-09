/**
 * Lärversionen: frågor, boss-seed, fel-svar-skada och auto-equip.
 * Kör: npx tsx tests/learn.test.mts
 */
import assert from 'node:assert/strict';
import { Rng } from '../src/core/Rng';
import type { HeroState } from '../src/core/GameContext';
import { HeroModel } from '../src/logic/HeroModel';
import { Loot } from '../src/logic/loot/Loot';
import type { Affix } from '../src/logic/loot/types';
import { Text } from '../src/text/Text';
import { applyWrongAnswer } from '../src/learn/damage';
import { autoEquipItem, chooseAutoEquipSlot, gearScore } from '../src/learn/gearScore';
import { MATH_RULES } from '../src/learn/mathQuestions';
import { bankCount } from '../src/learn/bank';
import { generateQuestions, questionsForEncounter } from '../src/learn/questions';
import { GRADES, SUBJECTS, encounterKindOf, isValidQuestion, questionCount, type GradeId, type LearnQuestion } from '../src/learn/types';

assert.equal(GRADES.length, 8);
assert.equal(SUBJECTS.length, 4);
assert.equal(questionCount('boss'), 5);
assert.equal(questionCount('champion'), 3);
assert.equal(questionCount('normal'), 1);
assert.equal(encounterKindOf({ boss: true, elite: 'champion' }), 'boss');
assert.equal(encounterKindOf({ boss: false, elite: 'champion' }), 'champion');
assert.equal(encounterKindOf({ boss: false, elite: 'minion' }), 'normal');
assert.equal(encounterKindOf({ boss: false, elite: null }), 'normal');

const indexes = new Set<number>();

function assertMath(q: LearnQuestion): void {
  assert.equal(isValidQuestion(q), true, q.id);
  assert.equal(q.subject, 'matte');
  assert.ok(MATH_RULES[q.grade].includes(q.rule), `${q.grade} ${q.rule}`);
  indexes.add(q.correctIndex);
  const m = q.meta ?? {};
  const a = m.a;
  const b = m.b;
  const res = m.result;
  switch (q.rule) {
    case 'forskola-rakna':
      assert.ok(m.n !== undefined && m.n >= 1 && m.n <= 5);
      assert.equal(res, m.n);
      break;
    case 'forskola-plus':
      assert.ok(a !== undefined && b !== undefined && a >= 0 && b >= 0 && a + b <= 5);
      assert.equal(res, a + b);
      break;
    case 'ak1-plus':
      assert.ok(a !== undefined && b !== undefined && a >= 0 && b >= 0 && a + b <= 20);
      assert.equal(res, a + b);
      break;
    case 'ak1-minus':
      assert.ok(a !== undefined && b !== undefined && a >= 0 && b >= 0 && b <= a && a <= 20);
      assert.equal(res, a - b);
      break;
    case 'ak2-plus':
      assert.ok(a !== undefined && b !== undefined && a >= 0 && b >= 0 && a + b <= 100);
      assert.equal(res, a + b);
      break;
    case 'ak2-minus':
      assert.ok(a !== undefined && b !== undefined && a >= 0 && b >= 0 && b <= a && a <= 100);
      assert.equal(res, a - b);
      break;
    case 'ak2-tiokamrat':
      assert.ok(m.n !== undefined && m.n >= 0 && m.n <= 10);
      assert.equal(res, 10 - m.n);
      break;
    case 'ak2-tabell':
      assert.ok(a === 2 || a === 5 || a === 10);
      assert.ok(b !== undefined && b >= 1 && b <= 10);
      assert.equal(res, (a ?? 0) * (b ?? 0));
      break;
    case 'ak3-tabell':
      assert.ok(a !== undefined && b !== undefined && a >= 1 && a <= 10 && b >= 1 && b <= 10);
      assert.equal(res, a * b);
      break;
    case 'ak3-division':
      assert.ok(a !== undefined && b !== undefined && b >= 1 && b <= 10 && a % b === 0);
      assert.equal(res, a / b);
      break;
    case 'ak3-plus':
      assert.ok(a !== undefined && b !== undefined && a >= 0 && b >= 0 && a + b <= 1000);
      assert.equal(res, a + b);
      break;
    case 'ak3-minus':
      assert.ok(a !== undefined && b !== undefined && a >= 0 && a <= 1000 && b >= 0 && b <= a);
      assert.equal(res, a - b);
      break;
    case 'ak46-brak':
      assert.equal(q.grade, 'ak4_6');
      break;
    case 'ak46-decimal':
      assert.ok(a !== undefined && b !== undefined && a >= 0 && a <= 9 && b >= 0 && b <= 9);
      break;
    case 'ak46-procent':
      assert.ok(res !== undefined && Number.isInteger(res) && res >= 0);
      break;
    case 'ak79-negativ':
      assert.ok(a !== undefined && b !== undefined && (a < 0 || b < 0));
      assert.equal(res, q.prompt.includes('−') ? a - b : a + b);
      break;
    case 'ak79-ekvation':
      assert.ok(a !== undefined && res !== undefined && b === res + a);
      break;
    case 'ak79-potens':
      assert.ok(a !== undefined && b !== undefined && res === a ** b);
      break;
    case 'gym-andragrads':
      assert.ok(m.r1 !== undefined && m.r2 !== undefined && m.r1 <= m.r2);
      assert.ok(q.answer.includes(`x = ${m.r1}`) && q.answer.includes(`x = ${m.r2}`));
      break;
    case 'gym-procent':
      assert.ok(res !== undefined && Number.isInteger(res));
      break;
    case 'gym-huvudrakning':
      assert.ok(a !== undefined && b !== undefined && res !== undefined && (res === a * b || res === a ** b));
      break;
    default:
      assert.fail(`okänd matte-regel ${q.rule}`);
  }
}

for (const grade of GRADES) {
  const qs = generateQuestions({ count: 24, grade: grade.id, subject: 'matte', seed: 20261109, idPrefix: 't' });
  assert.equal(qs.length, 24, grade.id);
  for (const q of qs) {
    assert.equal(q.grade, grade.id);
    assertMath(q);
  }
}
assert.ok(indexes.size > 1, 'rätt svar ska inte alltid ligga först');

const grades: GradeId[] = GRADES.map((g) => g.id);
for (const grade of grades) {
  const minSv = grade === 'ak1' || grade === 'ak2' || grade === 'ak3' ? 40 : 15;
  const minEn = minSv;
  assert.ok(bankCount('svenska', grade) >= minSv, `svenska ${grade} ${bankCount('svenska', grade)}`);
  assert.ok(bankCount('engelska', grade) >= minEn, `engelska ${grade} ${bankCount('engelska', grade)}`);
  for (const subject of ['svenska', 'engelska'] as const) {
    const qs = generateQuestions({ count: 4, grade, subject, seed: 7, idPrefix: subject });
    for (const q of qs) {
      assert.equal(isValidQuestion(q), true, q.id);
      assert.equal(q.grade, grade);
      assert.equal(q.subject, subject);
    }
  }
}

const bossA = questionsForEncounter({ kind: 'boss', monsterId: 'grabjornen_ulvhild', grade: 'ak2', subject: 'matte', seed: 1 });
const bossB = questionsForEncounter({ kind: 'boss', monsterId: 'grabjornen_ulvhild', grade: 'ak2', subject: 'matte', seed: 999 });
assert.equal(bossA.length, 5);
assert.deepEqual(bossA, bossB);
for (const q of bossA) {
  assert.equal(isValidQuestion(q), true);
  assert.equal(q.grade, 'ak2');
  assert.equal(q.subject, 'matte');
}
const otherBoss = questionsForEncounter({ kind: 'boss', monsterId: 'benkungen_valdemar', grade: 'ak2', subject: 'matte', seed: 1 });
const otherGrade = questionsForEncounter({ kind: 'boss', monsterId: 'grabjornen_ulvhild', grade: 'ak3', subject: 'matte', seed: 1 });
assert.notDeepEqual(bossA, otherBoss);
assert.notDeepEqual(bossA, otherGrade);
assert.equal(questionsForEncounter({ kind: 'champion', monsterId: 'varg', grade: 'ak1', subject: 'svenska', seed: 3 }).length, 3);
assert.equal(questionsForEncounter({ kind: 'normal', monsterId: 'varg', grade: 'ak1', subject: 'engelska', seed: 3 }).length, 1);

assert.deepEqual(applyWrongAnswer(100, 100), { damage: 25, hp: 75, died: false });
assert.deepEqual(applyWrongAnswer(20, 100), { damage: 25, hp: 0, died: true });
assert.deepEqual(applyWrongAnswer(11, 40), { damage: 10, hp: 1, died: false });

const L = new Loot(new Text(), new Rng(1));

function hero(level: number): HeroModel {
  const s: HeroState = {
    id: 't',
    name: 'T',
    cls: 'riddare',
    level,
    xp: 0,
    gold: 0,
    hp: 100,
    maxHp: 100,
    pos: { x: 0, y: 0 },
    facing: 0,
    zone: 'forest',
    stage: 1,
    runes: 0,
    city: 'besatt',
    playing: true,
    fresh: false,
    resumePos: null,
    inv: [],
    equip: {},
  };
  return new HeroModel(s, L);
}

const plain = L.makeItem('rostig_kortsvard');
const twin = L.makeItem('rostig_kortsvard');
const long = L.makeItem('langsvard');
const armor = L.makeItem('laderharnesk');
const food = L.makeItem('torkat_kott');
const magic = L.makeItem('rostig_kortsvard', { quality: 'magic' });
const affix: Affix = { id: 'vass', name: 'Vass', kind: 'prefix', stat: 'damage_flat', value: 4, tier: 1 };
magic.affixes = [affix];

assert.ok(gearScore(L.itemStats(long)) > gearScore(L.itemStats(plain)));
assert.ok(gearScore(L.itemStats(magic)) > gearScore(L.itemStats(plain)));

const low = hero(1);
assert.equal(chooseAutoEquipSlot(L, low.inv, food), null);
assert.equal(autoEquipItem(L, low, food), null);
assert.equal(chooseAutoEquipSlot(L, low.inv, long), null);
assert.equal(low.inv.equipTo(plain, 'vapen'), true);
assert.equal(chooseAutoEquipSlot(L, low.inv, twin), null);
assert.equal(autoEquipItem(L, low, twin), null);
assert.equal(low.inv.equip.vapen, plain);
assert.equal(autoEquipItem(L, low, armor), 'brost');
assert.equal(low.inv.equip.brost?.base, 'laderharnesk');
assert.equal(autoEquipItem(L, low, magic), 'vapen');
assert.equal(low.inv.equip.vapen, magic);
assert.ok(low.inv.bag.includes(plain));

const high = hero(6);
assert.equal(high.inv.equipTo(plain, 'vapen'), true);
assert.equal(autoEquipItem(L, high, long), 'vapen');
assert.equal(high.inv.equip.vapen?.base, 'langsvard');
assert.ok(high.inv.bag.some((it) => it.base === 'rostig_kortsvard'));
const weaker = L.makeItem('rostig_kortsvard');
assert.equal(autoEquipItem(L, high, weaker), null);
assert.equal(high.inv.equip.vapen?.base, 'langsvard');

console.log('learn ok', { matteIndex: [...indexes].sort(), sv: bankCount('svenska', 'ak1'), en: bankCount('engelska', 'ak1') });
