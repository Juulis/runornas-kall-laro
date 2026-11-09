/** Delade sprite-/animations-typer och asset-URL (ingen pixi-import — undviker cykler). */

const BASE = `${import.meta.env?.BASE_URL ?? '/runornas-kall-laro/'}assets/`;
export const assetUrl = (p: string): string => BASE + p;

export const DIRS = ['S', 'SV', 'V', 'NV', 'N', 'NO', 'O', 'SO'] as const;

export interface Anim {
  frames: import('pixi.js').Texture[][];
  anchor: [number, number];
  w: number;
  h: number;
  fps: number;
  loop: boolean;
  single?: boolean;
  scale?: number;
  hitFrame?: number;
  /** Horisontell fotjustering i px (frames[dir][frame]) relativt anchor[0]. */
  alignX?: number[][];
  /** Vertikal andning / justering i px (frames[dir][frame]) relativt anchor[1]. */
  alignY?: number[][];
}

export type AnimName = 'idle' | 'gang' | 'run' | 'attack' | 'dod';
export type AnimSet = Partial<Record<AnimName, Anim>>;
