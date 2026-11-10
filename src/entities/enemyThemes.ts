import type { EnemyRow } from '../data/types';

/** En uppsättning extra fiender som blandas in i världens spawn-tabeller. */
export interface EnemyTheme {
  id: string;
  label: string;
  extras: readonly EnemyRow[];
}

/**
 * Fiendeteman. Menyn byter inte tema än (det kommer senare).
 * Nu finns bara den klassiska blandningen, med de förvridna figurerna.
 */
export const ENEMY_THEMES: readonly EnemyTheme[] = [
  {
    id: 'klassisk',
    label: 'Klassisk',
    extras: [
      { enemy: 'kattflickan_monster', weight: 15 },
      { enemy: 'gnistan_monster', weight: 15 },
      { enemy: 'valpen_monster', weight: 15 },
      { enemy: 'grisan_monster', weight: 15 },
    ],
  },
];

export const DEFAULT_ENEMY_THEME_ID = 'klassisk';

export function enemyThemeById(id: string): EnemyTheme {
  const found = ENEMY_THEMES.find((t) => t.id === id);
  if (found) return found;
  const fallback = ENEMY_THEMES.find((t) => t.id === DEFAULT_ENEMY_THEME_ID);
  if (!fallback) throw new Error('Inget fiendetema');
  return fallback;
}

/** Baskategorin plus temats extras. Originalen muteras inte. */
export function mergeEnemyTable(base: readonly EnemyRow[], theme: EnemyTheme): EnemyRow[] {
  return [...base.map((row) => ({ ...row })), ...theme.extras.map((row) => ({ ...row }))];
}
