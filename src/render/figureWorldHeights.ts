import type { Anim, AnimSet } from './spriteAnim';
import { animBodyHeight, animSetRefHeight } from './spriteLayout';

/** Designreferens: riddare walk ≈ 155 px synlig höjd vid denna världshöjd (≈20 % under ursprunglig 1,8 m). */
export const FIGURE_HEIGHT_HUMAN_M = 1.44;
export const SCREEN_PX_PER_WORLD_METER = 155 / FIGURE_HEIGHT_HUMAN_M;

export type FigureHeightProfile =
  | 'human'
  | 'wolf'
  | 'wolf_large'
  | 'bear'
  | 'deer'
  | 'fox'
  | 'hare'
  | 'dog_small'
  | 'spider'
  | 'ghost'
  | 'corrupted_human'
  | 'boss_bear'
  | 'boss_undead'
  | 'boss_wolf'
  | 'stilts'
  | 'small_dog'
  | 'small_round'
  | 'karate_master'
  | 'karate_master_strong';

const PROFILE_HEIGHT_M: Record<FigureHeightProfile, number> = {
  human: FIGURE_HEIGHT_HUMAN_M,
  wolf: 1.02,
  wolf_large: 1.22,
  bear: 1.2,
  deer: 0.9,
  fox: 0.4,
  hare: 0.3,
  dog_small: 0.45,
  spider: 0.55,
  ghost: 1.65,
  corrupted_human: FIGURE_HEIGHT_HUMAN_M,
  boss_bear: 2.8,
  boss_undead: 2.4,
  boss_wolf: 1.45,
  stilts: 2.12,
  small_dog: 0.75,
  small_round: 0.9,
  karate_master: 1.7,
  karate_master_strong: 2,
};

const MONSTER_PROFILE: Record<string, FigureHeightProfile> = {
  skogsvarg: 'wolf',
  skuggvarg: 'wolf',
  likatare_varg: 'wolf',
  vargbest: 'wolf_large',
  gravargsledare: 'boss_wolf',
  ruttbjorn: 'bear',
  grabjornen_ulvhild: 'boss_bear',
  taggsvin: 'deer',
  skelett_hund: 'dog_small',
  vandrande_skelett: 'human',
  skelett_krigare: 'human',
  skelett_bagskytt: 'human',
  skelett_runprast: 'human',
  skelett_vakt: 'human',
  skelett_kapten: 'human',
  benkungen_valdemar: 'boss_undead',
  skogsspindel: 'spider',
  gruvspindel: 'spider',
  smittad_bybo: 'corrupted_human',
  forvriden_jagare: 'corrupted_human',
  kattflickan_monster: 'corrupted_human',
  gnistan_monster: 'corrupted_human',
  valpen_monster: 'corrupted_human',
  grisan_monster: 'corrupted_human',
  ruttnande_lik: 'corrupted_human',
  gravgast: 'ghost',
  knutte: 'human',
  linnea: 'human',
  rasmus: 'human',
  gycklare: 'human',
  trasdocka: 'human',
  akrobatkub: 'human',
  styltgangare: 'stilts',
  robotpudel: 'small_dog',
  ballongblob: 'small_round',
  kaxig_mastare: 'karate_master',
};

const FAMILY_PROFILE: Record<string, FigureHeightProfile> = {
  bestar: 'wolf',
  ododa: 'human',
  insekter: 'spider',
  forvridna: 'corrupted_human',
  gastar: 'ghost',
};

/** Walk används för världshöjd (samma som pixel-skala i DirSprite). */
export function referenceAnimForScale(set: AnimSet): Anim | undefined {
  return set.gang ?? set.run ?? set.idle ?? set.attack ?? set.dod;
}

/** Synlig kroppshöjd i skärmpx vid scaleK = 1 (inkl. anim.scale från ark). */
export function measuredSpriteBodyPx(set: AnimSet): number {
  const a = referenceAnimForScale(set);
  if (!a) return 1;
  return animBodyHeight(1, animSetRefHeight(set), a);
}

export function scaleKForWorldHeightM(set: AnimSet, heightM: number): number {
  const targetPx = heightM * SCREEN_PX_PER_WORLD_METER;
  return targetPx / measuredSpriteBodyPx(set);
}

export function displayedBodyPx(set: AnimSet, scaleK: number): number {
  const a = referenceAnimForScale(set);
  if (!a) return 0;
  return animBodyHeight(scaleK, animSetRefHeight(set), a);
}

export function displayedWorldHeightM(set: AnimSet, scaleK: number): number {
  return displayedBodyPx(set, scaleK) / SCREEN_PX_PER_WORLD_METER;
}

export function shadowRadiusForWorldHeightM(heightM: number): number {
  return 26 * (heightM / FIGURE_HEIGHT_HUMAN_M);
}

export function worldHeightMForHeroOrNpc(): number {
  return FIGURE_HEIGHT_HUMAN_M;
}

export function worldHeightMForMonster(id: string, family: string, boss = false): number {
  let profile = MONSTER_PROFILE[id] ?? FAMILY_PROFILE[family] ?? 'human';
  if (boss && profile === 'wolf') profile = 'wolf_large';
  if (boss && id === 'gravargsledare') profile = 'boss_wolf';
  if (boss && id === 'grabjornen_ulvhild') profile = 'boss_bear';
  if (boss && id === 'benkungen_valdemar') profile = 'boss_undead';
  if (boss && id === 'kaxig_mastare') profile = 'karate_master_strong';
  return PROFILE_HEIGHT_M[profile];
}
