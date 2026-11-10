import type { LearnSettings } from '../learn/types';
import type { FoundEntry } from '../core/SaveBackend';
import type { Equipment, ItemInstance } from '../core/GameContext';
import type { WorldState } from '../world/worldStateTypes';
import { BIG_WORLD_COORD_EPOCH } from '../world/bigWorld/saveCoordMigrate';
import { HERO_APPEARANCES } from './heroRegistry';

export const SAVE_VERSION = 3;
export const MAX_HEROES = 8;

export interface HeroRecord {
  id: string;
  name: string;
  cls: string;
  level: number;
  xp: number;
  gold: number;
  inv: ItemInstance[];
  equip: Equipment;
  /** Nyskapad, aldrig spelad: motorn ger startutrustning. */
  fresh?: boolean;
}

export interface GameRecord {
  seed: number;
  /** Chunk-geografi; om saknas används seed (migration). */
  worldSeed?: number;
  killed: string[];
  zone: string;
  /** [x, y] i 2D (legacy-3D sparade [x, z], samma axlar på kartan). */
  pos: [number, number] | null;
  rot?: number;
  stage: number;
  runes: number;
  city: string;
  /** Total speltid för dygnscykeln (sekunder). */
  worldTime?: number;
  /** Stor-värld chunk-index efter koordinat-migrering. */
  bwCoordEpoch?: number;
}

export interface SaveFile {
  version: number;
  hero: HeroRecord;
  game: GameRecord | null;
  /** Legacy: antal fynd (js/save.js). */
  found?: number;
  /** Per-hjälte fyndregister (lorebok), ersätter globalt rpg_found i 2D. */
  foundItems?: Record<string, FoundEntry>;
  /** Kartfog per zon (base64-bytes, samma som legacy rpg_karta_<id>_<zon>). */
  fog?: Record<string, string>;
  /** Per-hjälte världstillstånd (#37). */
  worldState?: WorldState;
  /** Nivå och ämne. Saknas i äldre sparfiler. */
  learn?: LearnSettings;
  savedAt?: number;
}

export interface HeroIndexEntry {
  id: string;
  name: string;
  cls: string;
  level: number;
  savedAt?: number;
}

export interface HeroClass {
  id: string;
  name: string;
  icon: string;
}

/** Byggs från hjälteregistret så menyn och sparningen inte har en egen lista. */
export const HERO_CLASSES: readonly HeroClass[] = HERO_APPEARANCES.map((h) => ({
  id: h.id,
  name: h.labelSv,
  icon: h.icon,
}));
export const classById = (id: string): HeroClass | undefined => HERO_CLASSES.find((c) => c.id === id);

export const newGameRecord = (seed: number): GameRecord => ({
  seed,
  killed: [],
  zone: 'forest',
  pos: null,
  stage: 0,
  runes: 0,
  city: 'besatt',
  bwCoordEpoch: BIG_WORLD_COORD_EPOCH,
});
