import type { Equipment, ItemInstance } from '../core/GameContext';
import { isRecord } from '../core/json';
import { parseFogMap } from './fog';
import { parseFoundItemsMap } from './foundItems';
import { hydrateWorldStateFromLegacy, parseWorldState } from '../world/worldStateTypes';
import { BIG_WORLD_COORD_EPOCH } from '../world/bigWorld/saveCoordMigrate';
import { parseLearnSettings } from '../learn/settings';
import { SAVE_VERSION, type GameRecord, type HeroRecord, type SaveFile } from './types';

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
const parseInv = (v: unknown): ItemInstance[] =>
  Array.isArray(v) ? v.filter(isRecord).filter((i): i is Record<string, unknown> & ItemInstance => typeof i.base === 'string') : [];
const equip = (v: unknown): Equipment => {
  const out: Equipment = {};
  if (isRecord(v))
    for (const [k, it] of Object.entries(v)) out[k] = isRecord(it) && typeof it.base === 'string' ? (it as unknown as ItemInstance) : null;
  return out;
};

/** Validerar och migrerar sparfiler till aktuell SAVE_VERSION. Okänt/nyare format ger null. */
export class SaveMigrator {
  /** Gammalt startgear (före hotfix #17) hade nivåkrav över 1: byts mot Normal tier 1 om hjälten inte klarar kravet. */
  private static readonly OLD_START: Readonly<Record<string, readonly [string, number]>> = {
    langsvard: ['rostig_kortsvard', 6],
    ringbrynja: ['laderharnesk', 7],
    tvahands_klubba: ['knotpak', 5],
  };

  private static readonly CONSUMABLE_REMAP: Readonly<Record<string, string>> = {
    liten_halsodryck: 'torkat_kott',
    stor_halsodryck: 'rokerat_hogrev',
    uthallighetsdryck: 'skogsörtste',
    foryngringsdryck: 'varlbrygd',
  };

  migrate(raw: unknown): SaveFile | null {
    if (!isRecord(raw)) return null;
    let d: Record<string, unknown> = raw;
    if (!d.version) d = this.fromV0(d);
    const version = num(d.version, 0);
    if (version > SAVE_VERSION || version < 1) return null;
    // framtida: if (version === 1) { …; version = 2 }
    const h = d.hero;
    if (!isRecord(h) || typeof h.id !== 'string') return null;
    const hero: HeroRecord = {
      id: h.id,
      name: str(h.name, 'Namnlös'),
      cls: str(h.cls, 'riddare'),
      level: num(h.level, 1),
      xp: num(h.xp, 0),
      gold: num(h.gold, 0),
      inv: parseInv(h.inv),
      equip: equip(h.equip),
      ...(h.fresh === true ? { fresh: true } : {}),
    };
    this.fixOldStartGear(hero);
    this.remapConsumables(hero);
    const out: SaveFile = { version: SAVE_VERSION, hero, game: this.game(d.game) };
    const found = parseFoundItemsMap(d.foundItems);
    if (found) {
      out.foundItems = found;
      out.found = Object.keys(found).length;
    } else if (typeof d.found === 'number') out.found = d.found;
    const fog = parseFogMap(d.fog);
    if (fog) out.fog = fog;
    if (typeof d.savedAt === 'number') out.savedAt = d.savedAt;
    const ws = parseWorldState(d.worldState);
    out.worldState = ws ?? hydrateWorldStateFromLegacy(out.game, out.foundItems);
    const learn = parseLearnSettings(d.learn);
    if (learn) out.learn = learn;
    return out;
  }

  private fromV0(d: Record<string, unknown>): Record<string, unknown> {
    return {
      version: 1,
      hero: { id: d.id, name: d.name, cls: d.cls, level: d.level, xp: d.xp, gold: d.gold, inv: d.inv, equip: d.equip },
      game: d.seed ? { seed: d.seed, killed: d.killed, zone: d.zone, pos: d.pos, stage: d.stage, runes: d.runes, city: d.city } : null,
    };
  }

  private game(g: unknown): GameRecord | null {
    if (!isRecord(g) || typeof g.seed !== 'number') return null;
    const killedRaw = g.killed;
    const killed = Array.isArray(killedRaw) ? killedRaw : killedRaw instanceof Set ? [...(killedRaw as Set<unknown>)] : [];
    const pos =
      Array.isArray(g.pos) && g.pos.length >= 2 && g.pos.every((n) => typeof n === 'number')
        ? ([g.pos[0], g.pos[1]] as [number, number])
        : null;
    const rec: GameRecord = {
      seed: g.seed,
      killed: killed.filter((k): k is string => typeof k === 'string'),
      zone: str(g.zone, 'forest'),
      pos,
      stage: num(g.stage, 0),
      runes: num(g.runes, 0),
      city: str(g.city, 'besatt'),
    };
    if (typeof g.rot === 'number') rec.rot = g.rot;
    if (typeof g.worldSeed === 'number' && Number.isFinite(g.worldSeed)) rec.worldSeed = g.worldSeed;
    if (typeof g.worldTime === 'number' && Number.isFinite(g.worldTime) && g.worldTime >= 0) rec.worldTime = g.worldTime;
    const epoch = typeof g.bwCoordEpoch === 'number' ? g.bwCoordEpoch : 0;
    if (epoch < BIG_WORLD_COORD_EPOCH) {
      rec.killed = rec.killed.filter((k) => !k.startsWith('bw:'));
      rec.bwCoordEpoch = BIG_WORLD_COORD_EPOCH;
    } else rec.bwCoordEpoch = epoch;
    return rec;
  }

  private remapConsumables(h: HeroRecord): void {
    const map = (it: ItemInstance | null | undefined): void => {
      if (!it) return;
      const next = SaveMigrator.CONSUMABLE_REMAP[it.base];
      if (next) it.base = next;
    };
    Object.values(h.equip).forEach(map);
    h.inv.forEach(map);
  }

  private fixOldStartGear(h: HeroRecord): void {
    const fix = (it: ItemInstance | null | undefined): void => {
      const o = it ? SaveMigrator.OLD_START[it.base] : undefined;
      if (it && o && h.level < o[1] && (it.quality ?? 'normal') === 'normal' && !(it.affixes ?? []).length) {
        it.base = o[0];
        it.ilvl = 1;
      }
    };
    Object.values(h.equip).forEach(fix);
    h.inv.forEach(fix);
  }
}
