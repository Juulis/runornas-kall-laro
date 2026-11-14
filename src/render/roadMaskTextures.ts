import { BufferImageSource, Texture } from 'pixi.js';
import { ROAD_MASK_TEX_H, ROAD_MASK_TEX_W, roadMaskPixels } from '../world/bigWorld/roadMaskPixels';
import { isProceduralRoadTile, parseRoadMaskTileId } from '../world/bigWorld/roadTileResolver';

/** Tillräckligt för att lägga in en textur. AssetStore och testkartor duger. */
export interface RoadTileStore {
  tiles: Map<string, Texture>;
}

const textures = new Map<string, Texture>();
const failed = new Set<string>();

function putPixels(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, px: Uint8ClampedArray): boolean {
  try {
    const image = ctx.createImageData(ROAD_MASK_TEX_W, ROAD_MASK_TEX_H);
    image.data.set(px);
    ctx.putImageData(image, 0, 0);
    return true;
  } catch {
    return false;
  }
}

function tryCanvas(px: Uint8ClampedArray): HTMLCanvasElement | OffscreenCanvas | null {
  const jsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
  if (!jsdom && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = ROAD_MASK_TEX_W;
    canvas.height = ROAD_MASK_TEX_H;
    const ctx = canvas.getContext('2d');
    if (ctx && putPixels(ctx, px)) return canvas;
  }
  if (typeof OffscreenCanvas === 'undefined') return null;
  try {
    const canvas = new OffscreenCanvas(ROAD_MASK_TEX_W, ROAD_MASK_TEX_H);
    const ctx = canvas.getContext('2d');
    if (ctx && putPixels(ctx, px)) return canvas;
  } catch {
    return null;
  }
  return null;
}

function textureFromPixels(px: Uint8ClampedArray): Texture {
  const canvas = tryCanvas(px);
  if (canvas) {
    try {
      return Texture.from(canvas, true);
    } catch {
      /* BufferImageSource när canvas inte kan bli en textur. */
    }
  }
  return new Texture({
    source: new BufferImageSource({
      resource: px,
      width: ROAD_MASK_TEX_W,
      height: ROAD_MASK_TEX_H,
      format: 'rgba8unorm',
      alphaMode: 'no-premultiply-alpha',
    }),
  });
}

/**
 * Bygg och cacha en mask-tile i minnet. Ingen png.
 * Null om id:t inte är en procedur-tile, eller om texturen inte gick att skapa.
 */
export function ensureProceduralRoadTile(assets: RoadTileStore, id: string): Texture | null {
  if (!isProceduralRoadTile(id)) return null;
  const existing = assets.tiles.get(id);
  if (existing && !existing.destroyed) return existing;
  const cached = textures.get(id);
  if (cached && !cached.destroyed) {
    assets.tiles.set(id, cached);
    return cached;
  }
  if (failed.has(id)) return null;
  const parsed = parseRoadMaskTileId(id);
  if (!parsed) return null;
  try {
    const tex = textureFromPixels(roadMaskPixels(parsed.family, parsed.mask));
    textures.set(id, tex);
    assets.tiles.set(id, tex);
    return tex;
  } catch (e) {
    failed.add(id);
    console.warn(`[stigkant] ${id} kunde inte ritas`, e);
    return null;
  }
}

/**
 * Sant om id:t är en mask-tile och därför inte ska hämtas som png.
 * Misslyckad ritning loggas och lämnar rutan tom så anroparen kan falla tillbaka.
 */
export function placeProceduralRoadTile(assets: RoadTileStore, id: string): boolean {
  if (!isProceduralRoadTile(id)) return false;
  ensureProceduralRoadTile(assets, id);
  return true;
}
