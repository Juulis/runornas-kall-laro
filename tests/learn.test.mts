/**
 * Lärversionen: frågor, boss-seed, fel-svar-skada och auto-equip.
 * Kör: npx tsx tests/learn.test.mts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Rng } from '../src/core/Rng';
import type { HeroState } from '../src/core/GameContext';
import { Hero } from '../src/entities/Hero';
import { HeroModel } from '../src/logic/HeroModel';
import type { Monster } from '../src/entities/Monster';
import type { DirSprite } from '../src/render/DirSprite';
import { Loot } from '../src/logic/loot/Loot';
import type { Affix } from '../src/logic/loot/types';
import { Text } from '../src/text/Text';
import { burstConfetti } from '../src/ui/Confetti';
import {
  CELEBRATE_PHRASES,
  celebrateCorrect,
  HERO_BOUNCE_S,
  heroBounceFrame,
  playHappyChime,
  setStarFlyHandler,
  type StarFlyInfo,
} from '../src/learn/celebrate';
import { applyWrongAnswer } from '../src/learn/damage';
import { autoEquipItem, chooseAutoEquipSlot, gearScore } from '../src/learn/gearScore';
import { MATH_RULES } from '../src/learn/mathQuestions';
import { bankCount, clearBankCache, ensureBank, preloadLearnBanks, setBankImporterForTests } from '../src/learn/bank';
import {
  ENEMY_SWING_S,
  FIGHT_S,
  HERO_HURT_FLASH_S,
  HERO_HURT_SHAKE_S,
  HURT_LAND_AT,
  LEARN_PACK_PAUSE_S,
  LEARN_WRONG_PAUSE_S,
  LearnEncounter,
  WRONG_S,
} from '../src/learn/LearnEncounter';
import { generateQuestions, questionsForEncounter } from '../src/learn/questions';
import {
  GRADES,
  SUBJECTS,
  encounterKindOf,
  isValidQuestion,
  questionCount,
  type EncounterKind,
  type GradeId,
  type LearnQuestion,
} from '../src/learn/types';
import { CombatSystem } from '../src/systems/CombatSystem';
import type { LootSystem } from '../src/systems/LootSystem';
import type { MonsterAI } from '../src/systems/MonsterAI';
import type { Projectile, World } from '../src/systems/World';

const svenskaBank = await ensureBank('svenska');
const svenskaAgain = await ensureBank('svenska');
assert.equal(svenskaAgain, svenskaBank, 'ensureBank ska cacha samma rader');
assert.ok(svenskaBank.length >= 40);
await ensureBank('engelska');
await preloadLearnBanks({ subject: 'matte' });
await preloadLearnBanks({ subject: 'blandat' });
assert.equal(await ensureBank('svenska'), svenskaBank, 'preload ska återanvända cache');

assert.equal(GRADES.length, 8);
assert.equal(SUBJECTS.length, 6);
assert.equal(SUBJECTS[4]?.id, 'lasforstaelse');
assert.equal(SUBJECTS[4]?.label, 'Läsförståelse');
assert.equal(SUBJECTS[5]?.id, 'horforstaelse');
assert.equal(SUBJECTS[5]?.label, 'Hörförståelse');
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
    case 'forskola-plus':
      assert.ok(a !== undefined && b !== undefined && a >= 0 && a <= 9 && b >= 0 && b <= 9 && a + b <= 10);
      assert.equal(res, a + b);
      assert.ok(res !== undefined && res >= 0);
      for (const c of q.choices) {
        const n = Number(c);
        assert.equal(Number.isInteger(n), true, c);
        assert.ok(n >= 0 && n <= 10, c);
      }
      break;
    case 'forskola-minus':
      assert.ok(a !== undefined && b !== undefined && a >= 0 && a <= 9 && b >= 0 && b <= a);
      assert.equal(res, a - b);
      assert.ok(res !== undefined && res >= 0);
      for (const c of q.choices) {
        const n = Number(c);
        assert.equal(Number.isInteger(n), true, c);
        assert.ok(n >= 0 && n <= 10, c);
      }
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
    case 'forskola-rakna':
      assert.ok(res !== undefined && res >= 1 && res <= 10);
      assert.equal(q.answer, String(res));
      assert.match(q.prompt, /^Hur många /u);
      assert.equal(q.speakLang, 'sv-SE');
      break;
    case 'forskola-efter':
      assert.match(q.prompt, /^Vilket tal kommer efter (\d+)\?$/);
      assert.equal(q.answer, String(res));
      assert.equal(res, (a ?? -1) + 1);
      break;
    case 'ak1-talfoljd':
      assert.ok(res !== undefined && res >= 0);
      assert.equal(q.answer, String(res));
      break;
    case 'ak1-jamforelse':
      assert.match(q.prompt, /^Vilket tal är (?:störst|minst): \d+ eller \d+\?$/);
      assert.equal(q.answer, String(res));
      break;
    case 'ak2-dubbelt':
      assert.equal(res, (a ?? 0) * 2);
      break;
    case 'ak2-halften':
      assert.ok(a !== undefined && a % 2 === 0);
      assert.equal(res, (a ?? 0) / 2);
      break;
    case 'ak2-klocka':
      assert.match(q.answer, /^\d{1,2}:(?:00|30)$/);
      break;
    case 'ak3-tabell34':
      assert.ok(a === 3 || a === 4);
      assert.ok(b !== undefined && b >= 1 && b <= 10);
      assert.equal(res, (a ?? 0) * (b ?? 0));
      break;
    case 'ak3-kronor':
      assert.ok(res !== undefined && res >= 0);
      assert.equal(q.answer, String(res));
      break;
    case 'ak46-avrundning':
    case 'ak46-rektangel':
      assert.equal(q.answer, String(res));
      break;
    case 'ak79-prioritet':
      assert.equal(q.answer, String(res));
      assert.equal(q.needsScratchpad, undefined);
      break;
    case 'ak79-procent':
      assert.ok(res !== undefined && Number.isInteger(res) && res >= 0);
      break;
    case 'ak79-rot':
      assert.equal(res, a);
      assert.equal(b, (a ?? 0) ** 2);
      break;
    case 'gym-ekvation':
      assert.equal(q.answer, String(res));
      assert.equal(q.needsScratchpad, true);
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
  const minSv = grade === 'forskola' || grade === 'ak1' || grade === 'ak2' || grade === 'ak3' ? 40 : 15;
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
assert.equal(low.inv.bag.includes(plain), false, 'vanligt svärd som byts ut ska inte ligga kvar i väskan');

const high = hero(6);
assert.equal(high.inv.equipTo(plain, 'vapen'), true);
assert.equal(autoEquipItem(L, high, long), 'vapen');
assert.equal(high.inv.equip.vapen?.base, 'langsvard');
assert.equal(
  high.inv.bag.some((it) => it.base === 'rostig_kortsvard'),
  false,
);

const keeper = hero(8);
const legGloves = L.makeItem('tyghandskar', { quality: 'legendary', leg: 'okand_leg' });
assert.equal(keeper.inv.equipTo(legGloves, 'handskar'), true);
const betterGloves = L.makeItem('laderhandskar', { quality: 'magic' });
assert.equal(autoEquipItem(L, keeper, betterGloves), 'handskar');
assert.equal(keeper.inv.equip.handskar, betterGloves);
assert.ok(keeper.inv.bag.includes(legGloves), 'undanträngt unikt ska till väskan');
const junkHero = hero(8);
const normalGloves = L.makeItem('tyghandskar');
assert.equal(junkHero.inv.equipTo(normalGloves, 'handskar'), true);
assert.equal(autoEquipItem(L, junkHero, L.makeItem('laderhandskar')), 'handskar');
assert.equal(junkHero.inv.bag.includes(normalGloves), false);
const weaker = L.makeItem('rostig_kortsvard');
assert.equal(autoEquipItem(L, high, weaker), null);
assert.equal(high.inv.equip.vapen?.base, 'langsvard');

console.log('learn ok', { matteIndex: [...indexes].sort(), sv: bankCount('svenska', 'ak1'), en: bankCount('engelska', 'ak1') });

const RNG_NEXT = 0.25;
const LEARN_SEED = (RNG_NEXT * 0x100000000) >>> 0;

function installDom(): void {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  const g = globalThis as unknown as Record<string, unknown>;
  const win = dom.window as unknown as Record<string, unknown>;
  for (const k of ['window', 'document', 'HTMLElement', 'Node', 'Event']) g[k] = win[k];
}

function combatFixture(): { combat: CombatSystem; hero: Hero; monster: Monster; anims: string[]; box: { projectiles: Projectile[] } } {
  const s: HeroState = {
    id: 't',
    name: 'T',
    cls: 'amazonkrigare',
    level: 1,
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
  const view = { play() {}, playbackRate: 1, sprite: { tint: 0xffffff, alpha: 1 } } as unknown as DirSprite;
  const hero = new Hero(s, L, view);
  const anims: string[] = [];
  const monster = {
    id: 'varg',
    lvl: 1,
    hp: 8,
    max: 8,
    defense: 0,
    boss: false,
    elite: null,
    dead: 0,
    facing: 0,
    immune: 0,
    vuln: 0,
    uid: null,
    es: null,
    pos: { x: 0, y: 3.2 },
    dmgMult: 1,
    heroAidedPatrol: false,
    def: { family: 'beast', weak: [], resist: [], xp: 10, underboss: false, attack_range: 1.6 },
    view: { play: (name: string) => anims.push(name), position: { x: 0 }, height2: 40, sprite: { alpha: 1 } },
  } as unknown as Monster;
  const box = {
    hero,
    monsters: [monster],
    projectiles: [] as Projectile[],
    worldFighters: [],
    time: 0,
    zone: { areaId: 'startskogen', contains: () => true },
    session: { killed: new Set<string>() },
    fb: { flash() {}, float() {} },
    text: { t: () => 'x', data: (_file: string, _id: string, _field: string, sv: string) => sv },
    authority: {
      killReward: () => ({ xp: 0, drops: [] }),
      monsterHit: () => ({ kind: 'hit' as const, dmg: 1, reduced: false }),
      heroHit: () => ({ hit: true, dmg: 999, crit: false, strong: 0, fm: 1 }),
    },
    bus: { emit() {} },
  };
  const loot = { grantAuto: () => [] } as unknown as LootSystem;
  const combat = new CombatSystem(() => box as unknown as World, loot);
  return { combat, hero, monster, anims, box };
}

playHappyChime();
burstConfetti(null, 4, 5);
const earlyPhrases = [
  celebrateCorrect({ x: 1, y: 2, starsHint: 3, parent: null }),
  celebrateCorrect({ x: 1, y: 2, parent: null }),
  celebrateCorrect({ x: 1, y: 2, parent: null }),
];
assert.deepEqual(earlyPhrases, [...CELEBRATE_PHRASES]);
const hop = heroBounceFrame(0.25);
assert.ok(hop.scale > 1 && hop.lift > 0);
assert.equal(heroBounceFrame(0).scale, 1);
assert.equal(heroBounceFrame(0).lift, 0);
assert.equal(heroBounceFrame(1).lift, 0);
const directStars: StarFlyInfo[] = [];
setStarFlyHandler((info) => directStars.push(info));
celebrateCorrect({ x: 8, y: 9, starsHint: 2, parent: null });
assert.deepEqual(directStars, [{ x: 8, y: 9, starsHint: 2 }]);
setStarFlyHandler(null);
celebrateCorrect({ x: 0, y: 0, parent: null });
assert.equal(directStars.length, 1);

installDom();

playHappyChime();
burstConfetti(null, 0, 0);

const fight = combatFixture();
assert.equal(fight.combat.suppressHeroMonsterDamage, true);
const snipeD = 3.2;
const learnR = Math.max(fight.hero.stats.reach + 0.25, 1.6 + 0.35);
assert.ok(snipeD > learnR, `färdigheten ska nå förbi frågan (${learnR})`);
assert.ok(snipeD < 3.5 + 0.4);
assert.equal(fight.combat.arcHit(3.5, 0.85, 5, { kb: 5 }, 2), 1);
assert.equal(fight.monster.hp, 8);
assert.equal(fight.monster.dead, 0);
fight.combat.damageMonster(fight.monster, 99);
assert.equal(fight.monster.hp, 8, 'damageMonster ska no-opas');
assert.equal(fight.monster.dead, 0);
const staminaBefore = fight.hero.stamina;
fight.combat.useSkill('spjutstot', true);
assert.ok(fight.hero.stamina < staminaBefore, 'spjutstöten ska ha använts');
assert.ok(fight.hero.skillCdLeft('spjutstot') > 0);
assert.equal(fight.monster.hp, 8, 'färdighet får inte sänka liv');
assert.equal(fight.monster.dead, 0);
fight.box.projectiles.push({
  pos: { x: fight.monster.pos.x, y: fight.monster.pos.y },
  v: { x: 0, y: 0 },
  dmg: 40,
  life: 2,
  from: null,
  view: { position: { set() {} }, destroy() {}, zIndex: 0 } as unknown as Projectile['view'],
  heroShot: true,
  mult: 9,
});
fight.combat.update(0.016);
assert.equal(fight.box.projectiles.length, 0, 'projektilen träffade');
assert.equal(fight.monster.hp, 8, 'projektil får inte skada');
assert.equal(fight.monster.dead, 0);
fight.combat.damageMonsterFromFighter(fight.monster, 100);
assert.equal(fight.monster.hp, 1, 'patrull lämnar minst 1 hp');
assert.equal(fight.monster.dead, 0);
fight.monster.hp = 4;
fight.combat.suppressHeroHurt = false;
fight.hero.stats.thorns = 80;
fight.combat.hurt(12, { x: 1, y: 0 }, fight.monster);
assert.equal(fight.monster.hp, 1, 'taggar i hurt lämnar minst 1 hp');
assert.equal(fight.monster.dead, 0);
fight.combat.kill(fight.monster);
assert.equal(fight.monster.dead, 0, 'kill utan fråga ska ignoreras');
assert.deepEqual(fight.anims, []);
fight.combat.kill(fight.monster, true);
assert.ok(fight.monster.dead > 0, 'kill från frågan fäller');
assert.deepEqual(fight.anims, ['dod']);

interface LearnPack {
  enc: LearnEncounter;
  monster: Monster;
  monsters: Monster[];
  hero: { s: { hp: number; playing: boolean }; stats: { maxHp: number } };
  kills: Monster[];
  questions: LearnQuestion[];
  position: { x: number };
  swings: string[];
  floats: { text: string; kind: string }[];
  heroTint: { tint: number };
  heroView: { position: { x: number; y: number }; scale: { x: number; y: number } };
}

function makeLearn(kind: EncounterKind): LearnPack {
  const position = { x: 0 };
  const swings: string[] = [];
  const monster = {
    id: 'varg',
    boss: kind === 'boss',
    elite: kind === 'champion' ? 'champion' : null,
    dead: 0,
    hp: 30,
    max: 30,
    active: true,
    atk: 0,
    pos: { x: 0, y: 1 },
    flash: 0,
    def: { attack_range: 1.6, name: 'Varg' },
    view: {
      position,
      height2: 40,
      sprite: { alpha: 1 },
      play(name: string) {
        swings.push(name);
      },
    },
  } as unknown as Monster;
  const heroTint = { tint: 0xffffff };
  const heroView = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 } };
  const hero = {
    pos: { x: 0, y: 0 },
    moveTarget: null as { x: number; y: number } | null,
    atkPendingHit: false,
    atkT: 0,
    stats: { reach: 2.2, maxHp: 100, dmgMin: 4, dmgMax: 8 },
    s: { playing: true, hp: 100, facing: 0, maxHp: 100 },
    view: {
      playbackRate: 1,
      sprite: heroTint,
      position: heroView.position,
      scale: heroView.scale,
      play() {},
      applyTint(color: number) {
        heroTint.tint = color;
      },
    },
    clearAttack() {
      this.atkPendingHit = false;
      this.atkT = 0;
    },
  };
  const monsters = [monster];
  const floats: { text: string; kind: string }[] = [];
  const world = {
    hero,
    monsters,
    rng: { next: () => RNG_NEXT },
    fb: {
      flash() {},
      float(_p: unknown, text: string, kind: string) {
        floats.push({ text, kind });
      },
    },
  };
  const kills: Monster[] = [];
  const combat = {
    kill(m: Monster, fromLearn?: boolean) {
      assert.equal(fromLearn, true);
      m.dead = 0.001;
      kills.push(m);
    },
    ring() {
      return {};
    },
  } as unknown as CombatSystem;
  const enc = new LearnEncounter(
    () => world as unknown as World,
    combat,
    { paused: false } as MonsterAI,
    { grade: 'ak1', subject: 'matte' },
    () => false,
    () => undefined,
  );
  const questions = questionsForEncounter({ kind, monsterId: 'varg', grade: 'ak1', subject: 'matte', seed: LEARN_SEED });
  return { enc, monster, monsters, hero, kills, questions, position, swings, floats, heroTint, heroView };
}

function quiz(enc: LearnEncounter): { hidden: boolean; progress: string } {
  const root = enc.overlaySettings.root;
  const node = root.querySelector('#rk-learn-quiz');
  return { hidden: node?.classList.contains('hidden') ?? true, progress: root.querySelector('.rk-q-progress')?.textContent ?? '' };
}

function startQuestion(pack: LearnPack, n: number, total: number): void {
  pack.enc.tick(0);
  const q = quiz(pack.enc);
  assert.equal(q.hidden, false);
  assert.equal(q.progress, `Fråga ${n} av ${total}`);
  assert.equal(pack.enc.isQuestion(), true);
}

assert.equal(LEARN_PACK_PAUSE_S, 0.5);
assert.ok(LEARN_WRONG_PAUSE_S > LEARN_PACK_PAUSE_S);
assert.ok(LEARN_WRONG_PAUSE_S >= 0.85 && LEARN_WRONG_PAUSE_S <= 1);
assert.ok(FIGHT_S >= 1.1 && FIGHT_S <= 1.3);
assert.ok(WRONG_S >= 2.6 && WRONG_S <= 2.9);
assert.ok(WRONG_S > FIGHT_S * 1.8);
assert.ok(WRONG_S > FIGHT_S + HERO_BOUNCE_S);
assert.ok(HURT_LAND_AT >= 0.55 && HURT_LAND_AT <= 0.7);
assert.ok(ENEMY_SWING_S >= 1.15 && ENEMY_SWING_S <= 1.35);
assert.ok(ENEMY_SWING_S > HURT_LAND_AT, 'svingen pågår när träffen landar');
assert.ok(HERO_HURT_SHAKE_S >= 0.55 && HERO_HURT_SHAKE_S <= 0.7);
assert.ok(HERO_HURT_FLASH_S >= 1 && HERO_HURT_FLASH_S <= 1.2);

const champ = makeLearn('champion');
try {
  const total = champ.questions.length;
  assert.equal(total, 3);
  startQuestion(champ, 1, total);
  champ.enc.answer(champ.questions[0]?.correctIndex ?? -1);
  assert.equal(quiz(champ.enc).hidden, true, 'rätt svar går till strid');
  champ.enc.tick(FIGHT_S + 0.05);
  assert.equal(champ.enc.isQuestion(), false);
  assert.equal(champ.enc.busy(), true);
  assert.equal(champ.enc.blocksInput(), true, 'färdigheter är blockerade i pausen');
  assert.equal(champ.kills.length, 0);
  assert.equal(champ.monster.hp, 30);
  assert.equal(champ.monster.dead, 0);
  champ.enc.tick(LEARN_PACK_PAUSE_S - 0.01);
  assert.equal(champ.enc.isQuestion(), false, 'paus efter rätt är inte klar');
  champ.enc.tick(0.02);
  assert.equal(champ.enc.isQuestion(), true);
  assert.equal(quiz(champ.enc).progress, `Fråga 2 av ${total}`);
  for (let i = 1; i < total; i++) {
    champ.enc.answer(champ.questions[i]?.correctIndex ?? -1);
    champ.enc.tick(FIGHT_S + 0.05);
    if (i < total - 1) {
      assert.equal(champ.kills.length, 0);
      champ.enc.tick(LEARN_PACK_PAUSE_S - 0.01);
      assert.equal(quiz(champ.enc).hidden, true);
      champ.enc.tick(0.02);
      assert.equal(quiz(champ.enc).progress, `Fråga ${i + 2} av ${total}`);
    }
  }
  assert.equal(champ.kills.length, 1);
  assert.ok(champ.monster.dead > 0);
  assert.equal(champ.enc.busy(), false);
  assert.equal(champ.position.x, 0);
} finally {
  champ.enc.dispose();
}

const wrong = makeLearn('champion');
try {
  const total = wrong.questions.length;
  assert.equal(total, 3);
  startQuestion(wrong, 1, total);
  const bad = ((wrong.questions[0]?.correctIndex ?? 0) + 1) % 4;
  wrong.enc.answer(bad);
  assert.equal(quiz(wrong.enc).hidden, false);
  assert.match(wrong.enc.overlaySettings.root.textContent ?? '', /Rätt svar var:/);
  assert.equal(wrong.enc.overlaySettings.root.querySelector('.rk-q-choices')?.classList.contains('hidden'), false);
  const wrongButtons = wrong.enc.overlaySettings.root.querySelectorAll('.rk-q-choices button');
  assert.equal(wrongButtons[wrong.questions[0]?.correctIndex ?? -1]?.classList.contains('correct'), true);
  assert.equal(wrongButtons[bad]?.classList.contains('wrong'), true);
  assert.equal(wrong.hero.s.hp, 100, 'livet sjunker inte förrän slaget träffar');
  assert.equal(wrong.monster.atk, ENEMY_SWING_S);
  assert.ok(wrong.swings.includes('attack'), 'monstret ska svinga');
  assert.equal(wrong.heroTint.tint, 0xffffff, 'blinken börjar när träffen landar');
  assert.equal(wrong.floats.length, 0);
  const beforeLand = HURT_LAND_AT - 0.05;
  wrong.enc.tick(beforeLand);
  assert.equal(wrong.hero.s.hp, 100);
  assert.ok(wrong.monster.atk > 0, 'svingen syns innan träffen');
  assert.equal(quiz(wrong.enc).hidden, false, 'quiz synlig medan monstret svingar');
  wrong.enc.tick(0.06);
  assert.equal(wrong.hero.s.hp, 75, 'skadan landar med träffen');
  assert.equal(
    wrong.floats.some((f) => f.kind === 'hurt' && f.text.startsWith('-')),
    true,
  );
  assert.ok(wrong.heroTint.tint === 0xff2020 || wrong.heroTint.tint === 0xff7070, 'hjälten ska blinka rött');
  assert.equal(quiz(wrong.enc).hidden, false, 'feltexten ska synas medan slaget spelas');
  assert.match(wrong.enc.overlaySettings.root.textContent ?? '', /Rätt svar var:/);
  assert.equal(wrong.enc.isQuestion(), false);
  const elapsed = beforeLand + 0.06;
  const remain = WRONG_S - elapsed;
  wrong.enc.tick(remain - 0.05);
  assert.equal(quiz(wrong.enc).hidden, false, 'quiz synlig under hela fel-sekvensen');
  assert.match(wrong.enc.overlaySettings.root.textContent ?? '', /Rätt svar var:/);
  assert.equal(wrong.hero.s.hp, 75);
  assert.equal(wrong.enc.isQuestion(), false);
  wrong.enc.tick(0.06);
  assert.equal(wrong.hero.s.hp, 75);
  assert.equal(wrong.enc.isQuestion(), false);
  assert.equal(quiz(wrong.enc).hidden, true);
  assert.equal(wrong.kills.length, 0);
  wrong.enc.tick(LEARN_WRONG_PAUSE_S - 0.05);
  assert.equal(wrong.enc.isQuestion(), false, 'fel-pausen är längre än rätt-pausen');
  wrong.enc.tick(0.06);
  assert.equal(wrong.enc.isQuestion(), true);
  assert.equal(quiz(wrong.enc).progress, `Fråga 2 av ${total}`);
  assert.equal(wrong.hero.s.hp, 75);
  assert.equal(wrong.position.x, 0);
} finally {
  wrong.enc.dispose();
}

const one = makeLearn('normal');
try {
  const total = one.questions.length;
  assert.equal(total, 1);
  startQuestion(one, 1, total);
  one.enc.answer(one.questions[0]?.correctIndex ?? -1);
  assert.equal(quiz(one.enc).hidden, true, 'rätt svar går till strid');
  let t = 0;
  while (one.kills.length === 0 && t < 3) {
    one.enc.tick(0.05);
    t += 0.05;
    assert.ok(Math.abs(one.position.x) < 5, `skak driver ${one.position.x}`);
    assert.equal(one.enc.isQuestion(), false, 'ingen andra fråga under striden');
  }
  assert.ok(t > 1.1 && t < 1.45, `sista frågan dödar efter striden (${t}s), utan extra paus`);
  assert.equal(one.kills.length, 1);
  assert.equal(one.enc.busy(), false);
  assert.equal(one.position.x, 0, 'sprite-x återställs när striden tar slut');
  one.enc.tick(LEARN_PACK_PAUSE_S);
  assert.equal(one.enc.isQuestion(), false, 'ingen extra fråga efter sista');
  assert.equal(one.kills.length, 1);
  assert.equal(quiz(one.enc).hidden, true);
} finally {
  one.enc.dispose();
}

const normalWrong = makeLearn('normal');
try {
  assert.equal(normalWrong.questions.length, 1);
  startQuestion(normalWrong, 1, 1);
  const bad = ((normalWrong.questions[0]?.correctIndex ?? 0) + 1) % 4;
  normalWrong.enc.answer(bad);
  assert.equal(quiz(normalWrong.enc).hidden, false);
  assert.match(normalWrong.enc.overlaySettings.root.textContent ?? '', /Rätt svar var:/);
  assert.equal(normalWrong.kills.length, 0);
  normalWrong.enc.tick(WRONG_S - 0.05);
  assert.equal(normalWrong.enc.isQuestion(), false, 'fel-sekvensen är inte en ny fråga');
  assert.equal(quiz(normalWrong.enc).hidden, false, 'quiz synlig under hela fel-sekvensen');
  assert.match(normalWrong.enc.overlaySettings.root.textContent ?? '', /Rätt svar var:/);
  assert.equal(normalWrong.kills.length, 0, 'monstret lever tills fel-sekvensen är slut');
  assert.equal(normalWrong.hero.s.hp, 75, 'hjälten lever efter ett fel');
  normalWrong.enc.tick(0.06);
  assert.equal(normalWrong.kills.length, 1, 'sista fel-frågan fäller monstret');
  assert.ok(normalWrong.monster.dead > 0);
  assert.equal(normalWrong.hero.s.hp, 75);
  assert.equal(normalWrong.enc.busy(), false);
  assert.equal(normalWrong.enc.isQuestion(), false);
  assert.equal(quiz(normalWrong.enc).hidden, true);
  normalWrong.enc.tick(LEARN_WRONG_PAUSE_S);
  assert.equal(normalWrong.enc.isQuestion(), false, 'ingen andra fråga efter fel');
  assert.equal(normalWrong.kills.length, 1);
  assert.equal(quiz(normalWrong.enc).hidden, true);
} finally {
  normalWrong.enc.dispose();
}

const shake = makeLearn('champion');
try {
  startQuestion(shake, 1, shake.questions.length);
  shake.enc.answer(shake.questions[0]?.correctIndex ?? -1);
  let left = false;
  let back = false;
  for (let i = 0; i < 80 && !back; i++) {
    shake.enc.tick(0.02);
    const dx = Math.abs(shake.position.x);
    assert.ok(dx < 5, `skak driver ${shake.position.x}`);
    if (dx > 0.2) left = true;
    else if (left) back = true;
  }
  assert.equal(left, true, 'träffen ska skaka');
  assert.equal(back, true, 'skaket ska tillbaka till bas-x');
  assert.equal(shake.position.x, 0);
  let leftAgain = false;
  for (let i = 0; i < 40 && !leftAgain; i++) {
    shake.enc.tick(0.02);
    if (Math.abs(shake.position.x) > 0.2) leftAgain = true;
  }
  assert.equal(leftAgain, true);
  shake.enc.cancel();
  assert.equal(shake.position.x, 0, 'avbruten strid återställer sprite-x');
  assert.equal(shake.enc.busy(), false);
} finally {
  shake.enc.dispose();
}

const gone = makeLearn('champion');
try {
  startQuestion(gone, 1, gone.questions.length);
  gone.enc.answer(gone.questions[0]?.correctIndex ?? -1);
  let moved = false;
  for (let i = 0; i < 40 && !moved; i++) {
    gone.enc.tick(0.02);
    moved = Math.abs(gone.position.x) > 0.2;
  }
  assert.equal(moved, true);
  gone.monster.dead = 0.2;
  gone.enc.tick(0.02);
  assert.equal(gone.position.x, 0, 'död återställer sprite-x');
  assert.equal(gone.enc.busy(), false);
} finally {
  gone.enc.dispose();
}

const despawn = makeLearn('champion');
try {
  startQuestion(despawn, 1, despawn.questions.length);
  despawn.enc.answer(despawn.questions[0]?.correctIndex ?? -1);
  let moved = false;
  for (let i = 0; i < 40 && !moved; i++) {
    despawn.enc.tick(0.02);
    moved = Math.abs(despawn.position.x) > 0.2;
  }
  assert.equal(moved, true);
  despawn.monsters.splice(0, despawn.monsters.length);
  despawn.enc.tick(0.02);
  assert.equal(despawn.position.x, 0, 'despawn återställer sprite-x');
  assert.equal(despawn.enc.busy(), false);
} finally {
  despawn.enc.dispose();
}

const between = makeLearn('champion');
try {
  startQuestion(between, 1, between.questions.length);
  between.enc.answer(between.questions[0]?.correctIndex ?? -1);
  let sawNext = false;
  for (let i = 0; i < 250 && !sawNext; i++) {
    between.enc.tick(0.02);
    assert.ok(Math.abs(between.position.x) < 5, `skak driver ${between.position.x}`);
    if (between.enc.isQuestion() && quiz(between.enc).progress === `Fråga 2 av ${between.questions.length}`) {
      assert.equal(between.position.x, 0, 'ingen offset kvar mellan frågor');
      sawNext = true;
    }
  }
  assert.equal(sawNext, true);
  assert.equal(between.kills.length, 0);
} finally {
  between.enc.dispose();
}

const missed = makeLearn('normal');
const starHits: StarFlyInfo[] = [];
setStarFlyHandler((info) => starHits.push(info));
try {
  assert.equal(missed.questions.length, 1);
  startQuestion(missed, 1, 1);
  const q = missed.questions[0];
  assert.ok(q);
  missed.enc.answer((q.correctIndex + 1) % 4);
  assert.equal(starHits.length, 0, 'fel svar ska inte skicka stjärnor');
} finally {
  missed.enc.dispose();
}

const cheered = makeLearn('normal');
const viaEncounter: StarFlyInfo[] = [];
cheered.enc.onCorrectCelebrate = (info) => viaEncounter.push(info);
try {
  assert.equal(cheered.questions.length, 1);
  startQuestion(cheered, 1, 1);
  const q = cheered.questions[0];
  assert.ok(q);
  const bannersBefore = document.querySelectorAll('.rk-celebrate').length;
  const confettiBefore = document.querySelectorAll('.rk-confetti').length;
  cheered.enc.answer(q.correctIndex);
  assert.equal(quiz(cheered.enc).hidden, true, 'rätt svar går fortfarande till strid');
  assert.equal(starHits.length, 1);
  assert.equal(viaEncounter.length, 1);
  assert.equal(typeof starHits[0]?.x, 'number');
  assert.equal(typeof starHits[0]?.y, 'number');
  assert.equal(starHits[0]?.starsHint, 1);
  assert.deepEqual(viaEncounter[0], starHits[0]);
  const banners = [...document.querySelectorAll('.rk-celebrate')];
  assert.equal(banners.length, bannersBefore + 1);
  const banner = banners[banners.length - 1];
  assert.ok(banner instanceof HTMLElement);
  assert.ok(CELEBRATE_PHRASES.includes(banner.textContent as (typeof CELEBRATE_PHRASES)[number]));
  assert.equal(document.querySelectorAll('.rk-confetti').length, confettiBefore + 1);
  cheered.enc.tick(0.2);
  assert.ok(cheered.heroView.scale.y > 1, 'hjälten ska studsa');
  assert.ok(cheered.heroView.position.y < 0);
  assert.equal(cheered.kills.length, 0, 'studsen sker medan striden pågår');
  for (let i = 0; i < 30; i++) cheered.enc.tick(0.05);
  assert.equal(cheered.heroView.scale.x, 1);
  assert.equal(cheered.heroView.scale.y, 1);
  assert.equal(cheered.heroView.position.y, 0, 'studsen ska tillbaka');
  assert.equal(cheered.kills.length, 1, 'den enda frågan fäller efter striden');
  assert.equal(cheered.enc.isQuestion(), false, 'ingen andra fråga');
  assert.equal(cheered.enc.busy(), false);
} finally {
  setStarFlyHandler(null);
  cheered.enc.dispose();
}

console.log('learn encounter ok');

clearBankCache('svenska');
let svenskaLoads = 0;
setBankImporterForTests('svenska', () => {
  svenskaLoads += 1;
  if (svenskaLoads === 1) return Promise.reject(new Error('nät'));
  return import('../src/data/fragor_svenska.json');
});
await assert.rejects(() => ensureBank('svenska'));
const retried = await ensureBank('svenska');
assert.equal(await ensureBank('svenska'), retried, 'lyckad laddning ska cachas efter fel');
assert.equal(svenskaLoads, 2);
assert.ok(bankCount('svenska', 'ak1') >= 15);
setBankImporterForTests('svenska', null);
