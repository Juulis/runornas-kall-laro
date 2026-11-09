import type { Rng } from '../core/Rng';
import { multipleChoice, numberChoices } from './choices';
import { isHardMathRule } from './hardQuestion';
import type { GradeId, LearnQuestion, QuestionMeta } from './types';

/** Vilka matte-regler som hör till varje nivå. Gymnasiet och vuxen delar spår. */
export const MATH_RULES: Record<GradeId, readonly string[]> = {
  forskola: ['forskola-plus', 'forskola-minus'],
  ak1: ['ak1-plus', 'ak1-minus'],
  ak2: ['ak2-plus', 'ak2-minus', 'ak2-tiokamrat', 'ak2-tabell'],
  ak3: ['ak3-tabell', 'ak3-division', 'ak3-plus', 'ak3-minus'],
  ak4_6: ['ak46-brak', 'ak46-decimal', 'ak46-procent'],
  ak7_9: ['ak79-negativ', 'ak79-ekvation', 'ak79-potens'],
  gymnasiet: ['gym-andragrads', 'gym-procent', 'gym-huvudrakning'],
  vuxen: ['gym-andragrads', 'gym-procent', 'gym-huvudrakning'],
};

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const TAL = ['noll', 'ett', 'två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio'] as const;

function svTal(n: number): string {
  return TAL[n] ?? String(n);
}

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

const FRACTIONS: readonly { prompt: string; answer: string; wrong: readonly string[] }[] = [
  { prompt: 'Vad är 1/2 av 8?', answer: '4', wrong: ['2', '6', '8'] },
  { prompt: 'Vad är 1/2 av 10?', answer: '5', wrong: ['2', '8', '10'] },
  { prompt: 'Vad är 1/4 av 12?', answer: '3', wrong: ['4', '6', '2'] },
  { prompt: 'Vad är 1/4 av 20?', answer: '5', wrong: ['4', '10', '2'] },
  { prompt: 'Vad är 3/4 av 8?', answer: '6', wrong: ['3', '4', '2'] },
  { prompt: 'Hur många fjärdedelar är en halv?', answer: '2', wrong: ['1', '3', '4'] },
  { prompt: 'Vilket bråk är störst?', answer: '3/4', wrong: ['1/4', '1/8', '1/5'] },
  { prompt: 'Vilket bråk är minst?', answer: '1/8', wrong: ['1/2', '1/3', '3/4'] },
  { prompt: '1/5 av 10 är …', answer: '2', wrong: ['5', '1', '10'] },
  { prompt: '2/3 av 9 är …', answer: '6', wrong: ['3', '2', '9'] },
  { prompt: 'Vilket bråk betyder en halv?', answer: '1/2', wrong: ['1/3', '1/4', '2/3'] },
  { prompt: 'Hur många halvor är en hel?', answer: '2', wrong: ['1', '3', '4'] },
];

function sup(n: number): string {
  return String(n).replace(/\d/g, (d) => SUP[Number(d)] ?? d);
}

function intBetween(rng: Rng, min: number, max: number): number {
  return rng.int([min, max]);
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
): LearnQuestion {
  const mc = numberChoices(rng, answer, preferred);
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
  return pack(grade, rule, index, idPrefix, prompt, answer, mc.choices, mc.correctIndex, meta);
}

/** Bara plus och minus. Enkelsiffror, svaret blir aldrig negativt, och plus stannar på högst 10. */
function forskola(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  if (rng.chance(0.5)) {
    const a = intBetween(rng, 0, 9);
    const b = intBetween(rng, 0, Math.min(9, 10 - a));
    const q = numeric(rng, 'forskola', 'forskola-plus', index, idPrefix, `${a} + ${b} = ?`, a + b, digits, { a, b });
    return { ...q, speakText: `${svTal(a)} plus ${svTal(b)}`, speakLang: 'sv-SE' };
  }
  const a = intBetween(rng, 0, 9);
  const b = intBetween(rng, 0, a);
  const q = numeric(rng, 'forskola', 'forskola-minus', index, idPrefix, `${a} − ${b} = ?`, a - b, digits.slice(0, 10), { a, b });
  return { ...q, speakText: `${svTal(a)} minus ${svTal(b)}`, speakLang: 'sv-SE' };
}

function ak1(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  if (rng.chance(0.5)) {
    const a = intBetween(rng, 0, 20);
    const b = intBetween(rng, 0, 20 - a);
    return numeric(rng, 'ak1', 'ak1-plus', index, idPrefix, `${a} + ${b} = ?`, a + b, [a + b + 1, a + b - 1, a, b], { a, b });
  }
  const a = intBetween(rng, 0, 20);
  const b = intBetween(rng, 0, a);
  return numeric(rng, 'ak1', 'ak1-minus', index, idPrefix, `${a} − ${b} = ?`, a - b, [a - b + 1, a - b - 1, a, b], { a, b });
}

function ak2(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const roll = rng.next();
  if (roll < 0.25) {
    const a = intBetween(rng, 0, 100);
    const b = intBetween(rng, 0, 100 - a);
    return numeric(rng, 'ak2', 'ak2-plus', index, idPrefix, `${a} + ${b} = ?`, a + b, [a + b + 10, a + b - 10, a, b], { a, b });
  }
  if (roll < 0.5) {
    const a = intBetween(rng, 0, 100);
    const b = intBetween(rng, 0, a);
    return numeric(rng, 'ak2', 'ak2-minus', index, idPrefix, `${a} − ${b} = ?`, a - b, [a - b + 10, Math.abs(b - a), a, b], { a, b });
  }
  if (roll < 0.75) {
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
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      {
        n,
        a: n,
        b: answer,
      },
    );
  }
  const table = rng.pick([2, 5, 10] as const);
  const b = intBetween(rng, 1, 10);
  return numeric(
    rng,
    'ak2',
    'ak2-tabell',
    index,
    idPrefix,
    `${table} × ${b} = ?`,
    table * b,
    [table * (b + 1), table * Math.max(0, b - 1), table + b, b],
    {
      a: table,
      b,
    },
  );
}

function ak3(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const roll = rng.next();
  if (roll < 0.35) {
    const a = intBetween(rng, 1, 10);
    const b = intBetween(rng, 1, 10);
    return numeric(rng, 'ak3', 'ak3-tabell', index, idPrefix, `${a} × ${b} = ?`, a * b, [a * (b + 1), (a + 1) * b, a + b, a * b + a], {
      a,
      b,
    });
  }
  if (roll < 0.6) {
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
      [quot + 1, Math.max(0, quot - 1), divisor, dividend],
      {
        a: dividend,
        b: divisor,
      },
    );
  }
  if (roll < 0.8) {
    const a = intBetween(rng, 0, 1000);
    const b = intBetween(rng, 0, 1000 - a);
    return numeric(rng, 'ak3', 'ak3-plus', index, idPrefix, `${a} + ${b} = ?`, a + b, [a + b + 10, a + b - 10, a, b], { a, b });
  }
  const a = intBetween(rng, 0, 1000);
  const b = intBetween(rng, 0, a);
  return numeric(rng, 'ak3', 'ak3-minus', index, idPrefix, `${a} − ${b} = ?`, a - b, [a - b + 10, b > a ? b - a : a - b + 1, a, b], {
    a,
    b,
  });
}

function decimalText(tenthsA: number, tenthsB: number): { prompt: string; answer: string; wrong: string[] } {
  const sum = tenthsA + tenthsB;
  const answer = sum < 10 ? `0,${sum}` : sum === 10 ? '1' : `1,${sum - 10}`;
  const prompt = `0,${tenthsA} + 0,${tenthsB} = ?`;
  const wrong = [
    sum < 10 ? `0,${(sum + 1) % 10}` : `0,${String(sum).slice(-1)}`,
    `0,${tenthsA}`,
    `0,${tenthsB}`,
    String(sum),
    '1,0',
    '0,5',
    '1,5',
    '2',
    '0,8',
  ].filter((w) => w !== answer);
  return { prompt, answer, wrong };
}

function ak46(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const roll = rng.next();
  if (roll < 0.34) {
    const row = rng.pick(FRACTIONS);
    return textQ(rng, 'ak4_6', 'ak46-brak', index, idPrefix, row.prompt, row.answer, row.wrong);
  }
  if (roll < 0.67) {
    const a = intBetween(rng, 0, 9);
    const b = intBetween(rng, 0, 9);
    const row = decimalText(a, b);
    return textQ(rng, 'ak4_6', 'ak46-decimal', index, idPrefix, row.prompt, row.answer, row.wrong, { a, b });
  }
  const bases = [10, 20, 40, 50, 60, 80, 100, 200];
  const pcts = [10, 20, 25, 50];
  let base = rng.pick(bases);
  let pct = rng.pick(pcts);
  let answer = (base * pct) / 100;
  for (let guard = 0; guard < 12 && !Number.isInteger(answer); guard++) {
    base = rng.pick(bases);
    pct = rng.pick(pcts);
    answer = (base * pct) / 100;
  }
  if (!Number.isInteger(answer)) {
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
    [base, pct, answer + pct, Math.max(0, base - answer)],
    {
      a: pct,
      b: base,
    },
  );
}

function ak79(rng: Rng, index: number, idPrefix: string): LearnQuestion {
  const roll = rng.next();
  if (roll < 0.34) {
    let a = intBetween(rng, -9, 9);
    const b = intBetween(rng, -9, 9);
    if (a >= 0 && b >= 0) a = -intBetween(rng, 1, 9);
    const sub = rng.chance(0.5);
    const answer = sub ? a - b : a + b;
    const prompt = sub ? `${a} − ${b} = ?` : `${a} + ${b} = ?`;
    return numeric(rng, 'ak7_9', 'ak79-negativ', index, idPrefix, prompt, answer, [answer + 1, answer - 1, a, b, -answer], { a, b });
  }
  if (roll < 0.67) {
    const x = intBetween(rng, -8, 12);
    let a = intBetween(rng, -9, 9);
    if (a === 0) a = 4;
    const b = x + a;
    const prompt = a > 0 ? `x + ${a} = ${b}. Vad är x?` : `x − ${-a} = ${b}. Vad är x?`;
    return numeric(rng, 'ak7_9', 'ak79-ekvation', index, idPrefix, prompt, x, [a, b, x + 1, x - 1, -x], { a, b, result: x });
  }
  const [base, exp, value] = rng.pick(POWERS);
  return numeric(
    rng,
    'ak7_9',
    'ak79-potens',
    index,
    idPrefix,
    `${base}${sup(exp)} = ?`,
    value,
    [base * exp, base + exp, value + base, value - base, base ** Math.max(1, exp - 1)],
    {
      a: base,
      b: exp,
    },
  );
}

function quadAnswer(p: number, q: number): string {
  const [r1, r2] = p <= q ? [p, q] : [q, p];
  return `x = ${r1} eller x = ${r2}`;
}

function signedTerm(n: number, suffix: string): string {
  if (n === 0) return '';
  const body = suffix ? `${Math.abs(n)}${suffix}` : String(Math.abs(n));
  return n < 0 ? `− ${body}` : `+ ${body}`;
}

function gym(rng: Rng, grade: GradeId, index: number, idPrefix: string): LearnQuestion {
  const roll = rng.next();
  if (roll < 0.34) {
    const roots: readonly [number, number][] = [
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
    ];
    const [p, q] = rng.pick(roots);
    const sum = p + q;
    const prod = p * q;
    const bTerm = signedTerm(-sum, 'x');
    const cTerm = signedTerm(prod, '');
    const prompt = `Vilka lösningar har x² ${bTerm} ${cTerm} = 0?`.replace(/\s+/g, ' ');
    const answer = quadAnswer(p, q);
    const wrong = [quadAnswer(p + 1, q), quadAnswer(p, q + 1), quadAnswer(-p, -q), quadAnswer(p - 1, q), quadAnswer(sum, prod)];
    return textQ(rng, grade, 'gym-andragrads', index, idPrefix, prompt, answer, wrong, { r1: Math.min(p, q), r2: Math.max(p, q) });
  }
  if (roll < 0.67) {
    const prices = [40, 50, 80, 100, 120, 200, 400];
    const pcts = [10, 20, 25, 50];
    let price = rng.pick(prices);
    let pct = rng.pick(pcts);
    const up = rng.chance(0.5);
    let answer = up ? price * (1 + pct / 100) : price * (1 - pct / 100);
    for (let guard = 0; guard < 10 && !Number.isInteger(answer); guard++) {
      price = rng.pick(prices);
      pct = rng.pick(pcts);
      answer = up ? price * (1 + pct / 100) : price * (1 - pct / 100);
    }
    if (!Number.isInteger(answer)) {
      price = 200;
      pct = 10;
      answer = up ? 220 : 180;
    }
    const prompt = up
      ? `En sak kostar ${price} kr och blir ${pct} % dyrare. Vad kostar den då?`
      : `En sak kostar ${price} kr och blir ${pct} % billigare. Vad kostar den då?`;
    return numeric(rng, grade, 'gym-procent', index, idPrefix, prompt, answer, [price, price + pct, price - pct, answer + price / 10], {
      a: price,
      b: pct,
    });
  }
  if (rng.chance(0.4)) {
    const n = rng.pick([12, 13, 14, 15, 16, 20, 25]);
    return numeric(rng, grade, 'gym-huvudrakning', index, idPrefix, `${n}² = ?`, n * n, [n * (n + 1), n * 2, n * n + n, n * n - n], {
      a: n,
      b: 2,
    });
  }
  const a = intBetween(rng, 12, 30);
  const b = intBetween(rng, 6, 15);
  return numeric(rng, grade, 'gym-huvudrakning', index, idPrefix, `${a} × ${b} = ?`, a * b, [a * (b + 1), (a + 1) * b, a * b + 10, a + b], {
    a,
    b,
  });
}

/** En mattefråga för nivån. Deterministisk givet rng-läget. */
export function nextMathQuestion(rng: Rng, grade: GradeId, index: number, idPrefix: string): LearnQuestion {
  switch (grade) {
    case 'forskola':
      return forskola(rng, index, idPrefix);
    case 'ak1':
      return ak1(rng, index, idPrefix);
    case 'ak2':
      return ak2(rng, index, idPrefix);
    case 'ak3':
      return ak3(rng, index, idPrefix);
    case 'ak4_6':
      return ak46(rng, index, idPrefix);
    case 'ak7_9':
      return ak79(rng, index, idPrefix);
    case 'gymnasiet':
    case 'vuxen':
      return gym(rng, grade, index, idPrefix);
    default: {
      const never: never = grade;
      return never;
    }
  }
}
