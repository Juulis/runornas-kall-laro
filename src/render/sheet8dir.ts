import { Rectangle, Texture } from 'pixi.js';
import type { Anim, AnimSet } from './spriteAnim';
import { assetUrl, DIRS } from './spriteAnim';

export type TexLoader = (url: string) => Promise<Texture>;

export interface Sheet8Json {
  image: string;
  frameW: number;
  frameH: number;
  anchor: [number, number];
  dirs: string[];
  frames?: number;
  fps?: number;
  loop?: boolean;
  hitFrame?: number;
  alignX?: number[][];
  alignY?: number[][];
  rects?: { dir: string; frame?: number; x: number; y: number; w: number; h: number }[];
}

export interface StripAnimJson {
  image: string;
  frames: number;
  frameW: number;
  frameH: number;
  anchor: [number, number];
  fps?: number;
  loop?: boolean;
}

function cut(src: Texture, x: number, y: number, w: number, h: number): Texture {
  return new Texture({ source: src.source, frame: new Rectangle(x, y, w, h) });
}

async function json<T>(p: string): Promise<T> {
  const r = await fetch(assetUrl(p));
  if (!r.ok) throw new Error(`Kunde inte ladda ${p}`);
  return (await r.json()) as T;
}

/** Antal bildrutor per riktning — från JSON, annars högsta frame-index i rects + 1, annars 1. */
export function sheet8FrameCount(meta: Pick<Sheet8Json, 'frames' | 'rects'>): number {
  if (meta.frames != null && meta.frames > 0) return meta.frames;
  const rects = meta.rects;
  if (rects?.length) {
    let max = 0;
    for (const r of rects) max = Math.max(max, (r.frame ?? 0) + 1);
    return max || 1;
  }
  return 1;
}

type Sheet8Rect = NonNullable<Sheet8Json['rects']>[number];

/**
 * Härleder rutor när JSON saknar rects (t.ex. amazon/barbar idle: en rad, en ruta per riktning).
 * Flera frames: en rad per riktning, kolumner per frame (samma som riddare_* med rects).
 */
export function resolveSheet8Rects(meta: Pick<Sheet8Json, 'dirs' | 'frames' | 'frameW' | 'frameH' | 'rects'>): Sheet8Rect[] {
  if (meta.rects?.length) return meta.rects;
  const nFrame = sheet8FrameCount(meta);
  const out: Sheet8Rect[] = [];
  for (let d = 0; d < meta.dirs.length; d++) {
    const dir = meta.dirs[d];
    if (!dir) continue;
    for (let f = 0; f < nFrame; f++) {
      const x = nFrame === 1 ? d * meta.frameW : f * meta.frameW;
      const y = nFrame === 1 ? 0 : d * meta.frameH;
      out.push({ dir, frame: f, x, y, w: meta.frameW, h: meta.frameH });
    }
  }
  return out;
}

/** 8-riktningsark (riddare_*, monster_*_8dir, npc_*_idle_8dir). */
export async function loadSheet8dir(tex: TexLoader, dir: string, name: string, scale?: number): Promise<Anim> {
  const meta = await json<Sheet8Json>(`${dir}/${name}.json`);
  const src = await tex(`${dir}/${meta.image}`);
  const rects = resolveSheet8Rects(meta);
  const nDir = meta.dirs.length;
  const nFrame = sheet8FrameCount(meta);
  const frames: Texture[][] = [];
  for (let d = 0; d < nDir; d++) {
    const row: Texture[] = [];
    for (let f = 0; f < nFrame; f++) {
      const rect = rects.find((r) => meta.dirs.indexOf(r.dir) === d && (r.frame ?? 0) === f);
      if (!rect) throw new Error(`${name}: saknar ruta ${meta.dirs[d]} f${f}`);
      row.push(cut(src, rect.x, rect.y, rect.w, rect.h));
    }
    frames.push(row);
  }
  return {
    frames,
    anchor: meta.anchor,
    w: meta.frameW,
    h: meta.frameH,
    fps: meta.fps ?? 1,
    loop: meta.loop ?? true,
    hitFrame: meta.hitFrame,
    alignX: meta.alignX,
    alignY: meta.alignY,
    scale,
  };
}

/** En horisontell bildrad (t.ex. lägereld). */
export async function loadStripAnim(tex: TexLoader, dir: string, name: string): Promise<Anim> {
  const meta = await json<StripAnimJson>(`${dir}/${name}.json`);
  const src = await tex(`${dir}/${meta.image}`);
  const row: Texture[] = [];
  for (let c = 0; c < meta.frames; c++) row.push(cut(src, c * meta.frameW, 0, meta.frameW, meta.frameH));
  return {
    frames: DIRS.map(() => row),
    anchor: meta.anchor,
    w: meta.frameW,
    h: meta.frameH,
    fps: meta.fps ?? 10,
    loop: meta.loop ?? true,
    single: true,
  };
}

export const MONSTER_8DIR_STEMS = ['idle', 'walk', 'attack', 'death'] as const;

/** Försök ladda monster-ark i hero-8dir-format; null om idle saknas.
 *  `stems` styr vilka filer som efterfrågas, så att saknade attack/death-ark inte ger 404. */
export async function loadMonster8dirSet(
  tex: TexLoader,
  id: string,
  stems: readonly string[] = MONSTER_8DIR_STEMS,
): Promise<Partial<AnimSet> | null> {
  const dir = `2d/sprites/monster/${id}`;
  const wanted = new Set(stems);
  const load = async (stem: string): Promise<Anim | undefined> => {
    if (!wanted.has(stem)) return undefined;
    try {
      return await loadSheet8dir(tex, dir, `${id}_${stem}_8dir`);
    } catch {
      return undefined;
    }
  };
  const idle = await load('idle');
  if (!idle) return null;
  const set: Partial<AnimSet> = { idle };
  const walk = await load('walk');
  if (walk) set.gang = walk;
  const attack = await load('attack');
  if (attack) set.attack = attack;
  const death = await load('death');
  if (death) set.dod = { ...death, loop: false };
  return set;
}
