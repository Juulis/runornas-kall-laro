import type { Inventory } from '../logic/Inventory';
import type { HeroModel } from '../logic/HeroModel';
import { shouldKeepInInventory } from '../logic/inventoryDiscard';
import type { ItemStats, Loot } from '../logic/loot/Loot';
import { SLOTS, type Item, type Slot } from '../logic/loot/types';

/** Vikter för affix som inte redan bakats in i wdmg/def. */
const WEIGHTS: Record<string, number> = {
  life: 0.35,
  damage_flat: 1,
  attack_rating: 0.2,
  crit_chance: 40,
  strong_hit_chance: 25,
  block_chance: 20,
  magic_find: 6,
  gold_find: 4,
  attack_speed_pct: 18,
  move_speed_pct: 8,
  life_pct: 25,
  stamina: 0.08,
  lifesteal: 35,
  thorns: 0.4,
  life_on_hit: 2,
  life_regen: 2,
};

const BAKED = new Set(['wdmg', 'def', 'defense', 'defense_pct', 'damage_pct']);

/**
 * Poäng för auto-equip: vapenskada och försvar från itemStats, plus summan av övriga stats.
 * Högre poäng är bättre. Tom plats räknas som sämre än ett föremål hjälten kan ta på.
 */
export function gearScore(stats: ItemStats): number {
  let score = 0;
  if (stats.wdmg) score += (stats.wdmg[0] + stats.wdmg[1]) / 2;
  if (typeof stats.def === 'number') score += stats.def;
  for (const [key, value] of Object.entries(stats)) {
    if (BAKED.has(key) || typeof value !== 'number') continue;
    score += value * (WEIGHTS[key] ?? 1);
  }
  return score;
}

export function isBetterScore(candidate: number, equipped: number | null): boolean {
  if (equipped == null) return true;
  return candidate > equipped + 1e-9;
}

/** Plats där föremålet är strikt bättre, eller null om det inte ska tas på. */
export function chooseAutoEquipSlot(L: Loot, inv: Inventory, it: Item): Slot | null {
  const base = L.base(it);
  if (!L.equipable(base)) return null;
  const kind = L.slotOf(base);
  if (!kind) return null;
  const slots: Slot[] = kind === 'ring' ? ['ring1', 'ring2'] : (SLOTS as readonly string[]).includes(kind) ? [kind as Slot] : [];
  if (!slots.length) return null;
  const candidate = gearScore(L.itemStats(it));
  let worst: { slot: Slot; score: number } | null = null;
  for (const slot of slots) {
    if (!inv.canEquip(it, slot)) continue;
    const cur = inv.equip[slot];
    if (!cur) return slot;
    const score = gearScore(L.itemStats(cur));
    if (!worst || score < worst.score) worst = { slot, score };
  }
  if (worst && isBetterScore(candidate, worst.score)) return worst.slot;
  return null;
}

function displacedByEquip(L: Loot, inv: Inventory, it: Item, slot: Slot): Item[] {
  const out: Item[] = [];
  const old = inv.equip[slot];
  if (old && old !== it) out.push(old);
  if (slot === 'vapen' && L.base(it).two_handed) {
    const off = inv.equip.offhand;
    if (off && off !== it && off !== old) out.push(off);
  }
  return out;
}

/** Tar på föremålet om det är bättre. Undanträngt stannar i väskan bara om det är unikt, set eller legendary. */
export function autoEquipItem(L: Loot, hero: HeroModel, it: Item): Slot | null {
  const slot = chooseAutoEquipSlot(L, hero.inv, it);
  if (!slot) return null;
  for (const old of displacedByEquip(L, hero.inv, it, slot)) {
    if (shouldKeepInInventory(old)) continue;
    const held = hero.inv.slotOfItem(old);
    if (held) hero.inv.equip[held] = null;
  }
  return hero.inv.equipTo(it, slot) ? slot : null;
}
