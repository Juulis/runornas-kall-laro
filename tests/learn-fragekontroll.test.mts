/**
 * Frågekontroll: matte utan likvärdiga alternativ, och strikta frågebanker.
 * Kör: npx tsx tests/learn-fragekontroll.test.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng } from '../src/core/Rng';
import { nextBankQuestion, ensureBank, bankCount, type BankSubject } from '../src/learn/bank';
import { multipleChoice, numberChoices } from '../src/learn/choices';
import { answerKey, answerNumber } from '../src/learn/equivalence';
import { isHardMathRule } from '../src/learn/hardQuestion';
import { FRACTIONS, MATH_RULES, nextMathQuestion } from '../src/learn/mathQuestions';
import { GRADES, choiceMatchesAnswer, isGradeId, isValidQuestion, type GradeId, type LearnQuestion } from '../src/learn/types';

const PER_RULE = 2000;
const EARLY: ReadonlySet<GradeId> = new Set(['forskola', 'ak1', 'ak2', 'ak3']);
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

assert.equal(answerKey('1'), answerKey('1,0'));
assert.equal(answerKey('1'), answerKey('1.0'));
assert.equal(answerKey('1'), answerKey('2/2'));
assert.equal(answerKey('1'), answerKey('100%'));
assert.equal(answerKey('0,5'), answerKey('1/2'));
assert.equal(answerKey('2/4'), answerKey('1/2'));
assert.equal(answerKey('50%'), answerKey('50 procent'));
assert.equal(answerKey('-0'), answerKey('0'));
assert.equal(answerKey('−0'), answerKey('0,0'));
assert.equal(answerKey('x = 1 eller x = 2'), answerKey('x = 2 eller x = 1'));
assert.equal(answerKey('x = 2 eller x = −1'), answerKey('x = -1 eller x = 2'));
assert.notEqual(answerKey('x = 1 eller x = 2'), answerKey('x = -1 eller x = 2'));
assert.equal(answerKey('🐶 Hund!'), answerKey('hund'));
assert.equal(answerKey('8️⃣ åtta'), answerKey('åtta'));
assert.notEqual(answerKey('8 åtta'), answerKey('åtta'));
assert.equal(answerKey('  Äpple '), answerKey('äpple'));
assert.notEqual(answerKey('25'), answerKey('25%'));
assert.equal(answerNumber('2/4'), 0.5);
assert.equal(answerNumber('7:00'), null);

const filtered = multipleChoice(new Rng(1), '1', ['1,0', '1.0', '2', '3', '4', '2/2']);
assert.equal(filtered.choices.includes('1,0'), false);
assert.equal(filtered.choices.includes('1'), true);
assert.equal(new Set(filtered.choices.map((choice) => answerKey(choice))).size, 4);
assert.throws(() => multipleChoice(new Rng(1), '1', ['1,0', '1.0', '2/2', '100%']));
const aroundZero = numberChoices(new Rng(2), 0, [-3, -1, 0, 1], { min: 0 });
assert.equal(aroundZero.choices.length, 4);
for (const choice of aroundZero.choices) assert.ok(Number(choice) >= 0, choice);

assert.ok(FRACTIONS.length >= 24, `FRACTIONS ${FRACTIONS.length}`);

function formatTenths(tenths: number): string {
  const sign = tenths < 0 ? '-' : '';
  const t = Math.abs(tenths);
  const whole = Math.floor(t / 10);
  const frac = t % 10;
  if (frac === 0) return `${sign}${whole}`;
  return `${sign}${whole},${frac}`;
}

function operandTenths(raw: string): number {
  const neg = raw.startsWith('-');
  const body = neg ? raw.slice(1) : raw;
  const comma = body.match(/^(\d+),(\d)$/);
  let tenths: number;
  if (comma?.[1] && comma[2]) tenths = Number(comma[1]) * 10 + Number(comma[2]);
  else if (/^\d+$/.test(body)) tenths = Number(body) * 10;
  else throw new Error(`okänt tal ${raw}`);
  return neg ? -tenths : tenths;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function formatSum(n1: number, d1: number, n2: number, d2: number): string {
  const num = n1 * d2 + n2 * d1;
  const den = d1 * d2;
  const g = gcd(num, den);
  const nn = num / g;
  const dd = den / g;
  if (dd === 1) return String(nn);
  return `${nn}/${dd}`;
}

function fromSup(s: string): number {
  let n = 0;
  for (const ch of s) {
    const i = SUP.indexOf(ch);
    if (i < 0) throw new Error(`okänd potens ${ch}`);
    n = n * 10 + i;
  }
  return n;
}

function perfectSqrt(n: number): number | null {
  const s = Math.round(Math.sqrt(n));
  return s * s === n ? s : null;
}

interface Solved {
  exact?: string;
  value?: number;
  fraction?: boolean;
}

function solveQuad(prompt: string): string | null {
  const m = prompt.match(/^Vilka lösningar har x²(.*)= 0\?$/);
  if (!m?.[1] && m?.[1] !== '') return null;
  const rest = (m[1] ?? '').trim();
  let b = 0;
  let c = 0;
  let found = false;
  for (const part of rest.matchAll(/([+−-])\s*(\d*)(x)?/g)) {
    found = true;
    const sign = part[1] === '+' ? 1 : -1;
    const mag = part[2] ? Number(part[2]) : 1;
    if (part[3] === 'x') b += sign * mag;
    else c += sign * mag;
  }
  if (!found && rest.length > 0) return null;
  const consumed = rest.replace(/([+−-])\s*(\d*)(x)?/g, '').replace(/\s+/g, '');
  if (consumed.length > 0) return null;
  const d = b * b - 4 * c;
  const s = Math.round(Math.sqrt(d));
  if (s * s !== d) throw new Error(`andragrad utan heltalsrötter: ${prompt}`);
  const left = (-b + s) / 2;
  const right = (-b - s) / 2;
  if (!Number.isInteger(left) || !Number.isInteger(right)) throw new Error(prompt);
  const r1 = Math.min(left, right);
  const r2 = Math.max(left, right);
  return `x = ${r1} eller x = ${r2}`;
}

function num(raw: string | undefined): number {
  if (raw === undefined) throw new Error('saknar tal');
  return Number(raw);
}

/** Räknar ut facit från prompten, oberoende av meta. */
function solvePrompt(prompt: string): Solved {
  const quad = solveQuad(prompt);
  if (quad) return { exact: quad };

  const prio1 = prompt.match(/^(\d+) \+ (\d+) × (\d+) = \?$/);
  if (prio1) {
    const value = num(prio1[1]) + num(prio1[2]) * num(prio1[3]);
    return { exact: String(value), value };
  }
  const prio2 = prompt.match(/^(\d+) × (\d+) \+ (\d+) = \?$/);
  if (prio2) {
    const value = num(prio2[1]) * num(prio2[2]) + num(prio2[3]);
    return { exact: String(value), value };
  }
  const prio3 = prompt.match(/^\((\d+) \+ (\d+)\) × (\d+) = \?$/);
  if (prio3) {
    const value = (num(prio3[1]) + num(prio3[2])) * num(prio3[3]);
    return { exact: String(value), value };
  }
  const prio4 = prompt.match(/^(\d+) × \((\d+) \+ (\d+)\) = \?$/);
  if (prio4) {
    const value = num(prio4[1]) * (num(prio4[2]) + num(prio4[3]));
    return { exact: String(value), value };
  }

  const simple = prompt.match(/^(-?\d+(?:,\d)?) ([+−]) (-?\d+(?:,\d)?) = \?$/);
  if (simple?.[1] && simple[2] && simple[3]) {
    const left = operandTenths(simple[1]);
    const right = operandTenths(simple[3]);
    const tenths = simple[2] === '+' ? left + right : left - right;
    const exact = formatTenths(tenths);
    return { exact, value: tenths / 10 };
  }

  const times = prompt.match(/^(\d+) × (\d+) = \?$/);
  if (times) {
    const value = num(times[1]) * num(times[2]);
    return { exact: String(value), value };
  }
  const div = prompt.match(/^(\d+) ÷ (\d+) = \?$/);
  if (div) {
    const a = num(div[1]);
    const b = num(div[2]);
    if (b === 0 || a % b !== 0) throw new Error(prompt);
    return { exact: String(a / b), value: a / b };
  }
  const power = prompt.match(/^(\d+)([⁰¹²³⁴⁵⁶⁷⁸⁹]+) = \?$/);
  if (power?.[1] && power[2]) {
    const value = num(power[1]) ** fromSup(power[2]);
    return { exact: String(value), value };
  }

  const pct = prompt.match(/^Vad är (\d+) % av (\d+)\?$/);
  if (pct) {
    const part = num(pct[1]);
    const base = num(pct[2]);
    if ((base * part) % 100 !== 0) throw new Error(prompt);
    const value = (base * part) / 100;
    return { exact: String(value), value };
  }
  const up = prompt.match(/^En sak kostar (\d+) kr och blir (\d+) % dyrare\. Vad kostar den då\?$/);
  if (up) {
    const price = num(up[1]);
    const part = num(up[2]);
    if ((price * part) % 100 !== 0) throw new Error(prompt);
    const value = price + (price * part) / 100;
    return { exact: String(value), value };
  }
  const down = prompt.match(/^En sak kostar (\d+) kr och blir (\d+) % billigare\. Vad kostar den då\?$/);
  if (down) {
    const price = num(down[1]);
    const part = num(down[2]);
    if ((price * part) % 100 !== 0) throw new Error(prompt);
    const value = price - (price * part) / 100;
    return { exact: String(value), value };
  }
  const rose = prompt.match(/^En sak kostar (\d+) kr och kostar sedan (\d+) kr\. Med hur många procent har priset ökat\?$/);
  if (rose) {
    const from = num(rose[1]);
    const to = num(rose[2]);
    if (from === 0 || ((to - from) * 100) % from !== 0) throw new Error(prompt);
    const value = ((to - from) * 100) / from;
    return { exact: String(value), value };
  }
  const fell = prompt.match(/^En sak kostar (\d+) kr och kostar sedan (\d+) kr\. Med hur många procent har priset minskat\?$/);
  if (fell) {
    const from = num(fell[1]);
    const to = num(fell[2]);
    if (from === 0 || ((from - to) * 100) % from !== 0) throw new Error(prompt);
    const value = ((from - to) * 100) / from;
    return { exact: String(value), value };
  }

  const xPlus = prompt.match(/^x \+ (\d+) = (-?\d+)\. Vad är x\?$/);
  if (xPlus) {
    const value = num(xPlus[2]) - num(xPlus[1]);
    return { exact: String(value), value };
  }
  const xMinus = prompt.match(/^x − (\d+) = (-?\d+)\. Vad är x\?$/);
  if (xMinus) {
    const value = num(xMinus[2]) + num(xMinus[1]);
    return { exact: String(value), value };
  }
  const axb = prompt.match(/^(\d+)x \+ (\d+) = (-?\d+)\. Vad är x\?$/);
  if (axb) {
    const a = num(axb[1]);
    const b = num(axb[2]);
    const c = num(axb[3]);
    if ((c - b) % a !== 0) throw new Error(prompt);
    const value = (c - b) / a;
    return { exact: String(value), value };
  }
  const axm = prompt.match(/^(\d+)x − (\d+) = (-?\d+)\. Vad är x\?$/);
  if (axm) {
    const a = num(axm[1]);
    const b = num(axm[2]);
    const c = num(axm[3]);
    if ((c + b) % a !== 0) throw new Error(prompt);
    const value = (c + b) / a;
    return { exact: String(value), value };
  }
  const ax = prompt.match(/^(\d+)x = (-?\d+)\. Vad är x\?$/);
  if (ax) {
    const a = num(ax[1]);
    const c = num(ax[2]);
    if (c % a !== 0) throw new Error(prompt);
    const value = c / a;
    return { exact: String(value), value };
  }

  const root = prompt.match(/^Vad är kvadratroten ur (\d+)\?$/);
  if (root) {
    const sq = num(root[1]);
    const s = perfectSqrt(sq);
    if (s === null) throw new Error(prompt);
    return { exact: String(s), value: s };
  }
  const round = prompt.match(/^Avrunda (\d+(?:,\d)?) till närmaste heltal\.$/);
  if (round?.[1]) {
    const tenths = operandTenths(round[1]);
    const frac = Math.abs(tenths) % 10;
    if (frac === 5) throw new Error(`tvetydig avrundning ${prompt}`);
    const whole = Math.trunc(tenths / 10);
    const value = frac >= 6 ? whole + (tenths < 0 ? -1 : 1) : whole;
    return { exact: String(value), value };
  }
  const peri = prompt.match(/^En rektangel är (\d+) cm lång och (\d+) cm bred\. Hur många centimeter är omkretsen\?$/);
  if (peri) {
    const value = 2 * (num(peri[1]) + num(peri[2]));
    return { exact: String(value), value };
  }
  const area = prompt.match(/^En rektangel är (\d+) cm lång och (\d+) cm bred\. Hur många kvadratcentimeter är arean\?$/);
  if (area) {
    const value = num(area[1]) * num(area[2]);
    return { exact: String(value), value };
  }

  const tio = prompt.match(/^Vilket tal är tiokamrat till (\d+)\? \(tillsammans blir de 10\)$/);
  if (tio) {
    const value = 10 - num(tio[1]);
    return { exact: String(value), value };
  }
  const dubbel = prompt.match(/^Vad är det dubbla av (\d+)\?$/);
  if (dubbel) {
    const value = num(dubbel[1]) * 2;
    return { exact: String(value), value };
  }
  const half = prompt.match(/^Vad är hälften av (\d+)\?$/);
  if (half) {
    const n = num(half[1]);
    if (n % 2 !== 0) throw new Error(prompt);
    return { exact: String(n / 2), value: n / 2 };
  }
  const hel = prompt.match(/^Klockan är hel\. Timvisaren pekar på (\d+)\. Hur mycket är klockan\?$/);
  if (hel) return { exact: `${num(hel[1])}:00` };
  const halv = prompt.match(/^Klockan är halv (\d+)\. Hur mycket är klockan\?$/);
  if (halv) {
    const h = num(halv[1]);
    const hour = h === 1 ? 12 : h - 1;
    return { exact: `${hour}:30` };
  }
  const after = prompt.match(/^Vilket tal kommer efter (\d+)\?$/);
  if (after) {
    const value = num(after[1]) + 1;
    return { exact: String(value), value };
  }
  const before = prompt.match(/^Vilket tal kommer före (\d+)\?$/);
  if (before) {
    const n = num(before[1]);
    if (n < 1) throw new Error(prompt);
    return { exact: String(n - 1), value: n - 1 };
  }
  const seq = prompt.match(/^(\d+), (\d+), (\d+), \?$/);
  if (seq) {
    const a = num(seq[1]);
    const b = num(seq[2]);
    const c = num(seq[3]);
    if (b !== a + 1 || c !== b + 1) throw new Error(prompt);
    return { exact: String(c + 1), value: c + 1 };
  }
  const big = prompt.match(/^Vilket tal är störst: (\d+) eller (\d+)\?$/);
  if (big) {
    const value = Math.max(num(big[1]), num(big[2]));
    return { exact: String(value), value };
  }
  const small = prompt.match(/^Vilket tal är minst: (\d+) eller (\d+)\?$/);
  if (small) {
    const value = Math.min(num(small[1]), num(small[2]));
    return { exact: String(value), value };
  }
  const count = prompt.match(/^Hur många (\p{Extended_Pictographic}(?:\uFE0F)?)\? ((?:\1)+)$/u);
  if (count?.[1] && count[2]) {
    const value = [...count[2]].length / [...count[1]].length;
    if (!Number.isInteger(value)) throw new Error(prompt);
    return { exact: String(value), value };
  }

  const sam = prompt.match(/^Sam har (\d+) kronor och får (\d+) kronor till\. Hur många kronor har Sam då\?$/);
  if (sam) {
    const value = num(sam[1]) + num(sam[2]);
    return { exact: String(value), value };
  }
  const bok = prompt.match(/^En bok kostar (\d+) kronor och en penna kostar (\d+) kronor\. Hur många kronor kostar de tillsammans\?$/);
  if (bok) {
    const value = num(bok[1]) + num(bok[2]);
    return { exact: String(value), value };
  }
  const glass = prompt.match(/^Noor har (\d+) kronor och köper en glass för (\d+) kronor\. Hur många kronor har Noor kvar\?$/);
  if (glass) {
    const value = num(glass[1]) - num(glass[2]);
    return { exact: String(value), value };
  }
  const boll = prompt.match(/^Eli har (\d+) kronor och köper en boll för (\d+) kronor\. Hur många kronor har Eli kvar\?$/);
  if (boll) {
    const value = num(boll[1]) - num(boll[2]);
    return { exact: String(value), value };
  }

  const av = prompt.match(/^(?:Vad är )?(\d+)\/(\d+) av (\d+)(?: är …|\?)$/);
  if (av) {
    const numer = num(av[1]);
    const den = num(av[2]);
    const whole = num(av[3]);
    if (den === 0 || whole % den !== 0) throw new Error(prompt);
    const value = (whole / den) * numer;
    return { exact: String(value), value };
  }
  const add = prompt.match(/^Vad är (\d+)\/(\d+) \+ (\d+)\/(\d+)\?$/);
  if (add) {
    const exact = formatSum(num(add[1]), num(add[2]), num(add[3]), num(add[4]));
    return { exact, value: answerNumber(exact) ?? undefined };
  }
  const extreme = prompt.match(/^Vilket bråk är (störst|minst): (.+)\?$/);
  if (extreme?.[1] && extreme[2]) {
    const fracs = extreme[2].split(/, | eller /);
    if (fracs.length !== 4) throw new Error(prompt);
    let best = fracs[0] ?? '';
    for (const frac of fracs) {
      const v = answerNumber(frac);
      const b = answerNumber(best);
      if (v === null || b === null) throw new Error(prompt);
      if (extreme[1] === 'störst' ? v > b : v < b) best = frac;
    }
    return { exact: best, value: answerNumber(best) ?? undefined };
  }
  const many = prompt.match(/^Hur många (fjärdedelar|halvor|tredjedelar|femtedelar|åttondelar) är en (halv|hel)\?$/);
  if (many?.[1] && many[2]) {
    const den = { fjärdedelar: 4, halvor: 2, tredjedelar: 3, femtedelar: 5, åttondelar: 8 }[many[1]];
    const part = many[2] === 'halv' ? 0.5 : 1;
    const value = (den ?? 0) * part;
    if (!Number.isInteger(value)) throw new Error(prompt);
    return { exact: String(value), value };
  }
  const means = prompt.match(/^Vilket bråk betyder en (halv|fjärdedel|tredjedel)\?$/);
  if (means?.[1]) {
    const value = { halv: 1 / 2, fjärdedel: 1 / 4, tredjedel: 1 / 3 }[means[1]];
    return { value, fraction: true };
  }
  const like = prompt.match(/^Vilket bråk är lika stort som (\d+)\/(\d+)\?$/);
  if (like) return { value: num(like[1]) / num(like[2]), fraction: true };

  throw new Error(`kan inte räkna om: ${prompt}`);
}

function assertUniqueExtreme(q: LearnQuestion, kind: 'max' | 'min'): void {
  const vals = q.choices.map((choice) => {
    const n = answerNumber(choice);
    assert.ok(n !== null, `${q.prompt} ${choice}`);
    return n;
  });
  const best = kind === 'max' ? Math.max(...vals) : Math.min(...vals);
  const got = answerNumber(q.answer);
  assert.ok(got !== null && Math.abs(got - best) < 1e-9, q.prompt);
  assert.equal(vals.filter((v) => Math.abs(v - best) < 1e-9).length, 1, q.prompt);
}

const hits08: LearnQuestion[] = [];

function checkMath(q: LearnQuestion): void {
  assert.equal(q.choices.length, 4, q.prompt);
  assert.equal(q.subject, 'matte');
  assert.ok(MATH_RULES[q.grade].includes(q.rule), `${q.grade} ${q.rule}`);
  assert.equal(isValidQuestion(q), true, q.id);
  const keys = q.choices.map((choice) => answerKey(choice));
  assert.equal(new Set(keys).size, 4, `${q.rule} ${q.prompt} ${q.choices.join(' | ')}`);
  assert.equal(q.choices[q.correctIndex], q.answer, q.prompt);
  assert.equal(q.choices.filter((choice) => answerKey(choice) === answerKey(q.answer)).length, 1, q.prompt);
  assert.equal(q.choices.includes('1') && (q.choices.includes('1,0') || q.choices.includes('1.0')), false, q.prompt);
  assert.equal(isHardMathRule(q.rule) ? q.needsScratchpad : q.needsScratchpad === undefined, true, q.rule);

  const solved = solvePrompt(q.prompt);
  if (solved.exact !== undefined) assert.equal(q.answer, solved.exact, q.prompt);
  if (solved.value !== undefined) {
    const got = answerNumber(q.answer);
    assert.ok(got !== null, q.prompt);
    assert.ok(Math.abs(got - solved.value) < 1e-9, `${q.prompt} svar ${q.answer}`);
  }
  if (solved.fraction) {
    assert.match(q.answer, /^\d+\/\d+$/, q.prompt);
    const got = answerNumber(q.answer);
    assert.ok(got !== null && solved.value !== undefined && Math.abs(got - solved.value) < 1e-9, q.prompt);
  }

  const asNum = answerNumber(q.answer);
  if (asNum !== null) {
    assert.equal(typeof q.meta?.result, 'number', q.prompt);
    assert.ok(Math.abs((q.meta?.result ?? NaN) - asNum) < 1e-6, `${q.prompt} result ${q.meta?.result}`);
    if (Number.isInteger(asNum)) assert.equal(q.answer, String(asNum), q.prompt);
  }
  if (EARLY.has(q.grade)) {
    for (const choice of [q.answer, ...q.choices]) {
      assert.equal(/^[−-]/.test(choice.trim()), false, `${q.rule} ${choice}`);
      const n = answerNumber(choice);
      if (n !== null) assert.ok(n >= 0, `${q.rule} ${choice}`);
    }
  }
  if (q.grade === 'forskola') {
    assert.equal(q.speakLang, 'sv-SE', q.rule);
    assert.ok(q.speakText && q.speakText.length > 0, q.rule);
  }
  if (q.prompt === '0,8 + 0,2 = ?' || q.prompt === '0,2 + 0,8 = ?') hits08.push(q);
  assert.notEqual(q.prompt, '0,0 + 0,0 = ?');

  if (/^Vilket (?:bråk|tal) är störst:/.test(q.prompt)) assertUniqueExtreme(q, 'max');
  if (/^Vilket (?:bråk|tal) är minst:/.test(q.prompt)) assertUniqueExtreme(q, 'min');

  if (q.rule === 'ak2-tabell') assert.ok(q.meta?.a === 2 || q.meta?.a === 5 || q.meta?.a === 10, q.prompt);
  if (q.rule === 'ak3-tabell34') assert.ok(q.meta?.a === 3 || q.meta?.a === 4, q.prompt);
  if (q.rule === 'ak79-ekvation') assert.equal(q.meta?.b, (q.meta?.result ?? NaN) + (q.meta?.a ?? NaN), q.prompt);
  if (q.rule === 'gym-andragrads') {
    const roots = q.answer.match(/^x = (-?\d+) eller x = (-?\d+)$/);
    assert.ok(roots?.[1] && roots[2], q.answer);
    assert.equal(q.meta?.r1, Number(roots[1]));
    assert.equal(q.meta?.r2, Number(roots[2]));
    assert.ok((q.meta?.r1 ?? 1) <= (q.meta?.r2 ?? 0));
  }
  if (q.rule === 'forskola-rakna') {
    const count = q.prompt.match(/^Hur många (\p{Extended_Pictographic}(?:\uFE0F)?)\? ((?:\1)+)$/u);
    assert.ok(count?.[1] && count[2], q.prompt);
    assert.equal([...count[2]].length / [...count[1]].length, q.meta?.result);
  }
}

for (const grade of GRADES) {
  const rules = MATH_RULES[grade.id];
  const left = new Map(rules.map((rule) => [rule, PER_RULE]));
  const rng = new Rng(Rng.hash('fragekontroll', grade.id));
  const cap = PER_RULE * rules.length * 40;
  let steps = 0;
  while ([...left.values()].some((n) => n > 0)) {
    if (++steps > cap) {
      const missing = [...left.entries()].filter(([, n]) => n > 0).map(([rule, n]) => `${rule}:${n}`);
      assert.fail(`${grade.id} fick inte ${PER_RULE} av ${missing.join(', ')}`);
    }
    const q = nextMathQuestion(rng, grade.id, steps, 'fk');
    const remain = left.get(q.rule);
    if (remain === undefined) assert.fail(`${grade.id} okänd regel ${q.rule}`);
    if (remain <= 0) continue;
    left.set(q.rule, remain - 1);
    checkMath(q);
  }
  for (const rule of rules) assert.equal(left.get(rule), 0, `${grade.id} ${rule}`);
}

assert.ok(hits08.length >= 1, 'såg aldrig 0,8 + 0,2');
for (const q of hits08) {
  assert.equal(q.answer, '1', q.prompt);
  assert.equal(q.choices.includes('1'), true, q.choices.join(','));
  assert.equal(q.choices.includes('1,0'), false, q.choices.join(','));
  assert.equal(q.choices.filter((choice) => answerKey(choice) === answerKey('1')).length, 1);
}

const BANK_SUBJECTS = ['svenska', 'engelska', 'lasforstaelse', 'horforstaelse'] as const;
const bankProblems: string[] = [];

function textsOf(fel: unknown): string[] {
  if (!Array.isArray(fel)) return [];
  return fel.map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object' && 'ord' in item && typeof item.ord === 'string') return item.ord;
    return '';
  });
}

function emojiAt(item: unknown, list: unknown, index: number): string {
  if (item && typeof item === 'object' && 'emoji' in item && typeof item.emoji === 'string' && item.emoji.trim()) return item.emoji.trim();
  if (Array.isArray(list) && typeof list[index] === 'string') return list[index].trim();
  return '';
}

for (const subject of BANK_SUBJECTS) {
  const file = JSON.parse(readFileSync(join(ROOT, 'src', 'data', `fragor_${subject}.json`), 'utf8')) as {
    amne?: unknown;
    fragor?: unknown;
  };
  if (file.amne !== subject) bankProblems.push(`${subject}: fel amne`);
  if (!Array.isArray(file.fragor)) {
    bankProblems.push(`${subject}: saknar fragor`);
    continue;
  }
  const ids = new Set<string>();
  for (const row of file.fragor) {
    if (!row || typeof row !== 'object') {
      bankProblems.push(`${subject}: rad är inte ett objekt`);
      continue;
    }
    const rec = row as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id : '?';
    const bad = (message: string): void => {
      bankProblems.push(`${subject} ${id}: ${message}`);
    };
    if (typeof rec.id !== 'string' || !rec.id.trim()) bad('saknar id');
    else if (ids.has(rec.id)) bad('dubblett-id');
    else ids.add(rec.id);
    if (!isGradeId(rec.niva)) bad('ogiltig niva');
    if (typeof rec.fraga !== 'string' || !rec.fraga.trim()) bad('saknar fraga');
    if (typeof rec.ratt !== 'string' || !rec.ratt.trim()) bad('saknar ratt');
    if (typeof rec.typ !== 'string' || !rec.typ.trim()) bad('saknar typ');
    if (!Array.isArray(rec.fel) || rec.fel.length !== 3) bad('fel måste vara exakt 3');
    const wrongs = textsOf(rec.fel);
    if (wrongs.length !== 3 || wrongs.some((text) => !text.trim())) {
      bad('tomt felsvar');
      continue;
    }
    const options = [String(rec.ratt), ...wrongs];
    if (new Set(options.map((text) => answerKey(text))).size !== 4) bad(`likvärdiga alternativ ${JSON.stringify(options)}`);
    const emojis = [
      typeof rec.emoji === 'string' ? rec.emoji.trim() : '',
      emojiAt(rec.fel?.[0], rec.fel_emoji, 0),
      emojiAt(rec.fel?.[1], rec.fel_emoji, 1),
      emojiAt(rec.fel?.[2], rec.fel_emoji, 2),
    ];
    if (rec.fel_emoji !== undefined && (!Array.isArray(rec.fel_emoji) || rec.fel_emoji.length !== 3)) bad('fel_emoji måste ha 3');
    if (emojis.some((emoji) => emoji)) {
      if (emojis.some((emoji) => !emoji)) bad('emoji-lista ofullständig');
      if (new Set(emojis).size !== 4) bad(`emoji inte unika ${emojis.join(' ')}`);
      const prefixed = options.map((text, i) => `${emojis[i]} ${text}`);
      if (new Set(prefixed.map((text) => answerKey(text))).size !== 4) bad(`likvärdiga emoji-val ${JSON.stringify(prefixed)}`);
    }
    if ((subject === 'lasforstaelse' || subject === 'horforstaelse') && (typeof rec.text !== 'string' || !rec.text.trim()))
      bad('saknar text');
    if (subject === 'horforstaelse' && rec.sprak !== 'sv' && rec.sprak !== 'en') bad('sprak måste vara sv/en');
  }
}

if (bankProblems.length) {
  console.log(bankProblems.slice(0, 80).join('\n'));
  assert.fail(`${bankProblems.length} fel i frågebankerna`);
}

function checkBankQuestion(q: LearnQuestion, subject: BankSubject): void {
  assert.equal(q.choices.length, 4, q.id);
  assert.equal(new Set(q.choices.map((choice) => answerKey(choice))).size, 4, q.id);
  assert.equal(q.choices.filter((choice) => answerKey(choice) === answerKey(q.answer)).length, 1, q.id);
  const chosen = q.choices[q.correctIndex];
  assert.ok(chosen !== undefined && answerKey(chosen) === answerKey(q.answer), q.id);
  assert.equal(choiceMatchesAnswer(chosen, q.answer), true, q.id);
  assert.equal(isValidQuestion(q), true, q.id);
  if (subject === 'lasforstaelse' || subject === 'horforstaelse') assert.ok(q.passage && q.passage.trim().length > 0, q.id);
  if (subject === 'horforstaelse') {
    assert.ok(q.speakLang === 'sv-SE' || q.speakLang === 'en-US', q.id);
    assert.equal(q.hidePassageUntilAnswered, true, q.id);
  }
}

for (const subject of BANK_SUBJECTS) {
  await ensureBank(subject);
  for (const grade of GRADES) {
    const count = bankCount(subject, grade.id);
    const higherLas = subject === 'lasforstaelse' && count === 0;
    if (higherLas && (grade.id === 'forskola' || grade.id === 'ak1' || grade.id === 'ak2' || grade.id === 'ak3')) {
      assert.fail(`${subject} ${grade.id} saknar frågor`);
    }
    if (!higherLas && count === 0) assert.fail(`${subject} ${grade.id} saknar frågor`);
    const draws = higherLas ? 8 : Math.min(24, Math.max(count, 8));
    const rng = new Rng(Rng.hash('bankkontroll', subject, grade.id));
    const avoid = new Set<string>();
    for (let i = 0; i < draws; i++) checkBankQuestion(nextBankQuestion(rng, subject, grade.id, i, 'bk', avoid), subject);
  }
}

console.log('learn fragekontroll ok', { fractioner: FRACTIONS.length, decimal08: hits08.length, perRegel: PER_RULE });
