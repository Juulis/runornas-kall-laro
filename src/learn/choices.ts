import type { Rng } from '../core/Rng';

/** Blandar ett rätt svar med tre unika fel. Kastar om det inte går att få exakt fyra. */
export function multipleChoice(
  rng: Rng,
  answer: string,
  wrongs: readonly string[],
): { choices: [string, string, string, string]; correctIndex: number } {
  const uniq: string[] = [];
  for (const wrong of wrongs) {
    if (!wrong || wrong === answer || uniq.includes(wrong)) continue;
    uniq.push(wrong);
  }
  if (uniq.length < 3) throw new Error(`för få felalternativ för «${answer}»`);
  const picked = rng.shuffle(uniq).slice(0, 3);
  const choices = rng.shuffle([answer, ...picked]) as [string, string, string, string];
  if (choices.length !== 4) throw new Error('flerval blev inte fyra alternativ');
  const correctIndex = choices.indexOf(answer);
  if (correctIndex < 0) throw new Error('rätt svar saknas bland alternativen');
  return { choices, correctIndex };
}

/** Heltalsalternativ runt det rätta svaret. */
export function numberChoices(
  rng: Rng,
  answer: number,
  preferred: readonly number[] = [],
): { choices: [string, string, string, string]; correctIndex: number; answerText: string } {
  const answerText = String(answer);
  const wrongs: string[] = [];
  const seen = new Set<string>([answerText]);
  const push = (n: number): void => {
    if (wrongs.length >= 6) return;
    if (!Number.isFinite(n)) return;
    const text = String(n);
    if (seen.has(text)) return;
    seen.add(text);
    wrongs.push(text);
  };
  for (const n of rng.shuffle(preferred)) push(n);
  let step = 1;
  while (wrongs.length < 3 && step < 50) {
    push(answer + step);
    push(answer - step);
    step++;
  }
  const picked = multipleChoice(rng, answerText, wrongs);
  return { ...picked, answerText };
}
