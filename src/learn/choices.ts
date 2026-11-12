import type { Rng } from '../core/Rng';
import { answerKey } from './equivalence';

/** Blandar ett rätt svar med tre fel som inte är likvärdiga med svaret eller varandra. */
export function multipleChoice(
  rng: Rng,
  answer: string,
  wrongs: readonly string[],
): { choices: [string, string, string, string]; correctIndex: number } {
  const seen = new Set<string>([answerKey(answer)]);
  const uniq: string[] = [];
  for (const wrong of wrongs) {
    if (!wrong.trim()) continue;
    const key = answerKey(wrong);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(wrong);
  }
  if (uniq.length < 3) throw new Error(`för få felalternativ för «${answer}»`);
  const picked = rng.shuffle(uniq).slice(0, 3);
  const choices = rng.shuffle([answer, ...picked]) as [string, string, string, string];
  if (choices.length !== 4) throw new Error('flerval blev inte fyra alternativ');
  if (new Set(choices.map((choice) => answerKey(choice))).size !== 4) {
    throw new Error(`likvärdiga alternativ för «${answer}»`);
  }
  const correctIndex = choices.indexOf(answer);
  if (correctIndex < 0) throw new Error('rätt svar saknas bland alternativen');
  return { choices, correctIndex };
}

export interface NumberChoiceBounds {
  /** Minsta tillåtna felalternativ, till exempel 0 i förskolan. */
  min?: number;
  /** Största tillåtna felalternativ. */
  max?: number;
}

/**
 * Heltalsalternativ runt det rätta svaret.
 * Jämför numeriskt, så «1» och «1,0» inte kan bli två val, och håller sig inom gränserna.
 */
export function numberChoices(
  rng: Rng,
  answer: number,
  preferred: readonly number[] = [],
  bounds?: NumberChoiceBounds,
): { choices: [string, string, string, string]; correctIndex: number; answerText: string } {
  if (!Number.isInteger(answer)) throw new Error(`numberChoices kräver heltal, fick ${answer}`);
  const answerText = String(answer);
  const seen = new Set<string>([answerKey(answerText)]);
  const wrongs: string[] = [];
  const push = (n: number): void => {
    if (wrongs.length >= 8) return;
    if (!Number.isInteger(n)) return;
    if (bounds?.min !== undefined && n < bounds.min) return;
    if (bounds?.max !== undefined && n > bounds.max) return;
    const text = String(n);
    const key = answerKey(text);
    if (seen.has(key)) return;
    seen.add(key);
    wrongs.push(text);
  };
  for (const n of rng.shuffle(preferred)) push(n);
  let step = 1;
  while (wrongs.length < 3 && step < 80) {
    push(answer + step);
    push(answer - step);
    step++;
  }
  const picked = multipleChoice(rng, answerText, wrongs);
  return { ...picked, answerText };
}
