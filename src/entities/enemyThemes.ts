import type { KeyValueStore } from '../core/storage';
import { DATA } from '../data';
import type { EliteKind, EnemyRow } from '../data/types';
import { isBossMonsterId } from '../world/bossIds';

/** Sparad fiendetema-nyckel (localStorage). Ogiltigt värde läses som vanliga. */
export const ENEMY_THEME_STORAGE_KEY = 'rk_laro_fiendetema';

export const DEFAULT_ENEMY_THEME_ID = 'vanliga' as const;

export type EnemyThemeId = 'vanliga' | 'digital_cirkus' | 'karatedojo';

/** Vad som räknas som boss eller stark när ett tema har en egen mästarfigur. */
export interface EnemyLookFlags {
  /** SpawnSpec.boss eller definitionens boss. */
  boss?: boolean;
  underboss?: boolean;
  elite?: EliteKind | null;
}

/**
 * Ett fiendetema. Utseendet byts i MonsterFactory. Id, stats och loot stannar på originalmonstret.
 * `extras` blandas in i spawn-tabellen (figurmonsters från hjältevalet).
 */
export interface EnemyTheme {
  readonly id: EnemyThemeId;
  /** Svenskt visningsnamn. */
  readonly name: string;
  /** Underrubrik i menyn, till exempel klubbens namn. */
  readonly subtitle?: string;
  readonly extras?: readonly EnemyRow[];
  /** Vanliga monster fördelas stabilt mellan dessa sprite-id. Tom lista = ingen omvandling. */
  readonly figures: readonly string[];
  /** Bossar och starka fiender. Saknas figuren används `figures` även för dem. */
  readonly strongSheet?: string;
}

const CIRCUS_FIGURES = ['trasdocka', 'gycklare', 'robotpudel', 'styltgangare', 'ballongblob', 'akrobatkub'] as const;
const KARATE_FIGURES = ['knutte', 'linnea', 'rasmus'] as const;

/** Förvridna hjältefigurer som blandas in i världens spawn-tabeller. */
const FIGURE_MONSTER_EXTRAS: readonly EnemyRow[] = [
  { enemy: 'kattflickan_monster', weight: 15 },
  { enemy: 'gnistan_monster', weight: 15 },
  { enemy: 'valpen_monster', weight: 15 },
  { enemy: 'grisan_monster', weight: 15 },
];

const FIGURE_MONSTER_IDS = new Set(FIGURE_MONSTER_EXTRAS.map((row) => row.enemy));

const VANLIGA: EnemyTheme = {
  id: 'vanliga',
  name: 'Vanliga',
  figures: [],
  extras: FIGURE_MONSTER_EXTRAS,
};

export const ENEMY_THEMES: readonly EnemyTheme[] = [
  VANLIGA,
  {
    id: 'digital_cirkus',
    name: 'Digital cirkus',
    figures: CIRCUS_FIGURES,
  },
  {
    id: 'karatedojo',
    name: 'Karatedojo',
    subtitle: 'Skorpionklubben',
    figures: KARATE_FIGURES,
    strongSheet: 'kaxig_mastare',
  },
];

const FIGURE_LABEL: Readonly<Record<string, string>> = {
  trasdocka: 'Trasdocka',
  gycklare: 'Gycklare',
  robotpudel: 'Robotpudel',
  styltgangare: 'Styltgångare',
  ballongblob: 'Ballongblob',
  akrobatkub: 'Akrobatkub',
  knutte: 'Knutte',
  linnea: 'Linnea',
  rasmus: 'Rasmus',
  kaxig_mastare: 'Kaxig mästare',
};

let activeThemeId: EnemyThemeId = DEFAULT_ENEMY_THEME_ID;
let underbossIds: Set<string> | null = null;

function underbossSet(): Set<string> {
  if (!underbossIds) {
    underbossIds = new Set();
    for (const m of DATA.families.monsters) if (m.underboss) underbossIds.add(m.id);
  }
  return underbossIds;
}

/** Aktivt tema för den pågående sessionen. Tester kan sätta det utan lagring. */
export function setActiveEnemyTheme(id: string): void {
  activeThemeId = isEnemyThemeId(id) ? id : DEFAULT_ENEMY_THEME_ID;
}

export function getActiveEnemyTheme(): EnemyTheme {
  return enemyThemeById(activeThemeId);
}

export function isEnemyThemeId(v: unknown): v is EnemyThemeId {
  return typeof v === 'string' && ENEMY_THEMES.some((t) => t.id === v);
}

export function enemyThemeById(id: string): EnemyTheme {
  return ENEMY_THEMES.find((t) => t.id === id) ?? VANLIGA;
}

export function readEnemyTheme(store: KeyValueStore): EnemyThemeId {
  try {
    const raw = store.get(ENEMY_THEME_STORAGE_KEY);
    if (!raw) return DEFAULT_ENEMY_THEME_ID;
    if (isEnemyThemeId(raw)) return raw;
    const parsed: unknown = JSON.parse(raw);
    return isEnemyThemeId(parsed) ? parsed : DEFAULT_ENEMY_THEME_ID;
  } catch {
    return DEFAULT_ENEMY_THEME_ID;
  }
}

/** Skriver bara giltiga id. Ogiltigt id lämnar lagringen orörd. */
export function writeEnemyTheme(store: KeyValueStore, id: string): void {
  if (!isEnemyThemeId(id)) return;
  store.set(ENEMY_THEME_STORAGE_KEY, JSON.stringify(id));
}

/** Kopia av basen plus temats extras. Muterar inte `base`. */
export function mergeEnemyTable(base: readonly EnemyRow[], theme: Pick<EnemyTheme, 'extras'>): EnemyRow[] {
  const extras = theme.extras ?? [];
  return [...base.map((row) => ({ ...row })), ...extras.map((row) => ({ ...row }))];
}

function hashSalt(salt: string): number {
  let h = 2166136261;
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function isStrongLook(originalId: string, flags: EnemyLookFlags): boolean {
  if (flags.boss === true || flags.underboss === true) return true;
  if (flags.elite === 'champion' || flags.elite === 'unik') return true;
  if (isBossMonsterId(originalId)) return true;
  return underbossSet().has(originalId);
}

/**
 * Sprite-id för utseendet. `vanliga` ger alltid originalId.
 * Samma salt (spawn-uid, eller original-id + uid) ger alltid samma figur.
 */
export function themeSheetFor(theme: EnemyTheme, originalId: string, flags: EnemyLookFlags, salt: string): string {
  if (theme.id === DEFAULT_ENEMY_THEME_ID) return originalId;
  // Figurmonsters behåller sitt eget utseende även när ett tema är valt.
  if (FIGURE_MONSTER_IDS.has(originalId)) return originalId;
  if (theme.strongSheet && isStrongLook(originalId, flags)) return theme.strongSheet;
  if (theme.figures.length === 0) return originalId;
  const figure = theme.figures[hashSalt(salt) % theme.figures.length];
  return figure ?? originalId;
}

/** Svenskt visningsnamn för de tio temafigurerna. Okänt id ger tillbaka id:t. */
export function themeFigureLabel(sheetId: string): string {
  return FIGURE_LABEL[sheetId] ?? sheetId;
}

/**
 * Namn i MonsterBar och bossrutan. Vanliga: unikt namn eller datanamn.
 * Annars figurnamnet. Unika eliter visas tillsammans med figuren.
 * Saknas temafiguren (arket föll tillbaka) används datanamnet.
 */
export function themedMonsterTitle(appearanceId: string, dataName: string, uname?: string | null): string {
  const unique = uname?.trim() ? uname.trim() : '';
  if (getActiveEnemyTheme().id === DEFAULT_ENEMY_THEME_ID) return unique || dataName;
  const figure = FIGURE_LABEL[appearanceId];
  if (!figure) return unique || dataName;
  if (unique) return `${unique}, ${figure}`;
  return figure;
}
