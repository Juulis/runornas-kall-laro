import type { KeyValueStore } from '../core/storage';

/** Ark som kan finnas per figur. Nya figurer har bara idle och walk. */
export const HERO_SHEET_KINDS = ['idle', 'walk', 'run', 'attack', 'dodge'] as const;
export type HeroSheetKind = (typeof HERO_SHEET_KINDS)[number];

export interface HeroAppearance {
  id: string;
  /** Tom sträng = sprites/hero/ i roten (riddaren). Annars mappnamnet. */
  folder: string;
  prefix: string;
  labelSv: string;
  /** Reserv om porträttet saknas. */
  icon: string;
  sheets: readonly HeroSheetKind[];
}

const FULL_SHEETS = ['idle', 'walk', 'run', 'attack', 'dodge'] as const satisfies readonly HeroSheetKind[];
const WALK_SHEETS = ['idle', 'walk'] as const satisfies readonly HeroSheetKind[];

/** Enda listan över valbara hjältar, i visningsordning. */
export const HERO_APPEARANCES = [
  { id: 'riddare', folder: '', prefix: 'riddare', labelSv: 'Riddaren', icon: '🛡️', sheets: FULL_SHEETS },
  { id: 'amazonkrigare', folder: 'amazon', prefix: 'amazon', labelSv: 'Amazonen', icon: '🔱', sheets: FULL_SHEETS },
  { id: 'barbar', folder: 'barbar', prefix: 'barbar', labelSv: 'Barbaren', icon: '💥', sheets: FULL_SHEETS },
  { id: 'kattflickan', folder: 'kattflickan', prefix: 'kattflickan', labelSv: 'Kattflickan', icon: '🐱', sheets: WALK_SHEETS },
  { id: 'gnistan', folder: 'gnistan', prefix: 'gnistan', labelSv: 'Gnistan', icon: '✨', sheets: WALK_SHEETS },
  { id: 'valpen', folder: 'valpen', prefix: 'valpen', labelSv: 'Valpen', icon: '🐶', sheets: WALK_SHEETS },
  { id: 'grisan', folder: 'grisan', prefix: 'grisan', labelSv: 'Grisan', icon: '🐷', sheets: WALK_SHEETS },
] as const satisfies readonly HeroAppearance[];

export type HeroClassId = (typeof HERO_APPEARANCES)[number]['id'];

export const DEFAULT_HERO_CLASS = 'riddare' satisfies HeroClassId;

/** Senast valda figuren (localStorage), samma mönster som lärinställningen. */
export const HERO_CLASS_STORAGE_KEY = 'rk_laro_hjalte';

const IDS = new Set<string>(HERO_APPEARANCES.map((h) => h.id));

export function isHeroClassId(v: unknown): v is HeroClassId {
  return typeof v === 'string' && IDS.has(v);
}

function knight(): HeroAppearance {
  const found = HERO_APPEARANCES.find((h) => h.id === DEFAULT_HERO_CLASS);
  if (!found) throw new Error('Riddaren saknas i hjälteregistret');
  return found;
}

/** Känd figur, annars riddaren. */
export function heroAppearance(id: string): HeroAppearance {
  return HERO_APPEARANCES.find((h) => h.id === id) ?? knight();
}

/** Vilka 8dir-ark som ska laddas. Saknade anims fylls i av withFallbacks. */
export function sheetsFor(id: string): readonly HeroSheetKind[] {
  return heroAppearance(id).sheets;
}

export function readLastHeroClass(store: KeyValueStore): HeroClassId {
  try {
    const raw = store.get(HERO_CLASS_STORAGE_KEY);
    return isHeroClassId(raw) ? raw : DEFAULT_HERO_CLASS;
  } catch {
    return DEFAULT_HERO_CLASS;
  }
}

/** Skriver bara giltiga id. Ogiltigt värde rör inte lagringen. */
export function writeLastHeroClass(store: KeyValueStore, id: string): void {
  if (!isHeroClassId(id)) return;
  try {
    store.set(HERO_CLASS_STORAGE_KEY, id);
  } catch (e) {
    console.warn('[hjälte] kunde inte spara figurvalet', e);
  }
}
