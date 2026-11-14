import { BufferImageSource, Container, Sprite, Texture, type DestroyOptions } from 'pixi.js';
import { canonicalBiomeId } from './biomeAssetGroups';
import { DEFAULT_CLOCK_TIME, nightBlend } from '../world/GameClock';

/** Vilken sorts ljuskälla. Elden är störst, hjälten minst. */
export type LightKind = 'campfire' | 'torch' | 'lamp' | 'rune' | 'monster' | 'hero';

export type DarknessMode = 'normal' | 'light';

/** Gemensam mjuk gradient. Sprite-skala och alfa sätter styrkan. */
export const LIGHT_TEXTURE_SIZE = 256;

/** Bara de här många ljusen närmast hjälten ritas. Övriga sitter kvar men är dolda. */
export const LIGHT_ACTIVE_CAP = 24;

/** Dagens helskärms-overlay. Oförändrad när nightBlend är 0. */
export const DAY_OVERLAY_ALPHA = 0.08;

/** Relativ storlek. Talen är sprite-skala på den delade texturen. */
export const LIGHT_SCALE: Record<LightKind, number> = {
  campfire: 2.35,
  lamp: 1.35,
  torch: 1.15,
  monster: 0.95,
  rune: 0.7,
  hero: 0.42,
};

/** Topp-alfa vid full natt, före mörkerlägets lilla dämpning. */
const LIGHT_PEAK_ALPHA: Record<LightKind, number> = {
  campfire: 0.95,
  torch: 0.72,
  lamp: 0.66,
  monster: 0.58,
  rune: 0.4,
  hero: 0.24,
};

const LIGHT_TINT: Record<LightKind, number> = {
  campfire: 0xffb060,
  torch: 0xffc27a,
  lamp: 0xffd39a,
  monster: 0xb7d4ff,
  rune: 0x9fd4ff,
  hero: 0xffe0a8,
};

/** Full natt per biom. Träsk och aska mörkast, kust ljusast, skog däremellan. */
const NIGHT_TARGET: Record<DarknessMode, Record<'dark' | 'coast' | 'woods', number>> = {
  normal: { dark: 0.76, coast: 0.54, woods: 0.66 },
  light: { dark: 0.46, coast: 0.3, woods: 0.38 },
};

const GLOWING_MONSTER_IDS: ReadonlySet<string> = new Set(['lyktgast', 'lyktman', 'irrbloss']);

export interface LightWorldPos {
  x: number;
  y: number;
}

interface LightRecord {
  host: Container;
  sprite: Sprite;
  kind: LightKind;
  wx: number;
  wy: number;
  hasWorld: boolean;
  inCap: boolean;
  asChild: boolean;
  order: number;
  forgotten: boolean;
  onAdded: () => void;
  onRemoved: () => void;
  onDestroyed: () => void;
}

const byHost = new Map<Container, LightRecord>();
const bySprite = new Map<Sprite, LightRecord>();
const active = new Set<LightRecord>();

let texture: Texture | null = null;
let pixels: Uint8ClampedArray | null = null;
let clockTime = DEFAULT_CLOCK_TIME;
let darknessMode: DarknessMode = 'normal';
let ambientBiome: string | undefined;
let lightLayer: Container | null = null;
let lightZoom = 1;
let focusX = 0;
let focusY = 0;
let nextOrder = 0;
let appliedStamp = '';

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function biomeBucket(biomeId: string | undefined): 'dark' | 'coast' | 'woods' {
  const id = canonicalBiomeId((biomeId ?? '').trim());
  if (id === 'trask' || id === 'ask') return 'dark';
  if (id === 'kust') return 'coast';
  return 'woods';
}

/**
 * Helskärms-alfa för nattens overlay.
 * Blend 0 är alltid dagvärdet 0,08, oavsett läge och biom.
 */
export function nightOverlayAlpha(blend: number, mode: DarknessMode, biomeId?: string): number {
  const t = clamp01(blend);
  if (t === 0) return DAY_OVERLAY_ALPHA;
  const target = NIGHT_TARGET[mode][biomeBucket(biomeId ?? ambientBiome)];
  return DAY_OVERLAY_ALPHA + (target - DAY_OVERLAY_ALPHA) * t;
}

/** Additiv sprite-alfa. 0 på full dag, elden starkast och hjälten svagast på natten. */
export function lightAlphaAt(blend: number, kind: LightKind, mode: DarknessMode = darknessMode): number {
  if (!(blend > 0)) return 0;
  const modeScale = mode === 'light' ? 0.9 : 1;
  return LIGHT_PEAK_ALPHA[kind] * clamp01(blend) * modeScale;
}

export function lightScaleFor(kind: LightKind): number {
  return LIGHT_SCALE[kind];
}

/** Runstenar lyser svagt. Tänd fackla och lykta också. Släckt fackla hoppas över. */
export function lightKindForDecorId(id: string): LightKind | null {
  const key = id.trim().toLowerCase();
  if (key === 'runsten' || key.includes('runsten')) return 'rune';
  if (key === 'fackla_stolpe') return 'torch';
  if (key === 'lykta_vag') return 'lamp';
  return null;
}

/** Okända id hoppas över. Bara de som faktiskt bär ljus. */
export function isGlowingMonsterId(id: string): boolean {
  return GLOWING_MONSTER_IDS.has(id);
}

export function lightGradientPixels(): Uint8ClampedArray {
  if (!pixels) pixels = paintLightGradient();
  return pixels;
}

/** Alfa 0–255 i den genererade gradienten. Hörnen ligger utanför cirkeln. */
export function lightPixelAlpha(x: number, y: number): number {
  if (x < 0 || y < 0 || x >= LIGHT_TEXTURE_SIZE || y >= LIGHT_TEXTURE_SIZE) return 0;
  return lightGradientPixels()[(y * LIGHT_TEXTURE_SIZE + x) * 4 + 3] ?? 0;
}

export function sharedLightTexture(): Texture {
  if (!texture || texture.destroyed) texture = makeLightTexture();
  return texture;
}

export function activeLightCount(): number {
  return active.size;
}

export function getDarknessMode(): DarknessMode {
  return darknessMode;
}

/** Overlay-lagret (skärmen, ovanpå nattens shade). Null återgår till syskonläge, för tester. */
export function bindLightLayer(layer: Container | null): void {
  lightLayer = layer && !layer.destroyed ? layer : null;
  for (const rec of active) placeSprite(rec);
}

/** Kamerans zoom så glöden på skärmlagret följer världen. */
export function setLightZoom(zoom: number): void {
  if (!Number.isFinite(zoom) || zoom <= 0) return;
  lightZoom = zoom;
}

export function setAmbientBiome(biomeId: string | undefined): void {
  const next = biomeId && biomeId.trim() ? biomeId : undefined;
  if (next === ambientBiome) return;
  ambientBiome = next;
}

export function setDarknessMode(mode: DarknessMode): void {
  if (darknessMode === mode) return;
  darknessMode = mode;
  refreshLightsIfNeeded(true);
}

export function setClockTime(timeSeconds: number): void {
  if (!Number.isFinite(timeSeconds)) return;
  clockTime = timeSeconds;
  refreshLightsIfNeeded(false);
}

/** Fokus för taket på 24. Världskoordinater, samma rum som ljuskällornas wx/wy. */
export function setLightFocus(wx: number, wy: number): void {
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
  focusX = wx;
  focusY = wy;
  refreshCap();
}

export function refreshLightCap(heroPos?: LightWorldPos): void {
  if (heroPos && Number.isFinite(heroPos.x) && Number.isFinite(heroPos.y)) {
    focusX = heroPos.x;
    focusY = heroPos.y;
  }
  refreshCap();
}

/** Sprite mot den delade texturen. Registreras först i attachLight. */
export function createLightSprite(kind: LightKind): Sprite {
  const sprite = new LightSprite(sharedLightTexture());
  sprite.anchor.set(0.5);
  sprite.scale.set(lightScaleFor(kind));
  sprite.tint = LIGHT_TINT[kind];
  sprite.blendMode = 'add';
  sprite.eventMode = 'none';
  sprite.alpha = lightAlphaAt(nightBlend(clockTime), kind, darknessMode);
  const show = sprite.alpha > 0;
  sprite.visible = show;
  sprite.renderable = show;
  return sprite;
}

/**
 * Ljus på host. Världsposition styr taket. Utan overlay-lager blir ljuset syskon
 * (eller barn om host är en container), samma idé som skuggorna.
 */
export function attachLight(host: Container, kind: LightKind, world?: LightWorldPos): Sprite {
  const prev = byHost.get(host);
  if (prev && !prev.sprite.destroyed) {
    writeWorld(prev, world);
    placeSprite(prev);
    return prev.sprite;
  }

  const sprite = createLightSprite(kind);
  const asChild = !lightLayer && !(host instanceof Sprite);
  const onAdded = (): void => {
    const rec = byHost.get(host);
    if (!rec || rec.forgotten) return;
    placeSprite(rec);
    applyState(rec);
  };
  const onRemoved = (): void => {
    const rec = byHost.get(host);
    if (!rec || rec.forgotten || rec.sprite.destroyed) return;
    if (lightLayer) {
      rec.sprite.visible = false;
      rec.sprite.renderable = false;
      return;
    }
    if (!rec.asChild) rec.sprite.removeFromParent();
  };
  const onDestroyed = (): void => {
    detachLight(host);
  };
  const rec: LightRecord = {
    host,
    sprite,
    kind,
    wx: host.position.x,
    wy: host.position.y,
    hasWorld: false,
    inCap: true,
    asChild,
    order: nextOrder++,
    forgotten: false,
    onAdded,
    onRemoved,
    onDestroyed,
  };
  writeWorld(rec, world);
  byHost.set(host, rec);
  bySprite.set(sprite, rec);
  active.add(rec);
  host.on('added', onAdded);
  host.on('removed', onRemoved);
  host.on('destroyed', onDestroyed);
  placeSprite(rec);
  refreshCap();
  return sprite;
}

/** Tar bort ljuset. Den delade texturen lämnas kvar. */
export function detachLight(host: Container): void {
  const rec = byHost.get(host);
  if (!rec) return;
  forget(rec);
  if (!rec.sprite.destroyed) rec.sprite.destroy({ texture: false, textureSource: false });
}

export function detachAll(): void {
  for (const rec of [...active]) detachLight(rec.host);
}

/** Flyttar ljuset till hostens skärmläge. Ny världsposition uppdaterar taket vid nästa cap-svep. */
export function syncLight(host: Container, world?: LightWorldPos): void {
  const rec = byHost.get(host);
  if (!rec || rec.sprite.destroyed) return;
  writeWorld(rec, world);
  placeSprite(rec);
}

/** Alla ljus till rätt skärmläge, sedan taket 24 mot senaste fokus. */
export function syncAllLights(): void {
  for (const rec of active) placeSprite(rec);
  refreshCap();
}

class LightSprite extends Sprite {
  override destroy(options?: DestroyOptions | boolean): void {
    if (this.destroyed) return;
    const rec = bySprite.get(this);
    if (rec) forget(rec);
    if (typeof options === 'boolean') super.destroy({ children: options, texture: false, textureSource: false });
    else super.destroy({ ...options, texture: false, textureSource: false });
  }
}

function writeWorld(rec: LightRecord, world: LightWorldPos | undefined): void {
  if (!world || !Number.isFinite(world.x) || !Number.isFinite(world.y)) return;
  rec.wx = world.x;
  rec.wy = world.y;
  rec.hasWorld = true;
}

function focusPoint(rec: LightRecord): { x: number; y: number } {
  if (rec.hasWorld) return { x: rec.wx, y: rec.wy };
  if (rec.host.destroyed) return { x: rec.wx, y: rec.wy };
  return { x: rec.host.position.x, y: rec.host.position.y };
}

function placeSprite(rec: LightRecord): void {
  const sprite = rec.sprite;
  const host = rec.host;
  if (sprite.destroyed || host.destroyed) return;
  const layer = lightLayer && !lightLayer.destroyed ? lightLayer : null;
  const zoom = layer ? lightZoom : 1;
  sprite.scale.set(lightScaleFor(rec.kind) * zoom);
  if (layer) {
    if (sprite.parent !== layer) layer.addChild(sprite);
    try {
      const local = layer.toLocal(host.getGlobalPosition());
      sprite.position.set(local.x, local.y);
    } catch {
      sprite.position.set(host.position.x, host.position.y);
    }
    return;
  }
  if (rec.asChild) {
    sprite.position.set(0, 0);
    if (sprite.parent !== host) host.addChild(sprite);
    return;
  }
  sprite.position.set(host.position.x, host.position.y);
  const parent = host.parent;
  if (parent && sprite.parent !== parent) parent.addChild(sprite);
}

function refreshCap(): void {
  const list = [...active];
  list.sort((a, b) => {
    const pa = focusPoint(a);
    const pb = focusPoint(b);
    const da = (pa.x - focusX) * (pa.x - focusX) + (pa.y - focusY) * (pa.y - focusY);
    const db = (pb.x - focusX) * (pb.x - focusX) + (pb.y - focusY) * (pb.y - focusY);
    if (da !== db) return da - db;
    return a.order - b.order;
  });
  const keep = Math.min(LIGHT_ACTIVE_CAP, list.length);
  for (let i = 0; i < list.length; i++) {
    const rec = list[i];
    if (!rec) continue;
    rec.inCap = i < keep;
    applyState(rec);
  }
}

function applyState(rec: LightRecord): void {
  const sprite = rec.sprite;
  if (sprite.destroyed) return;
  const alpha = lightAlphaAt(nightBlend(clockTime), rec.kind, darknessMode);
  const show = rec.inCap && alpha > 0;
  sprite.alpha = alpha;
  sprite.visible = show;
  sprite.renderable = show;
}

function refreshAll(): void {
  for (const rec of active) applyState(rec);
}

function refreshLightsIfNeeded(force: boolean): void {
  const stamp = `${nightBlend(clockTime).toFixed(4)}|${darknessMode}`;
  if (!force && stamp === appliedStamp) return;
  appliedStamp = stamp;
  refreshAll();
}

function forget(rec: LightRecord): void {
  if (rec.forgotten) return;
  rec.forgotten = true;
  rec.host.off('added', rec.onAdded);
  rec.host.off('removed', rec.onRemoved);
  rec.host.off('destroyed', rec.onDestroyed);
  byHost.delete(rec.host);
  bySprite.delete(rec.sprite);
  active.delete(rec);
}

function paintLightGradient(): Uint8ClampedArray {
  const size = LIGHT_TEXTURE_SIZE;
  const data = new Uint8ClampedArray(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const radius = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x - cx) / radius;
      const ny = (y - cy) / radius;
      const d = Math.sqrt(nx * nx + ny * ny);
      let a = 0;
      if (d < 1) {
        const t = 1 - d;
        a = t * t * (3 - 2 * t);
      }
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  return data;
}

function tryLightCanvas(px: Uint8ClampedArray): HTMLCanvasElement | OffscreenCanvas | null {
  const jsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
  if (!jsdom && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = LIGHT_TEXTURE_SIZE;
    canvas.height = LIGHT_TEXTURE_SIZE;
    const ctx = canvas.getContext('2d');
    if (ctx && putPixels(ctx, px)) return canvas;
  }
  if (typeof OffscreenCanvas === 'undefined') return null;
  try {
    const canvas = new OffscreenCanvas(LIGHT_TEXTURE_SIZE, LIGHT_TEXTURE_SIZE);
    const ctx = canvas.getContext('2d');
    if (ctx && putPixels(ctx, px)) return canvas;
  } catch {
    return null;
  }
  return null;
}

function putPixels(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, px: Uint8ClampedArray): boolean {
  try {
    const image = ctx.createImageData(LIGHT_TEXTURE_SIZE, LIGHT_TEXTURE_SIZE);
    image.data.set(px);
    ctx.putImageData(image, 0, 0);
    return true;
  } catch {
    return false;
  }
}

function makeLightTexture(): Texture {
  const px = lightGradientPixels();
  const canvas = tryLightCanvas(px);
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
      width: LIGHT_TEXTURE_SIZE,
      height: LIGHT_TEXTURE_SIZE,
      format: 'rgba8unorm',
      alphaMode: 'no-premultiply-alpha',
    }),
  });
}
