import type { FoundEntry } from '../core/SaveBackend';
import type { HeroSave } from '../core/GameContext';
import { readFoundItemsFromSave } from './foundItems';

export { readFoundItemsFromSave };
import { SAVE_VERSION, type SaveFile } from './types';

/** Sparfil (lagringsformat, bakåtkompatibelt med js/save.js) → core-formatet HeroSave. */
export function toHeroSave(d: SaveFile): HeroSave {
  const h = d.hero;
  const g = d.game;
  return {
    hero: { id: h.id, name: h.name, cls: h.cls, level: h.level, xp: h.xp, gold: h.gold, inv: h.inv, equip: h.equip, fresh: !!h.fresh },
    game: g
      ? {
          seed: g.seed,
          worldSeed: g.worldSeed ?? g.seed,
          killed: [...g.killed],
          zone: g.zone,
          pos: g.pos ? { x: g.pos[0], y: g.pos[1] } : null,
          stage: g.stage,
          runes: g.runes,
          city: g.city,
          ...(typeof g.bwCoordEpoch === 'number' ? { bwCoordEpoch: g.bwCoordEpoch } : {}),
        }
      : null,
    ...(d.foundItems ? { foundItems: d.foundItems } : {}),
    ...(d.worldState ? { worldState: d.worldState } : {}),
    ...(d.learn ? { learn: d.learn } : {}),
  };
}

/** HeroSave → sparfil. foundItems/savedAt kan sättas av lagringen. */
export function fromHeroSave(s: HeroSave, foundItems?: Record<string, FoundEntry>): SaveFile {
  const items = foundItems ?? s.foundItems;
  const h = s.hero;
  const g = s.game;
  const r2 = (n: number): number => Number(n.toFixed(2));
  const out: SaveFile = {
    version: SAVE_VERSION,
    hero: {
      id: h.id ?? '',
      name: h.name,
      cls: h.cls,
      level: h.level,
      xp: h.xp,
      gold: h.gold,
      inv: h.inv,
      equip: h.equip,
      ...(h.fresh ? { fresh: true } : {}),
    },
    game: g
      ? {
          seed: g.seed,
          worldSeed: g.worldSeed ?? g.seed,
          killed: [...g.killed],
          zone: g.zone,
          pos: g.pos ? [r2(g.pos.x), r2(g.pos.y)] : null,
          stage: g.stage,
          runes: g.runes,
          city: g.city,
          ...(typeof g.bwCoordEpoch === 'number' ? { bwCoordEpoch: g.bwCoordEpoch } : {}),
        }
      : null,
  };
  if (items) {
    out.foundItems = items;
    out.found = Object.keys(items).length;
  }
  if (s.worldState) out.worldState = structuredClone(s.worldState);
  if (s.learn) out.learn = { ...s.learn };
  return out;
}

/** @deprecated Använd readFoundItemsFromSave */
export const readFoundItems = readFoundItemsFromSave;
