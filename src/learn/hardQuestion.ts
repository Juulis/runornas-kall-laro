import type { LearnQuestion } from './types';

/** Matte-regler där eleven får en kladdruta. Andra ämnen och lättare regler ingår inte. */
export const HARD_MATH_RULES = ['ak79-ekvation', 'ak79-potens', 'gym-andragrads', 'gym-procent'] as const;

const HARD = new Set<string>(HARD_MATH_RULES);

export function isHardMathRule(rule: string): boolean {
  return HARD.has(rule);
}

/**
 * Svår mattefråga: antingen `needsScratchpad` eller en regel i HARD_MATH_RULES.
 * Svenska och engelska är aldrig svåra, även om flaggan eller regeln råkar sitta där.
 */
export function isHardQuestion(q: LearnQuestion): boolean {
  if (q.subject !== 'matte') return false;
  return q.needsScratchpad === true || isHardMathRule(q.rule);
}
