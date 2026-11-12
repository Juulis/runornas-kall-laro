import type { Rng } from '../core/Rng';
import { multipleChoice, numberChoices, type NumberChoiceBounds } from './choices';
import { answerKey, answerNumber } from './equivalence';
import { isHardMathRule } from './hardQuestion';
import type { GradeId, LearnQuestion, QuestionMeta } from './types';

/** Vilka matte-regler som hör till varje nivå. Gymnasiet och vuxen delar spår. */
export const MATH_RULES: Record<GradeId, readonly string[]> = {
  forskola: ['forskola-plus', 'forskola-minus', 'forskola-rakna', 'forskola-efter'],
  ak1: ['ak1-plus', 'ak1-minus', 'ak1-talfoljd', 'ak1-jamforelse'],
  ak2: ['ak2-plus', 'ak2-minus', 'ak2-tiokamrat', 'ak2-tabell', 'ak2-dubbelt', 'ak2-halften', 'ak2-klocka'],
  ak3: ['ak3-tabell', 'ak3-tabell34', 'ak3-division', 'ak3-plus', 'ak3-minus', 'ak3-kronor'],
  ak4_6: ['ak46-brak', 'ak46-decimal', 'ak46-procent', 'ak46-avrundning', 'ak46-rektangel'],
  ak7_9: ['ak79-negativ', 'ak79-ekvation', 'ak79-potens', 'ak79-prioritet', 'ak79-procent', 'ak79-rot'],
  gymnasiet: ['gym-andragrads', 'gym-procent', 'gym-huvudrakning', 'gym-ekvation'],
  vuxen: ['gym-andragrads', 'gym-procent', 'gym-huvudrakning', 'gym-ekvation'],
};

const EARLY: ReadonlySet<GradeId> = new Set(['forskola', 'ak1', 'ak2', 'ak3']);
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const TAL = ['noll', 'ett', 'två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio'] as const;

interface FractionRow {
  prompt: string;
  answer: string;
  wrong: readonly [string, string, string];
}

function svTal(n: number): string {
  return TAL[n] ?? String(n);
}

function sup(n: number): string {
  return String(n).replace(/\d/g, (d) => SUP[Number(d)] ?? d);
}

function intBetween(rng: Rng, min: number, max: number): number {
  return rng.int([min, max]);
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

/** Heltal som «1» och «0», tiondelar som «0,7». Aldrig «1,0» eller «0,0». */
function formatTenths(tenths: number): string {
  if (!Number.isInteger(tenths)) throw new Error(`tiondelar måste vara heltal, fick ${tenths}`);
  const sign = tenths < 0 ? '-' : '';
  const t = Math.abs(tenths);
  const whole = Math.floor(t / 10);
  const frac = t % 10;
  if (frac === 0) return `${sign}${whole}`;
  return `${sign}${whole},${frac}`;
}

function pack(
  grade: GradeId,
  rule: string,
  index: number,
  idPrefix: string,
  prompt: string,
  answer: string,
  choices: [string, string, string, string],
  correctIndex: number,
  meta?: QuestionMeta,
): LearnQuestion {
  return {
    id: `${idPrefix}:matte:${grade}:${rule}:${index}`,
    prompt,
    choices,
    correctIndex,
    answer,
    subject: 'matte',
    grade,
    rule,
    ...(meta ? { meta } : {}),
    ...(isHardMathRule(rule) ? { needsScratchpad: true } : {}),
  };
}

function numeric(
  rng: Rng,
  grade: GradeId,
  rule: string,
  index: number,
  idPrefix: string,
  prompt: string,
  answer: number,
  preferred: number[],
  meta: QuestionMeta,
  bounds?: NumberChoiceBounds,
): LearnQuestion {
  if (!Number.isInteger(answer)) throw new Error(`${rule} fick ett decimaltal ${answer}`);
  if (EARLY.has(grade) && answer < 0) throw new Error(`negativt svar i ${rule}`);
  const limits: NumberChoiceBounds = { ...bounds };
  if (EARLY.has(grade) && (limits.min === undefined || limits.min < 0)) limits.min = 0;
  const mc = numberChoices(rng, answer, preferred, limits);
  return pack(grade, rule, index, idPrefix, prompt, mc.answerText, mc.choices, mc.correctIndex, { ...meta, result: answer });
}

function textQ(
  rng: Rng,
  grade: GradeId,
  rule: string,
  index: number,
  idPrefix: string,
  prompt: string,
  answer: string,
  wrong: readonly string[],
  meta?: QuestionMeta,
): LearnQuestion {
  const mc = multipleChoice(rng, answer, wrong);
  const value = answerNumber(answer);
  const withResult = value === null ? meta : { ...meta, result: value };
  return pack(grade, rule, index, idPrefix, prompt, answer, mc.choices, mc.correctIndex, withResult);
}

function voiced(q: LearnQuestion, speakText: string): LearnQuestion {
  return { ...q, speakText, speakLang: 'sv-SE' };
}

/** Tre eller fler texter som inte är likvärdiga med svaret. */
function distinctTexts(answer: string, candidates: readonly string[]): string[] {
  const seen = new Set<string>([answerKey(answer)]);
  const out: string[] = [];
  for (const candidate of candidates) {
    if (!candidate.trim()) continue;
    const key = answerKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  if (out.length < 3) throw new Error(`för få olika fel för «${answer}» (${candidates.join(', ')})`);
  return out;
}

function intTexts(answer: number, candidates: readonly number[], bounds?: NumberChoiceBounds): string[] {
  const seen = new Set<string>([answerKey(String(answer))]);
  const out: string[] = [];
  const push = (n: number): void => {
    if (!Number.isInteger(n)) return;
    if (bounds?.min !== undefined && n < bounds.min) return;
    if (bounds?.max !== undefined && n > bounds.max) return;
    const text = String(n);
    const key = answerKey(text);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text);
  };
  for (const n of candidates) push(n);
  let step = 1;
  while (out.length < 3 && step < 40) {
    push(answer + step);
    push(answer - step);
    step++;
  }
  if (out.length < 3) throw new Error(`för få heltalsfel för ${answer}`);
  return out;
}

function parseFrac(text: string): number {
  const m = text.match(/^(\d+)\/(\d+)$/);
  if (!m?.[1] || !m[2] || m[2] === '0') throw new Error(`ogiltigt bråk ${text}`);
  return Number(m[1]) / Number(m[2]);
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

function avWrong(answer: number, num: number, den: number, whole: number): [string, string, string] {
  const candidates = [num, den, whole, answer + 1, answer - 1, answer + num, whole - answer, num * den, answer + den, multSafe(answer)];
  const texts = distinctTexts(String(answer), candidates.filter((n) => n >= 0).map(String));
  const a = texts[0];
  const b = texts[1];
  const c = texts[2];
  if (a === undefined || b === undefined || c === undefined) throw new Error('bråkfel');
  return [a, b, c];
}

function multSafe(answer: number): number {
  return answer + 2;
}

function avRow(num: number, den: number, mult: number, style: 'vad' | 'ar' = 'vad'): FractionRow {
  const whole = den * mult;
  const answer = num * mult;
  const prompt = style === 'vad' ? `Vad är ${num}/${den} av ${whole}?` : `${num}/${den} av ${whole} är …`;
  return { prompt, answer: String(answer), wrong: avWrong(answer, num, den, whole) };
}

const FRACTION_POOL = [
  '1',
  '2',
  '3',
  '4',
  '1/2',
  '1/3',
  '1/4',
  '1/5',
  '1/6',
  '1/8',
  '2/3',
  '2/5',
  '3/4',
  '3/5',
  '3/8',
  '4/5',
  '5/8',
  '3/2',
  '5/4',
  '2/8',
];

function addRow(n1: number, d1: number, n2: number, d2: number): FractionRow {
  const answer = formatSum(n1, d1, n2, d2);
  const prompt = `Vad är ${n1}/${d1} + ${n2}/${d2}?`;
  const texts = distinctTexts(answer, [`${n1}/${d1}`, `${n2}/${d2}`, ...FRACTION_POOL]);
  const a = texts[0];
  const b = texts[1];
  const c = texts[2];
  if (a === undefined || b === undefined || c === undefined) throw new Error(prompt);
  return { prompt, answer, wrong: [a, b, c] };
}

function compareRow(kind: 'störst' | 'minst', fracs: readonly [string, string, string, string]): FractionRow {
  const values = fracs.map(parseFrac);
  let best = 0;
  for (let i = 1; i < fracs.length; i++) {
    const v = values[i];
    const b = values[best];
    if (v === undefined || b === undefined) throw new Error('bråk');
    if (kind === 'störst' ? v > b : v < b) best = i;
  }
  const bestVal = values[best];
  if (bestVal === undefined || values.filter((v) => v !== undefined && Math.abs(v - bestVal) < 1e-9).length !== 1) {
    throw new Error(`bråken är inte entydiga: ${fracs.join(' ')}`);
  }
  const answer = fracs[best];
  if (answer === undefined) throw new Error('saknar bråk');
  const wrong = fracs.filter((_, i) => i !== best);
  const w0 = wrong[0];
  const w1 = wrong[1];
  const w2 = wrong[2];
  if (w0 === undefined || w1 === undefined || w2 === undefined) throw new Error('saknar felbråk');
  const listed = `${fracs[0]}, ${fracs[1]}, ${fracs[2]} eller ${fracs[3]}`;
  return { prompt: `Vilket bråk är ${kind}: ${listed}?`, answer, wrong: [w0, w1, w2] };
}

function concept(prompt: string, answer: string, wrong: readonly [string, string, string]): FractionRow {
  return { prompt, answer, wrong };
}

/** Minst dubbelt så lång som den gamla tabellen på 12 rader. Facit kontrolleras vid start. */
export const FRACTIONS: readonly FractionRow[] = [
  avRow(1, 2, 4),
  avRow(1, 2, 5),
  avRow(1, 2, 3),
  avRow(1, 2, 6),
  avRow(1, 2, 10),
  avRow(1, 4, 3),
  avRow(1, 4, 5),
  avRow(1, 4, 2),
  avRow(1, 4, 4),
  avRow(1, 4, 8),
  avRow(3, 4, 2),
  avRow(3, 4, 3),
  avRow(3, 4, 5),
  avRow(1, 5, 2),
  avRow(1, 5, 4),
  avRow(2, 5, 2),
  avRow(3, 5, 2),
  avRow(3, 5, 3),
  avRow(2, 3, 3),
  avRow(2, 3, 4),
  avRow(1, 3, 3),
  avRow(1, 3, 4),
  avRow(1, 3, 5),
  avRow(1, 10, 5),
  avRow(1, 10, 10),
  avRow(3, 10, 2),
  avRow(4, 5, 2),
  avRow(1, 8, 2),
  avRow(2, 4, 2),
  avRow(3, 8, 2),
  avRow(1, 5, 2, 'ar'),
  avRow(2, 3, 3, 'ar'),
  addRow(1, 2, 1, 2),
  addRow(1, 4, 1, 4),
  addRow(1, 2, 1, 4),
  addRow(1, 3, 1, 3),
  addRow(2, 3, 1, 3),
  addRow(1, 5, 2, 5),
  addRow(1, 6, 1, 6),
  addRow(1, 8, 1, 8),
  addRow(3, 8, 1, 8),
  addRow(1, 2, 1, 8),
  concept('Hur många fjärdedelar är en halv?', '2', ['1', '3', '4']),
  concept('Hur många fjärdedelar är en hel?', '4', ['2', '3', '8']),
  concept('Hur många halvor är en hel?', '2', ['1', '3', '4']),
  concept('Hur många tredjedelar är en hel?', '3', ['1', '2', '6']),
  concept('Hur många femtedelar är en hel?', '5', ['2', '4', '10']),
  concept('Hur många åttondelar är en halv?', '4', ['2', '3', '8']),
  concept('Hur många åttondelar är en hel?', '8', ['4', '2', '6']),
  concept('Vilket bråk betyder en halv?', '1/2', ['1/3', '1/4', '2/3']),
  concept('Vilket bråk betyder en fjärdedel?', '1/4', ['1/2', '1/3', '1/5']),
  concept('Vilket bråk betyder en tredjedel?', '1/3', ['1/2', '1/4', '3/4']),
  concept('Vilket bråk är lika stort som 2/4?', '1/2', ['1/3', '1/4', '3/4']),
  concept('Vilket bråk är lika stort som 1/2?', '2/4', ['1/3', '2/3', '3/5']),
  concept('Vilket bråk är lika stort som 2/6?', '1/3', ['1/2', '1/6', '2/3']),
  concept('Vilket bråk är lika stort som 4/8?', '1/2', ['1/4', '3/8', '4/6']),
  concept('Vilket bråk är lika stort som 5/10?', '1/2', ['1/5', '2/5', '3/5']),
  compareRow('störst', ['1/8', '1/4', '1/2', '3/4']),
  compareRow('minst', ['1/8', '1/4', '1/2', '3/4']),
  compareRow('störst', ['1/6', '1/3', '1/2', '2/3']),
  compareRow('minst', ['1/6', '1/3', '1/2', '2/3']),
  compareRow('störst', ['1/5', '2/5', '3/5', '4/5']),
  compareRow('minst', ['1/5', '2/5', '3/5', '4/5']),
  compareRow('störst', ['1/8', '3/8', '5/8', '7/8']),
  compareRow('minst', ['1/8', '3/8', '5/8', '7/8']),
  compareRow('störst', ['1/4', '1/3', '1/2', '3/5']),
  compareRow('minst', ['1/4', '1/3', '1/2', '3/5']),
  compareRow('störst', ['2/5', '1/2', '3/5', '3/4']),
  compareRow('minst', ['2/5', '1/2', '3/5', '3/4']),
  compareRow('störst', ['1/10', '1/5', '1/4', '1/2']),
  compareRow('minst', ['1/10', '1/5', '1/4', '1/2']),
];

const CONCEPT_EXACT: Record<string, string> = {
  'Hur många fjärdedelar är en halv?': '2',
  'Hur många fjärdedelar är en hel?': '4',
  'Hur många halvor är en hel?': '2',
  'Hur många tredjedelar är en hel?': '3',
  'Hur många femtedelar är en hel?': '5',
  'Hur många åttondelar är en halv?': '4',
  'Hur många åttondelar är en hel?': '8',
};

const MEANS: Record<string, string> = {
  halv: '1/2',
  fjärdedel: '1/4',
  tredjedel: '1/3',
};

function listedFractions(body: string): string[] {
  return body.split(/, | eller /);
}

function assertFractionRow(row: FractionRow): void {
  if (row.wrong.length !== 3) throw new Error(`${row.prompt}: behöver 3 fel`);
  const all = [row.answer, ...row.wrong];
  if (new Set(all.map((text) => answerKey(text))).size !== 4) {
    throw new Error(`${row.prompt}: likvärdiga alternativ ${all.join(' | ')}`);
  }
  const av = row.prompt.match(/^(?:Vad är )?(\d+)\/(\d+) av (\d+)(?: är …|\?)$/);
  if (av?.[1] && av[2] && av[3]) {
    const num = Number(av[1]);
    const den = Number(av[2]);
    const whole = Number(av[3]);
    if (den === 0 || whole % den !== 0) throw new Error(row.prompt);
    const expected = String((whole / den) * num);
    if (row.answer !== expected) throw new Error(`${row.prompt}: facit ${row.answer} borde vara ${expected}`);
    return;
  }
  const add = row.prompt.match(/^Vad är (\d+)\/(\d+) \+ (\d+)\/(\d+)\?$/);
  if (add?.[1] && add[2] && add[3] && add[4]) {
    const expected = formatSum(Number(add[1]), Number(add[2]), Number(add[3]), Number(add[4]));
    if (row.answer !== expected) throw new Error(`${row.prompt}: facit ${row.answer} borde vara ${expected}`);
    return;
  }
  const extreme = row.prompt.match(/^Vilket bråk är (störst|minst): (.+)\?$/);
  if (extreme?.[1] && extreme[2]) {
    const fracs = listedFractions(extreme[2]);
    if (fracs.length !== 4 || new Set(fracs).size !== 4) throw new Error(row.prompt);
    const choiceSet = new Set(all);
    if (fracs.some((frac) => !choiceSet.has(frac))) throw new Error(`${row.prompt}: valen matchar inte frågan`);
    const values = fracs.map(parseFrac);
    const best = extreme[1] === 'störst' ? Math.max(...values) : Math.min(...values);
    const winners = fracs.filter((_, i) => Math.abs((values[i] ?? 0) - best) < 1e-9);
    if (winners.length !== 1 || winners[0] !== row.answer) throw new Error(`${row.prompt}: facit ${row.answer}`);
    return;
  }
  if (CONCEPT_EXACT[row.prompt] !== undefined) {
    if (row.answer !== CONCEPT_EXACT[row.prompt]) throw new Error(`${row.prompt}: facit ${row.answer}`);
    return;
  }
  const means = row.prompt.match(/^Vilket bråk betyder en (halv|fjärdedel|tredjedel)\?$/);
  if (means?.[1]) {
    const target = MEANS[means[1]];
    if (target === undefined || answerKey(row.answer) !== answerKey(target)) throw new Error(row.prompt);
    return;
  }
  const like = row.prompt.match(/^Vilket bråk är lika stort som (\d+)\/(\d+)\?$/);
  if (like?.[1] && like[2]) {
    if (answerNumber(row.answer) !== answerNumber(`${like[1]}/${like[2]}`)) throw new Error(row.prompt);
    if (!/^\d+\/\d+$/.test(row.answer)) throw new Error(`${row.prompt}: svaret ska vara ett bråk`);
    return;
  }
  throw new Error(`okänd bråkfråga: ${row.prompt}`);
}

if (FRACTIONS.length < 24) throw new Error(`FRACTIONS har bara ${FRACTIONS.length} rader`);
for (const row of FRACTIONS) assertFractionRow(row);

const POWERS: readonly [number, number, number][] = [
  [2, 2, 4],
  [2, 3, 8],
  [2, 4, 16],
  [2, 5, 32],
  [3, 2, 9],
  [3, 3, 27],
  [4, 2, 16],
  [5, 2, 25],
  [5, 3, 125],
  [6, 2, 36],
  [7, 2, 49],
  [8, 2, 64],
  [9, 2, 81],
  [10, 2, 100],
  [10, 3, 1000],
];

const QUAD_ROOTS: readonly [number, number][] = [
  [1, 2],
  [1, 3],
  [2, 3],
  [1, 4],
  [2, 5],
  [3, 4],
  [-1, 2],
  [-2, 3],
  [-3, -1],
  [0, 4],
  [-2, 4],
  [2, 6],
  [1, 5],
  [1, 6],
  [2, 4],
  [3, 5],
  [4, 5],
  [4, 6],
  [-1, 1],
  [-1, 4],
  [-4, 2],
  [-5, 1],
  [0, 3],
  [0, 5],
  [-4, -2],
  [3, 6],
  [-1, 5],
  [5, 6],
  [-2, 5],
  [2, 7],
  [-6, -2],
  [1, -3],
  [4, -2],
  [6, -1],
  [0, 1],
  [2, -2],
  [0, 6],
  [3, 7],
];

const RAKNA = [
  { emoji: '🍎', singular: 'äpple', plural: 'äpplen' },
  { emoji: '⭐', singular: 'stjärna', plural: 'stjärnor' },
  { emoji: '🐶', singular: 'hund', plural: 'hundar' },
  { emoji: '🌸', singular: 'blomma', plural: 'blommor' },
] as const;

const FORSKOLA_BOUNDS: NumberChoiceBounds = { max: 10 };
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function forskolaPlus(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const a = intBetween(rng, 0, 9);
  const b = intBetween(rng, 0, Math.min(9, 10 - a));
  const q = numeric(rng, 'forskola', 'forskola-plus', index, idPrefix, `${a} + ${b} = ?`, a + b, DIGITS, { a, b }, FORSKOLA_BOUNDS);
  return voiced(q, `${svTal(a)} plus ${svTal(b)}`);
}

function forskolaMinus(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const a = intBetween(rng, 0, 9);
  const b = intBetween(rng, 0, a);
  const q = numeric(rng, 'forskola', 'forskola-minus', index, idPrefix, `${a} − ${b} = ?`, a - b, DIGITS, { a, b }, FORSKOLA_BOUNDS);
  return voiced(q, `${svTal(a)} minus ${svTal(b)}`);
}

function forskolaRakna(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const item = rng.pick(RAKNA);
  const count = intBetween(rng, 1, 10);
  const prompt = `Hur många ${item.emoji}? ${item.emoji.repeat(count)}`;
  const q = numeric(
    rng,
    'forskola',
    'forskola-rakna',
    index,
    idPrefix,
    prompt,
    count,
    [count + 1, count - 1, count + 2, 0, count + 3],
    { n: count, a: count },
    FORSKOLA_BOUNDS,
  );
  const words = Array.from({ length: count }, () => item.singular).join(' ');
  return voiced(q, `Hur många ${item.plural}? ${words}`);
}

function forskolaEfter(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const n = intBetween(rng, 0, 9);
  const q = numeric(
    rng,
    'forskola',
    'forskola-efter',
    index,
    idPrefix,
    `Vilket tal kommer efter ${n}?`,
    n + 1,
    [n, n + 2, n + 3, 0],
    { a: n, n },
    FORSKOLA_BOUNDS,
  );
  return voiced(q, `Vilket tal kommer efter ${svTal(n)}?`);
}

function ak1Plus(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const a = intBetween(rng, 0, 20);
  const b = intBetween(rng, 0, 20 - a);
  return numeric(rng, 'ak1', 'ak1-plus', index, idPrefix, `${a} + ${b} = ?`, a + b, [a + b + 1, a + b - 1, a + b + 2, a, b], { a, b });
}

function ak1Minus(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const a = intBetween(rng, 0, 20);
  const b = intBetween(rng, 0, a);
  const answer = a - b;
  return numeric(rng, 'ak1', 'ak1-minus', index, idPrefix, `${a} − ${b} = ?`, answer, [answer + 1, answer + 2, a, b], { a, b });
}

function ak1Tal(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const kind = rng.int([0, 2]);
  if (kind === 0) {
    const n = intBetween(rng, 0, 40);
    return numeric(rng, 'ak1', 'ak1-talfoljd', index, idPrefix, `Vilket tal kommer efter ${n}?`, n + 1, [n, n + 2, n + 3], { a: n });
  }
  if (kind === 1) {
    const n = intBetween(rng, 1, 40);
    return numeric(rng, 'ak1', 'ak1-talfoljd', index, idPrefix, `Vilket tal kommer före ${n}?`, n - 1, [n, n + 1, n + 2], { a: n });
  }
  const start = intBetween(rng, 0, 17);
  const answer = start + 3;
  return numeric(
    rng,
    'ak1',
    'ak1-talfoljd',
    index,
    idPrefix,
    `${start}, ${start + 1}, ${start + 2}, ?`,
    answer,
    [start + 2, start + 4, start, start + 1],
    { a: start },
  );
}

function ak1Jamfor(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const hi = intBetween(rng, 3, 20);
  const lo = intBetween(rng, 0, hi - 1);
  if (rng.chance(0.5)) {
    const wrong = intTexts(hi, [lo], { min: 0, max: hi - 1 });
    return textQ(rng, 'ak1', 'ak1-jamforelse', index, idPrefix, `Vilket tal är störst: ${lo} eller ${hi}?`, String(hi), wrong, {
      a: lo,
      b: hi,
    });
  }
  const wrong = intTexts(lo, [hi], { min: lo + 1 });
  return textQ(rng, 'ak1', 'ak1-jamforelse', index, idPrefix, `Vilket tal är minst: ${lo} eller ${hi}?`, String(lo), wrong, {
    a: lo,
    b: hi,
  });
}

function ak2Plus(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const a = intBetween(rng, 0, 100);
  const b = intBetween(rng, 0, 100 - a);
  const answer = a + b;
  return numeric(rng, 'ak2', 'ak2-plus', index, idPrefix, `${a} + ${b} = ?`, answer, [answer + 10, answer - 10, answer + 1, a, b], {
    a,
    b,
  });
}

function ak2Minus(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const a = intBetween(rng, 0, 100);
  const b = intBetween(rng, 0, a);
  const answer = a - b;
  return numeric(rng, 'ak2', 'ak2-minus', index, idPrefix, `${a} − ${b} = ?`, answer, [answer + 10, answer + 1, answer + 2, a, b], {
    a,
    b,
  });
}

function ak2Tio(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const n = intBetween(rng, 0, 10);
  const answer = 10 - n;
  return numeric(
    rng,
    'ak2',
    'ak2-tiokamrat',
    index,
    idPrefix,
    `Vilket tal är tiokamrat till ${n}? (tillsammans blir de 10)`,
    answer,
    DIGITS,
    { n, a: n, b: answer },
    { max: 10 },
  );
}

function ak2Tabell(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const table = rng.pick([2, 5, 10] as const);
  const b = intBetween(rng, 1, 10);
  const answer = table * b;
  return numeric(
    rng,
    'ak2',
    'ak2-tabell',
    index,
    idPrefix,
    `${table} × ${b} = ?`,
    answer,
    [table * (b + 1), table * Math.max(1, b - 1), table + b, answer + table],
    { a: table, b },
  );
}

function ak2Dubbelt(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const n = intBetween(rng, 1, 50);
  const answer = n * 2;
  return numeric(rng, 'ak2', 'ak2-dubbelt', index, idPrefix, `Vad är det dubbla av ${n}?`, answer, [n, n * 3, answer + 2, answer - 1], {
    a: n,
  });
}

function ak2Halften(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const n = intBetween(rng, 1, 50) * 2;
  const answer = n / 2;
  return numeric(rng, 'ak2', 'ak2-halften', index, idPrefix, `Vad är hälften av ${n}?`, answer, [n, answer + 1, answer + 2, answer * 2], {
    a: n,
  });
}

function ak2Klocka(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  if (rng.chance(0.5)) {
    const h = intBetween(rng, 1, 12);
    const next = h === 12 ? 1 : h + 1;
    const prev = h === 1 ? 12 : h - 1;
    const answer = `${h}:00`;
    return textQ(rng, 'ak2', 'ak2-klocka', index, idPrefix, `Klockan är hel. Timvisaren pekar på ${h}. Hur mycket är klockan?`, answer, [
      `${h}:30`,
      `${next}:00`,
      `${prev}:00`,
      `${h}:15`,
    ]);
  }
  // «Halv 4» är 3:30 på svenska, alltså en halvtimme före timmen som sägs.
  const h = intBetween(rng, 1, 12);
  const hour = h === 1 ? 12 : h - 1;
  const after = hour === 12 ? 1 : hour + 1;
  const answer = `${hour}:30`;
  return textQ(rng, 'ak2', 'ak2-klocka', index, idPrefix, `Klockan är halv ${h}. Hur mycket är klockan?`, answer, [
    `${h}:30`,
    `${hour}:00`,
    `${h}:00`,
    `${after}:30`,
  ]);
}

function timesQuestion(rng: Rng, grade: GradeId, rule: string, index: number, idPrefix: string, a: number, b: number): LearnQuestion {
  const answer = a * b;
  return numeric(
    rng,
    grade,
    rule,
    index,
    idPrefix,
    `${a} × ${b} = ?`,
    answer,
    [a * (b + 1), (a + 1) * b, a * Math.max(1, b - 1), Math.max(1, a - 1) * b, a + b],
    { a, b },
  );
}

function ak3Tabell(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  return timesQuestion(rng, 'ak3', 'ak3-tabell', index, idPrefix, intBetween(rng, 1, 10), intBetween(rng, 1, 10));
}

function ak3Tabell34(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  return timesQuestion(rng, 'ak3', 'ak3-tabell34', index, idPrefix, rng.pick([3, 4] as const), intBetween(rng, 1, 10));
}

function ak3Division(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const divisor = intBetween(rng, 1, 10);
  const quot = intBetween(rng, 1, 10);
  const dividend = divisor * quot;
  return numeric(
    rng,
    'ak3',
    'ak3-division',
    index,
    idPrefix,
    `${dividend} ÷ ${divisor} = ?`,
    quot,
    [quot + 1, quot + 2, divisor, dividend],
    { a: dividend, b: divisor },
  );
}

function ak3Plus(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const a = intBetween(rng, 0, 1000);
  const b = intBetween(rng, 0, 1000 - a);
  const answer = a + b;
  return numeric(rng, 'ak3', 'ak3-plus', index, idPrefix, `${a} + ${b} = ?`, answer, [answer + 10, answer - 10, answer + 1, a, b], {
    a,
    b,
  });
}

function ak3Minus(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const a = intBetween(rng, 0, 1000);
  const b = intBetween(rng, 0, a);
  const answer = a - b;
  return numeric(rng, 'ak3', 'ak3-minus', index, idPrefix, `${a} − ${b} = ?`, answer, [answer + 10, answer + 1, a, b], { a, b });
}

function ak3Kronor(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const kind = rng.int([0, 3]);
  if (kind === 0) {
    const a = intBetween(rng, 2, 80);
    const b = intBetween(rng, 2, 40);
    const answer = a + b;
    return numeric(
      rng,
      'ak3',
      'ak3-kronor',
      index,
      idPrefix,
      `Sam har ${a} kronor och får ${b} kronor till. Hur många kronor har Sam då?`,
      answer,
      [a, b, answer + 10, Math.abs(a - b)],
      { a, b },
    );
  }
  if (kind === 1) {
    const a = intBetween(rng, 2, 60);
    const b = intBetween(rng, 2, 40);
    const answer = a + b;
    return numeric(
      rng,
      'ak3',
      'ak3-kronor',
      index,
      idPrefix,
      `En bok kostar ${a} kronor och en penna kostar ${b} kronor. Hur många kronor kostar de tillsammans?`,
      answer,
      [a, b, answer + a, a * b > 400 ? answer + 5 : a * b],
      { a, b },
    );
  }
  if (kind === 2) {
    const b = intBetween(rng, 2, 40);
    const a = intBetween(rng, b + 1, b + 60);
    const answer = a - b;
    return numeric(
      rng,
      'ak3',
      'ak3-kronor',
      index,
      idPrefix,
      `Noor har ${a} kronor och köper en glass för ${b} kronor. Hur många kronor har Noor kvar?`,
      answer,
      [a, b, a + b, answer + b],
      { a, b },
    );
  }
  const b = intBetween(rng, 2, 50);
  const a = intBetween(rng, b + 1, b + 70);
  const answer = a - b;
  return numeric(
    rng,
    'ak3',
    'ak3-kronor',
    index,
    idPrefix,
    `Eli har ${a} kronor och köper en boll för ${b} kronor. Hur många kronor har Eli kvar?`,
    answer,
    [a, b, a + b, answer + 2],
    { a, b },
  );
}

function ak46Brak(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const row = rng.pick(FRACTIONS);
  return textQ(rng, 'ak4_6', 'ak46-brak', index, idPrefix, row.prompt, row.answer, row.wrong);
}

/**
 * Decimaler i normalform: heltal skrivs «1», tiondelar «0,7».
 * Fel som är samma tal (1 och 1,0, 0 och 0,0) tas bort via answerKey.
 * 0 + 0 undviks så att frågan inte blir «0,0 + 0,0».
 */
function decimalQuestion(rng: Rng, index: number, idPrefix: string, op: 'plus' | 'minus'): LearnQuestion {
  let a = intBetween(rng, 0, 9);
  let b = intBetween(rng, 0, 9);
  if (op === 'minus' && b > a) [a, b] = [b, a];
  if (a === 0 && b === 0) {
    if (op === 'plus') b = intBetween(rng, 1, 9);
    else a = intBetween(rng, 1, 9);
  }
  const sumT = op === 'plus' ? a + b : a - b;
  const answer = formatTenths(sumT);
  const left = formatTenths(a);
  const right = formatTenths(b);
  const prompt = op === 'plus' ? `${left} + ${right} = ?` : `${left} − ${right} = ?`;
  const extra = [
    formatTenths(sumT + 1),
    formatTenths(sumT + 2),
    formatTenths(sumT - 1),
    formatTenths(sumT + 10),
    left,
    right,
    String(a + b),
    String(Math.abs(a - b)),
    '2',
    '10',
  ];
  const wrong = distinctTexts(answer, extra);
  return textQ(rng, 'ak4_6', 'ak46-decimal', index, idPrefix, prompt, answer, wrong, { a, b, result: sumT / 10 });
}

function ak46Decimal(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  return decimalQuestion(rng, index, idPrefix, rng.chance(0.5) ? 'plus' : 'minus');
}

function percentValue(base: number, pct: number): number | null {
  const num = base * pct;
  if (num % 100 !== 0) return null;
  return num / 100;
}

function ak46Procent(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const bases = [10, 20, 40, 50, 60, 80, 100, 200];
  const pcts = [10, 20, 25, 50];
  let base = rng.pick(bases);
  let pct = rng.pick(pcts);
  let answer = percentValue(base, pct);
  for (let guard = 0; guard < 12 && answer === null; guard++) {
    base = rng.pick(bases);
    pct = rng.pick(pcts);
    answer = percentValue(base, pct);
  }
  if (answer === null) {
    base = 40;
    pct = 25;
    answer = 10;
  }
  return numeric(
    rng,
    'ak4_6',
    'ak46-procent',
    index,
    idPrefix,
    `Vad är ${pct} % av ${base}?`,
    answer,
    [base, pct, answer + pct, Math.max(0, base - answer), answer + 1],
    { a: pct, b: base },
    { min: 0 },
  );
}

function ak46Avrunda(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const whole = intBetween(rng, 0, 40);
  const tenth = rng.pick([1, 2, 3, 4, 6, 7, 8, 9] as const);
  const valueT = whole * 10 + tenth;
  const rounded = tenth >= 5 ? whole + 1 : whole;
  const other = tenth >= 5 ? whole : whole + 1;
  return numeric(
    rng,
    'ak4_6',
    'ak46-avrundning',
    index,
    idPrefix,
    `Avrunda ${formatTenths(valueT)} till närmaste heltal.`,
    rounded,
    [other, valueT, rounded + 1, rounded - 1, tenth],
    { a: whole, b: tenth },
    { min: 0 },
  );
}

function rectangleSides(rng: Rng): [number, number] {
  for (let i = 0; i < 20; i++) {
    const length = intBetween(rng, 2, 12);
    const width = intBetween(rng, 2, 12);
    if (2 * (length + width) !== length * width) return [length, width];
  }
  return [5, 3];
}

function ak46Rektangel(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const [length, width] = rectangleSides(rng);
  const peri = 2 * (length + width);
  const area = length * width;
  if (rng.chance(0.5)) {
    return numeric(
      rng,
      'ak4_6',
      'ak46-rektangel',
      index,
      idPrefix,
      `En rektangel är ${length} cm lång och ${width} cm bred. Hur många centimeter är omkretsen?`,
      peri,
      [area, length + width, length * 2, peri + 2, width * 2],
      { a: length, b: width },
      { min: 0 },
    );
  }
  return numeric(
    rng,
    'ak4_6',
    'ak46-rektangel',
    index,
    idPrefix,
    `En rektangel är ${length} cm lång och ${width} cm bred. Hur många kvadratcentimeter är arean?`,
    area,
    [peri, length + width, length * 2, area + length, width],
    { a: length, b: width },
    { min: 0 },
  );
}

function ak79Negativ(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  let a = intBetween(rng, -9, 9);
  const b = intBetween(rng, -9, 9);
  if (a >= 0 && b >= 0) a = -intBetween(rng, 1, 9);
  const sub = rng.chance(0.5);
  const answer = sub ? a - b : a + b;
  const prompt = sub ? `${a} − ${b} = ?` : `${a} + ${b} = ?`;
  return numeric(rng, 'ak7_9', 'ak79-negativ', index, idPrefix, prompt, answer, [answer + 1, answer - 1, a, b, -answer], { a, b });
}

function ak79Ekvation(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const x = intBetween(rng, -8, 12);
  let a = intBetween(rng, -9, 9);
  if (a === 0) a = 4;
  const b = x + a;
  const prompt = a > 0 ? `x + ${a} = ${b}. Vad är x?` : `x − ${-a} = ${b}. Vad är x?`;
  return numeric(rng, 'ak7_9', 'ak79-ekvation', index, idPrefix, prompt, x, [a, b, x + 1, x - 1, -x], { a, b, result: x });
}

function ak79Potens(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const row = rng.pick(POWERS);
  const base = row[0];
  const exp = row[1];
  const value = row[2];
  return numeric(
    rng,
    'ak7_9',
    'ak79-potens',
    index,
    idPrefix,
    `${base}${sup(exp)} = ?`,
    value,
    [base * exp, base + exp, value + base, value - base, base ** Math.max(1, exp - 1)],
    { a: base, b: exp },
  );
}

function ak79Prioritet(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const kind = rng.int([0, 3]);
  if (kind === 0) {
    const a = intBetween(rng, 1, 12);
    const b = intBetween(rng, 2, 9);
    const c = intBetween(rng, 2, 9);
    const answer = a + b * c;
    const trap = (a + b) * c;
    if (trap === answer) throw new Error('prioritet blev tvetydig');
    return numeric(rng, 'ak7_9', 'ak79-prioritet', index, idPrefix, `${a} + ${b} × ${c} = ?`, answer, [trap, a + b + c, b * c, a * b], {
      a,
      b,
      n: c,
    });
  }
  if (kind === 1) {
    const a = intBetween(rng, 2, 9);
    const b = intBetween(rng, 2, 9);
    const c = intBetween(rng, 1, 12);
    const answer = a * b + c;
    const trap = a * (b + c);
    if (trap === answer) throw new Error('prioritet blev tvetydig');
    return numeric(rng, 'ak7_9', 'ak79-prioritet', index, idPrefix, `${a} × ${b} + ${c} = ?`, answer, [trap, a + b + c, a * b, b + c], {
      a,
      b,
      n: c,
    });
  }
  if (kind === 2) {
    const a = intBetween(rng, 1, 9);
    const b = intBetween(rng, 1, 9);
    const c = intBetween(rng, 2, 9);
    const answer = (a + b) * c;
    const trap = a + b * c;
    if (trap === answer) throw new Error('parentes blev tvetydig');
    return numeric(
      rng,
      'ak7_9',
      'ak79-prioritet',
      index,
      idPrefix,
      `(${a} + ${b}) × ${c} = ?`,
      answer,
      [trap, a + b + c, a * b * c, a + b],
      {
        a,
        b,
        n: c,
      },
    );
  }
  const a = intBetween(rng, 2, 9);
  const b = intBetween(rng, 1, 9);
  const c = intBetween(rng, 1, 9);
  const answer = a * (b + c);
  const trap = a * b + c;
  if (trap === answer) throw new Error('parentes blev tvetydig');
  return numeric(rng, 'ak7_9', 'ak79-prioritet', index, idPrefix, `${a} × (${b} + ${c}) = ?`, answer, [trap, a * b * c, a + b + c, b + c], {
    a,
    b,
    n: c,
  });
}

function ak79Procent(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const bases = [20, 40, 60, 80, 100, 120, 200, 300, 400];
  const pcts = [5, 10, 15, 20, 25, 50];
  const base = rng.pick(bases);
  const pct = rng.pick(pcts);
  const answer = percentValue(base, pct);
  if (answer === null) throw new Error(`procent blev inte heltal: ${pct} % av ${base}`);
  return numeric(
    rng,
    'ak7_9',
    'ak79-procent',
    index,
    idPrefix,
    `Vad är ${pct} % av ${base}?`,
    answer,
    [base, pct, answer + pct, Math.max(0, base - answer), answer + base / 10],
    { a: pct, b: base },
    { min: 0 },
  );
}

function ak79Rot(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const n = intBetween(rng, 1, 15);
  const sq = n * n;
  return numeric(
    rng,
    'ak7_9',
    'ak79-rot',
    index,
    idPrefix,
    `Vad är kvadratroten ur ${sq}?`,
    n,
    [n + 1, n - 1, sq, n * 2, n + 2],
    { a: n, b: sq },
    { min: 0 },
  );
}

function quadAnswer(p: number, q: number): string {
  const [r1, r2] = p <= q ? [p, q] : [q, p];
  return `x = ${r1} eller x = ${r2}`;
}

function signedTerm(n: number, suffix: string): string {
  if (n === 0) return '';
  const abs = Math.abs(n);
  const body = suffix ? (abs === 1 ? suffix : `${abs}${suffix}`) : String(abs);
  return n < 0 ? `− ${body}` : `+ ${body}`;
}

function quadPrompt(p: number, q: number): string {
  const bTerm = signedTerm(-(p + q), 'x');
  const cTerm = signedTerm(p * q, '');
  return `Vilka lösningar har x² ${bTerm} ${cTerm} = 0?`.replace(/\s+/g, ' ').trim();
}

function quadWrongs(p: number, q: number): string[] {
  const answer = quadAnswer(p, q);
  const seen = new Set<string>([answerKey(answer)]);
  const out: string[] = [];
  const push = (a: number, b: number): void => {
    if (out.length >= 6) return;
    const text = quadAnswer(a, b);
    const key = answerKey(text);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text);
  };
  push(p + 1, q);
  push(p, q + 1);
  push(p - 1, q);
  push(p, q - 1);
  push(-p, -q);
  push(p + 1, q + 1);
  push(p + q, p * q);
  push(p + 2, q);
  push(p, q + 2);
  push(p + 1, q - 1);
  if (out.length < 3) throw new Error(`för få andragradsfel för ${answer}`);
  return out;
}

function gymAndragrad(rng: Rng, grade: GradeId, index: number, idPrefix: string): LearnQuestion {
  const pair = rng.pick(QUAD_ROOTS);
  const p = pair[0];
  const q = pair[1];
  const answer = quadAnswer(p, q);
  return textQ(rng, grade, 'gym-andragrads', index, idPrefix, quadPrompt(p, q), answer, quadWrongs(p, q), {
    r1: Math.min(p, q),
    r2: Math.max(p, q),
  });
}

function gymProcent(rng: Rng, grade: GradeId, index: number, idPrefix: string): LearnQuestion {
  const prices = [40, 80, 100, 120, 200, 400];
  const pcts = [10, 20, 25, 50];
  const price = rng.pick(prices);
  const pct = rng.pick(pcts);
  const delta = percentValue(price, pct);
  if (delta === null) throw new Error(`procent blev inte heltal: ${pct} % av ${price}`);
  const up = rng.chance(0.5);
  if (rng.chance(0.5)) {
    const answer = up ? price + delta : price - delta;
    const prompt = up
      ? `En sak kostar ${price} kr och blir ${pct} % dyrare. Vad kostar den då?`
      : `En sak kostar ${price} kr och blir ${pct} % billigare. Vad kostar den då?`;
    return numeric(
      rng,
      grade,
      'gym-procent',
      index,
      idPrefix,
      prompt,
      answer,
      [price, price + pct, price - pct, answer + delta, delta],
      {
        a: price,
        b: pct,
      },
      { min: 0 },
    );
  }
  const next = up ? price + delta : price - delta;
  const verb = up ? 'ökat' : 'minskat';
  const prompt = `En sak kostar ${price} kr och kostar sedan ${next} kr. Med hur många procent har priset ${verb}?`;
  return numeric(
    rng,
    grade,
    'gym-procent',
    index,
    idPrefix,
    prompt,
    pct,
    [pct + 10, pct - 10, delta, 100 - pct, pct * 2],
    { a: price, b: next },
    { min: 0 },
  );
}

function gymHuvud(rng: Rng, grade: GradeId, index: number, idPrefix: string): LearnQuestion {
  if (rng.chance(0.4)) {
    const n = rng.pick([12, 13, 14, 15, 16, 20, 25]);
    return numeric(
      rng,
      grade,
      'gym-huvudrakning',
      index,
      idPrefix,
      `${n}² = ?`,
      n * n,
      [n * (n + 1), n * 2, n * n + n, n * n - n],
      {
        a: n,
        b: 2,
      },
      { min: 0 },
    );
  }
  const a = intBetween(rng, 12, 30);
  const b = intBetween(rng, 6, 15);
  return numeric(
    rng,
    grade,
    'gym-huvudrakning',
    index,
    idPrefix,
    `${a} × ${b} = ?`,
    a * b,
    [a * (b + 1), (a + 1) * b, a * b + 10, a + b],
    {
      a,
      b,
    },
    { min: 0 },
  );
}

function gymEkvation(rng: Rng, grade: GradeId, index: number, idPrefix: string): LearnQuestion {
  const a = intBetween(rng, 2, 9);
  const x = intBetween(rng, -8, 12);
  const kind = rng.int([0, 2]);
  if (kind === 0) {
    const b = intBetween(rng, 1, 12);
    const c = a * x + b;
    return numeric(rng, grade, 'gym-ekvation', index, idPrefix, `${a}x + ${b} = ${c}. Vad är x?`, x, [x + 1, x - 1, b, c, a], {
      a,
      b,
      n: c,
    });
  }
  if (kind === 1) {
    const b = intBetween(rng, 1, 12);
    const c = a * x - b;
    return numeric(rng, grade, 'gym-ekvation', index, idPrefix, `${a}x − ${b} = ${c}. Vad är x?`, x, [x + 1, x - 1, b, c, -x], {
      a,
      b: -b,
      n: c,
    });
  }
  const c = a * x;
  return numeric(rng, grade, 'gym-ekvation', index, idPrefix, `${a}x = ${c}. Vad är x?`, x, [x + 1, x - 1, a, c, x + a], { a, b: 0, n: c });
}

function byRule(rng: Rng, grade: GradeId, rule: string, index: number, idPrefix: string): LearnQuestion {
  switch (rule) {
    case 'forskola-plus':
      return forskolaPlus(rng, index, idPrefix);
    case 'forskola-minus':
      return forskolaMinus(rng, index, idPrefix);
    case 'forskola-rakna':
      return forskolaRakna(rng, index, idPrefix);
    case 'forskola-efter':
      return forskolaEfter(rng, index, idPrefix);
    case 'ak1-plus':
      return ak1Plus(rng, index, idPrefix);
    case 'ak1-minus':
      return ak1Minus(rng, index, idPrefix);
    case 'ak1-talfoljd':
      return ak1Tal(rng, index, idPrefix);
    case 'ak1-jamforelse':
      return ak1Jamfor(rng, index, idPrefix);
    case 'ak2-plus':
      return ak2Plus(rng, index, idPrefix);
    case 'ak2-minus':
      return ak2Minus(rng, index, idPrefix);
    case 'ak2-tiokamrat':
      return ak2Tio(rng, index, idPrefix);
    case 'ak2-tabell':
      return ak2Tabell(rng, index, idPrefix);
    case 'ak2-dubbelt':
      return ak2Dubbelt(rng, index, idPrefix);
    case 'ak2-halften':
      return ak2Halften(rng, index, idPrefix);
    case 'ak2-klocka':
      return ak2Klocka(rng, index, idPrefix);
    case 'ak3-tabell':
      return ak3Tabell(rng, index, idPrefix);
    case 'ak3-tabell34':
      return ak3Tabell34(rng, index, idPrefix);
    case 'ak3-division':
      return ak3Division(rng, index, idPrefix);
    case 'ak3-plus':
      return ak3Plus(rng, index, idPrefix);
    case 'ak3-minus':
      return ak3Minus(rng, index, idPrefix);
    case 'ak3-kronor':
      return ak3Kronor(rng, index, idPrefix);
    case 'ak46-brak':
      return ak46Brak(rng, index, idPrefix);
    case 'ak46-decimal':
      return ak46Decimal(rng, index, idPrefix);
    case 'ak46-procent':
      return ak46Procent(rng, index, idPrefix);
    case 'ak46-avrundning':
      return ak46Avrunda(rng, index, idPrefix);
    case 'ak46-rektangel':
      return ak46Rektangel(rng, index, idPrefix);
    case 'ak79-negativ':
      return ak79Negativ(rng, index, idPrefix);
    case 'ak79-ekvation':
      return ak79Ekvation(rng, index, idPrefix);
    case 'ak79-potens':
      return ak79Potens(rng, index, idPrefix);
    case 'ak79-prioritet':
      return ak79Prioritet(rng, index, idPrefix);
    case 'ak79-procent':
      return ak79Procent(rng, index, idPrefix);
    case 'ak79-rot':
      return ak79Rot(rng, index, idPrefix);
    case 'gym-andragrads':
      return gymAndragrad(rng, grade, index, idPrefix);
    case 'gym-procent':
      return gymProcent(rng, grade, index, idPrefix);
    case 'gym-huvudrakning':
      return gymHuvud(rng, grade, index, idPrefix);
    case 'gym-ekvation':
      return gymEkvation(rng, grade, index, idPrefix);
    default:
      throw new Error(`okänd matte-regel ${rule}`);
  }
}

/** En mattefråga för nivån. Deterministisk givet rng-läget. */
export function nextMathQuestion(rng: Rng, grade: GradeId, index: number, idPrefix: string): LearnQuestion {
  const rule = rng.pick(MATH_RULES[grade]);
  return byRule(rng, grade, rule, index, idPrefix);
}
