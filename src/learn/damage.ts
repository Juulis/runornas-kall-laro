/** Fel svar kostar exakt en fjärdedel av maxlivet. Hjälten kan dö om livet tar slut. */
export function wrongAnswerDamage(maxHp: number): number {
  return maxHp / 4;
}

export function applyWrongAnswer(hp: number, maxHp: number): { hp: number; damage: number; died: boolean } {
  const damage = wrongAnswerDamage(maxHp);
  const next = Math.max(0, hp - damage);
  return { damage, hp: next, died: next <= 0 };
}
