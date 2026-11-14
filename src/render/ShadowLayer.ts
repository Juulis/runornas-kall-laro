import { BufferImageSource, Container, Sprite, Texture, type DestroyOptions } from 'pixi.js';
import { DEFAULT_CLOCK_TIME, nightBlend } from '../world/GameClock';
import { Iso } from './Iso';

/** Vilken sorts markskugga. Skalan är gemensam per slag, inte per sprite-radie. */
export type ShadowKind = 'tree' | 'bush' | 'monster' | 'hero' | 'npc' | 'decor_small' | 'waymark';

/** Delad ellips i pixlar. Mjuk alfa i texturen; sprite.alpha sätter styrkan. */
export const SHADOW_TEXTURE_W = 128;
export const SHADOW_TEXTURE_H = 64;

/** Full dag. Natten dämpar men släcker inte. */
export const SHADOW_BASE_ALPHA = 0.35;

/**
 * Andel av dagalfan som natten tar bort.
 * Midnatt: base * (1 - 0,7) = 30 % av dagen, tydligt svagare och större än noll.
 */
export const SHADOW_NIGHT_DIM = 0.7;

export const SHADOW_SCALE: Record<ShadowKind, number> = {
  tree: 1.6,
  bush: 0.9,
  monster: 0.8,
  hero: 0.6,
  npc: 0.6,
  decor_small: 0.5,
  waymark: 0.9,
};

/**
 * Fast skärmoffset från fotpunkten, alltid snett åt sydost (inte dynamiskt solljus).
 * Värld: x österut, y söderut. Iso 2:1 gör ren öster till nedåt-höger och ren söder till nedåt-vänster.
 * Mer öster (0,25 m) än söder (0,05 m) ger positiv skärm-x och positiv skärm-y, några pixlar.
 */
export const SHADOW_EAST_M = 0.25;
export const SHADOW_SOUTH_M = 0.05;

/** Syskon-skuggan ligger strax under värdens zIndex så den ritas före objektet. */
const SHADOW_Z_UNDER = 0.05;

const TREE_IDS: ReadonlySet<string> = new Set([
  'gran',
  'gran_ung',
  'dod_ek',
  'bjork',
  'tall',
  'vindtall',
  'vindtall_krokig',
  'fjallbjork',
  'dod_tall',
  'dod_tall_knackt',
  'stenblock',
  'stenblock_lav',
]);

const SMALL_IDS: ReadonlySet<string> = new Set([
  'gras_tuva',
  'ormbunkar',
  'vagros_blommor',
  'ljungtuva',
  'kaveldun',
  'myrull',
  'vasstuva',
  'barnsang',
  'eldstad_kall',
]);

interface ShadowRecord {
  host: Container;
  sprite: Sprite;
  /** Barn i DirSprite/anim. Annars syskon till en fristående Sprite. */
  asChild: boolean;
  inView: boolean;
  forgotten: boolean;
  onAdded: () => void;
  onRemoved: () => void;
  onDestroyed: () => void;
}

const byHost = new Map<Container, ShadowRecord>();
const bySprite = new Map<Sprite, ShadowRecord>();
const active = new Set<ShadowRecord>();

let enabled = true;
let clockTime = DEFAULT_CLOCK_TIME;
let paintedAlpha = shadowAlphaAt(clockTime, true);
let texture: Texture | null = null;
let pixels: Uint8ClampedArray | null = null;

/** Dag 0,35. Natt: base * (1 - SHADOW_NIGHT_DIM * nightBlend). Av: 0. */
export function shadowAlphaAt(timeSeconds: number, enabledFlag = true): number {
  if (!enabledFlag) return 0;
  const blend = nightBlend(timeSeconds);
  return SHADOW_BASE_ALPHA * (1 - SHADOW_NIGHT_DIM * blend);
}

/** Skärmpixlar snett nedåt-höger från fotpunkten. */
export function shadowScreenOffset(): { x: number; y: number } {
  return Iso.worldToScreen(SHADOW_EAST_M, SHADOW_SOUTH_M);
}

export function shadowScaleFor(kind: ShadowKind): number {
  return SHADOW_SCALE[kind];
}

/** Stor dekor (träd och stora stenar) delar den stora skuggan. */
export function shadowKindForDecorLayer(layer: 'stor' | 'mellan' | 'liten'): ShadowKind {
  if (layer === 'stor') return 'tree';
  if (layer === 'mellan') return 'bush';
  return 'decor_small';
}

/** Grov indelning när zonen bara har dekor-id, inte lager. */
export function shadowKindForDecorId(id: string): ShadowKind {
  if (TREE_IDS.has(id)) return 'tree';
  if (SMALL_IDS.has(id)) return 'decor_small';
  return 'bush';
}

/** Mjuk svart ellips, maxalfa 1 i mitten. Samma buffer som texturen. */
export function shadowEllipsePixels(): Uint8ClampedArray {
  if (!pixels) pixels = paintShadowEllipse();
  return pixels;
}

/** Alfa 0–255 i den genererade ellipsen. Hörnen är utanför och därmed 0. */
export function shadowPixelAlpha(x: number, y: number): number {
  if (x < 0 || y < 0 || x >= SHADOW_TEXTURE_W || y >= SHADOW_TEXTURE_H) return 0;
  return shadowEllipsePixels()[(y * SHADOW_TEXTURE_W + x) * 4 + 3] ?? 0;
}

export function sharedShadowTexture(): Texture {
  if (!texture || texture.destroyed) texture = makeShadowTexture();
  return texture;
}

export function activeShadowCount(): number {
  return active.size;
}

/** Skuggsprite mot den delade texturen. Registreras först i attachShadow. */
export function createShadowSprite(kind: ShadowKind): Sprite {
  const sprite = new ShadowSprite(sharedShadowTexture());
  sprite.anchor.set(0.5);
  sprite.scale.set(shadowScaleFor(kind));
  sprite.eventMode = 'none';
  sprite.alpha = shadowAlphaAt(clockTime, enabled);
  sprite.visible = enabled;
  sprite.renderable = enabled;
  return sprite;
}

/**
 * Skugga under host. Container (DirSprite, lägereld) får den som barn vid origo+offset.
 * Fristående Sprite får ett syskon med lägre zIndex, synkat till hostens position.
 */
export function attachShadow(host: Container, kind: ShadowKind): Sprite {
  const prev = byHost.get(host);
  if (prev && !prev.sprite.destroyed) return prev.sprite;

  const sprite = createShadowSprite(kind);
  const asChild = !(host instanceof Sprite);
  const onAdded = (): void => {
    syncShadow(host);
  };
  const onRemoved = (): void => {
    const rec = byHost.get(host);
    if (!rec || rec.asChild || rec.forgotten || rec.sprite.destroyed) return;
    rec.sprite.removeFromParent();
  };
  const onDestroyed = (): void => {
    detachShadow(host);
  };
  const rec: ShadowRecord = { host, sprite, asChild, inView: true, forgotten: false, onAdded, onRemoved, onDestroyed };
  byHost.set(host, rec);
  bySprite.set(sprite, rec);
  active.add(rec);
  host.on('added', onAdded);
  host.on('removed', onRemoved);
  host.on('destroyed', onDestroyed);
  if (asChild) {
    const off = shadowScreenOffset();
    sprite.position.set(off.x, off.y);
    host.addChildAt(sprite, 0);
  } else {
    syncShadow(host);
  }
  applyState(rec);
  return sprite;
}

/** Tar bort skuggan. Den delade texturen lämnas kvar. */
export function detachShadow(host: Container): void {
  const rec = byHost.get(host);
  if (!rec) return;
  forget(rec);
  if (!rec.sprite.destroyed) rec.sprite.destroy({ texture: false, textureSource: false });
}

export function detachAll(): void {
  for (const rec of [...active]) detachShadow(rec.host);
}

/** Flyttar syskon-skuggan till hostens position plus sydost-offset. Barn ligger kvar på offseten. */
export function syncShadow(host: Container): void {
  const rec = byHost.get(host);
  if (!rec || rec.sprite.destroyed) return;
  const off = shadowScreenOffset();
  if (rec.asChild) {
    rec.sprite.position.set(off.x, off.y);
    return;
  }
  rec.sprite.position.set(rec.host.position.x + off.x, rec.host.position.y + off.y);
  rec.sprite.zIndex = rec.host.zIndex - SHADOW_Z_UNDER;
  const parent = rec.host.parent;
  if (parent && rec.sprite.parent !== parent) {
    parent.addChildAt(rec.sprite, parent.getChildIndex(rec.host));
  }
}

/** Kamera-culling. Avstängda skuggor förblir dolda. */
export function setShadowInView(sprite: Sprite, inView: boolean): void {
  const rec = bySprite.get(sprite);
  if (!rec || rec.forgotten) return;
  rec.inView = inView;
  applyState(rec);
}

export function destroyShadowSprite(sprite: Sprite | null | undefined): void {
  if (!sprite || sprite.destroyed) return;
  sprite.destroy({ texture: false, textureSource: false });
}

/** Gömmer eller visar alla aktiva skuggor utan att förstöra dem. */
export function setShadowsEnabled(on: boolean): void {
  if (enabled === on) return;
  enabled = on;
  refreshAll();
}

/** Dygnsalfa. Oförändrad alfa hoppar över sprite-svepet. */
export function setClockTime(timeSeconds: number): void {
  if (!Number.isFinite(timeSeconds)) return;
  clockTime = timeSeconds;
  const alpha = shadowAlphaAt(clockTime, true);
  if (alpha === paintedAlpha) return;
  paintedAlpha = alpha;
  if (enabled) refreshAll();
}

export function shadowsAreEnabled(): boolean {
  return enabled;
}

class ShadowSprite extends Sprite {
  override destroy(options?: DestroyOptions | boolean): void {
    if (this.destroyed) return;
    const rec = bySprite.get(this);
    if (rec) forget(rec);
    if (typeof options === 'boolean') super.destroy({ children: options, texture: false, textureSource: false });
    else super.destroy({ ...options, texture: false, textureSource: false });
  }
}

function forget(rec: ShadowRecord): void {
  if (rec.forgotten) return;
  rec.forgotten = true;
  rec.host.off('added', rec.onAdded);
  rec.host.off('removed', rec.onRemoved);
  rec.host.off('destroyed', rec.onDestroyed);
  byHost.delete(rec.host);
  bySprite.delete(rec.sprite);
  active.delete(rec);
}

function applyState(rec: ShadowRecord): void {
  const sprite = rec.sprite;
  if (sprite.destroyed) return;
  const show = enabled && rec.inView;
  sprite.visible = show;
  sprite.renderable = show;
  sprite.alpha = enabled ? shadowAlphaAt(clockTime, true) : 0;
}

function refreshAll(): void {
  for (const rec of active) applyState(rec);
}

function paintShadowEllipse(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SHADOW_TEXTURE_W * SHADOW_TEXTURE_H * 4);
  const cx = (SHADOW_TEXTURE_W - 1) / 2;
  const cy = (SHADOW_TEXTURE_H - 1) / 2;
  const rx = SHADOW_TEXTURE_W / 2;
  const ry = SHADOW_TEXTURE_H / 2;
  for (let y = 0; y < SHADOW_TEXTURE_H; y++) {
    for (let x = 0; x < SHADOW_TEXTURE_W; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = Math.sqrt(nx * nx + ny * ny);
      let a = 0;
      if (d < 1) {
        const t = 1 - d;
        a = t * t * (3 - 2 * t);
      }
      const i = (y * SHADOW_TEXTURE_W + x) * 4;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = Math.round(a * 255);
    }
  }
  return data;
}

function tryShadowCanvas(px: Uint8ClampedArray): HTMLCanvasElement | OffscreenCanvas | null {
  const jsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
  if (!jsdom && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = SHADOW_TEXTURE_W;
    canvas.height = SHADOW_TEXTURE_H;
    const ctx = canvas.getContext('2d');
    if (ctx && putPixels(ctx, px)) return canvas;
  }
  if (typeof OffscreenCanvas === 'undefined') return null;
  try {
    const canvas = new OffscreenCanvas(SHADOW_TEXTURE_W, SHADOW_TEXTURE_H);
    const ctx = canvas.getContext('2d');
    if (ctx && putPixels(ctx, px)) return canvas;
  } catch {
    return null;
  }
  return null;
}

function putPixels(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, px: Uint8ClampedArray): boolean {
  try {
    const image = ctx.createImageData(SHADOW_TEXTURE_W, SHADOW_TEXTURE_H);
    image.data.set(px);
    ctx.putImageData(image, 0, 0);
    return true;
  } catch {
    return false;
  }
}

function makeShadowTexture(): Texture {
  const px = shadowEllipsePixels();
  const canvas = tryShadowCanvas(px);
  if (canvas) {
    try {
      return Texture.from(canvas, true);
    } catch {
      /* BufferImageSource nedan när canvas inte kan bli en textur. */
    }
  }
  return new Texture({
    source: new BufferImageSource({
      resource: px,
      width: SHADOW_TEXTURE_W,
      height: SHADOW_TEXTURE_H,
      format: 'rgba8unorm',
      alphaMode: 'no-premultiply-alpha',
    }),
  });
}
