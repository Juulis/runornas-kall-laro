import type { Item } from './loot/types';
import { isQuestItemProtected } from '../quest/questItems';

const KEEP_QUALITY = new Set(['legendary', 'set', 'unique']);

/**
 * Autoplock lägger bara unika, set och legendaries i väskan.
 * rareName räcker inte: rare, magic och normal slängs om de inte tas på.
 */
export function shouldKeepInInventory(it: Item): boolean {
  if (it.leg) return true;
  if (it.set) return true;
  return KEEP_QUALITY.has(it.quality);
}

/** Kräver bekräftelse innan föremålet slängs på marken (ej questföremål — de blockeras helt). */
export function discardNeedsConfirm(it: Item): boolean {
  if (isQuestItemProtected(it)) return false;
  const q = it.quality;
  if (q === 'legendary' || q === 'set') return true;
  if (it.leg) return true;
  if (it.rareName) return true;
  return false;
}
