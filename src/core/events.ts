import type { LearnSettings } from '../learn/types';

/* eslint-disable @typescript-eslint/no-invalid-void-type -- void = event utan payload (godkänt kontrakt) */
/**
 * Alla spelhändelser med payload (godkänt kontrakt mellan Utvecklare 1 och 2).
 * EN namnform per händelse – inga alias (t.ex. inget death/rune_activate). Nya events läggs till här.
 */
export type UiPanel = 'inventory' | 'map' | 'lore' | 'menu' | 'settings' | 'npc' | 'quests';

// `type` (inte interface) så att den uppfyller Record<string, unknown> i EventBus.
export type GameEvents = {
  hit: { target: string; dmg: number; crit: boolean };
  kill: { id: string; area: string; lvl: number; champion: boolean; unique: boolean; boss: boolean };
  loot_drop: { quality: string };
  pickup: { itemId: string; first: boolean; quality?: string };
  gold: { amount: number };
  rune: { n: number };
  portal_open: void;
  zone_enter: { name: string; areaId: string };
  quest_inspect: { ankare: string };
  quest_npc_talk: { npcId: string };
  boss_start: void;
  boss_phase: { phase: number };
  step: void;
  /** Aktiv undanmanöver (#15). */
  dodge: { classId: string };
  level_up: { level: number };
  new_game: { seed: number };
  hero_loaded: { heroId: string };
  hero_deleted: { heroId: string };
  lore_unlock: { id: string };
  map_toggle: { open: boolean };
  ui_open: { panel: UiPanel };
  ui_close: { panel: UiPanel };
  /** Språkbyte (U2:s LocaleManager, #22). */
  locale_changed: { locale: 'sv' | 'en' };
  /** Världstillstånd (#37). */
  boss_killed: { id: string };
  legendary_found: { itemId: string };
  city_state_changed: { city: string; state: string };
  runes_changed: { count: number };
  /** Nytt speldygn (#47). */
  day_changed: { day: number };
  /** Avlägset nattljud (inte spawn-relaterat). */
  night_ambient: { intensity: number };
  /** Sparning misslyckades (R5-M1). */
  save_failed: { reason?: string };
  /** Nivå och ämne i lärversionen. */
  learn_settings: LearnSettings;
};
