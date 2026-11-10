/**
 * Nyckel för ett svarsalternativ. Likvärdiga skrivsätt får samma nyckel
 * så att flerval inte kan visa både «1» och «1,0», «1/2» och «2/4»,
 * «−0» och «0», eller samma andragradsrötter i olika ordning.
 */

const EDGE_PUNCT = /[.,!?;:"'«»]/;
const PUNCT = /[.,!?;:"'«»]/g;

/**
 * Emoji längst fram, till exempel «🐶 hund» → «hund» och «8️⃣ åtta» → «åtta».
 * Siffror i ring (keycap) är siffra + valfri variant + U+20E3, inte Extended_Pictographic.
 */
const EMOJI_CLUSTER =
  /(?:(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:\uFE0F|\u200D(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}))*|[0-9#*]\uFE0F?\u20E3)/u;
const LEADING_EMOJI = new RegExp(`^(?:${EMOJI_CLUSTER.source})+\\s+`, 'u');

function prepare(text: string): string {
  let s = text.normalize('NFC').trim().replace(LEADING_EMOJI, '');
  s = s.replace(/[−–]/g, '-');
  s = s.toLocaleLowerCase('sv-SE').trim();
  s = s.replace(new RegExp(`^${EDGE_PUNCT.source}+`), '').replace(new RegExp(`${EDGE_PUNCT.source}+$`), '');
  return s.replace(/\s+/g, ' ').trim();
}

/** Avrundat tal så att 1/2, 2/4 och 0,5 delar nyckel utan binärt brus. */
function canon(n: number): string {
  if (!Number.isFinite(n) || Object.is(n, -0) || n === 0) return '0';
  const rounded = Math.round(n * 1e9) / 1e9;
  if (rounded === 0) return '0';
  return String(rounded);
}

function parseNumeric(prepared: string): number | null {
  const compact = prepared.replace(/\s+/g, '').replace(/procent$/, '%');
  const frac = compact.match(/^(-?\d+)\/(-?\d+)$/);
  if (frac?.[1] && frac[2]) {
    const den = Number(frac[2]);
    if (den === 0) return null;
    return Number(frac[1]) / den;
  }
  const pct = compact.match(/^(-?\d+(?:[.,]\d+)?)%$/);
  if (pct?.[1]) return Number(pct[1].replace(',', '.')) / 100;
  const plain = compact.match(/^(-?\d+(?:[.,]\d+)?)$/);
  if (plain?.[1]) return Number(plain[1].replace(',', '.'));
  return null;
}

/** «x = 2 eller x = 1» och «x = 1 eller x = 2» blir samma nyckel. */
function parseRoots(prepared: string): string | null {
  const matches = [...prepared.matchAll(/x\s*=\s*(-?\d+(?:[.,]\d+)?)/g)];
  if (matches.length < 2) return null;
  const rest = prepared
    .replace(/x\s*=\s*-?\d+(?:[.,]\d+)?/g, ' ')
    .replace(/\b(eller|och)\b/g, ' ')
    .replace(/[, ]+/g, '');
  if (rest.length > 0) return null;
  const nums = matches.map((m) => canon(Number((m[1] ?? '').replace(',', '.'))));
  nums.sort((a, b) => Number(a) - Number(b));
  return nums.join('|');
}

/** Normaliserad nyckel. Tom text blir «t:». */
export function answerKey(text: string): string {
  const prepared = prepare(text);
  const numeric = parseNumeric(prepared);
  if (numeric !== null) return `n:${canon(numeric)}`;
  const roots = parseRoots(prepared);
  if (roots !== null) return `r:${roots}`;
  return `t:${prepared.replace(PUNCT, '').replace(/\s+/g, ' ').trim()}`;
}

/**
 * Talvärde om hela alternativet är ett tal, bråk eller procent.
 * «7:00» och «x = 1 eller x = 2» är inte ett enda tal.
 */
export function answerNumber(text: string): number | null {
  const numeric = parseNumeric(prepare(text));
  if (numeric === null || !Number.isFinite(numeric)) return null;
  return Number(canon(numeric));
}
