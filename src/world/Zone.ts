import type { PortalView, RuneView, Vec2, ZoneView } from '../core/GameContext';
import { TILE_WORLD } from '../render/Iso';
import { chunkMinWorld, chunkTileCount, worldToChunk } from './bigWorld/bigWorldCoords';
import { ColliderGrid } from './ColliderGrid';

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export type ZoneName = 'forest' | 'village' | 'wolfstead' | 'dimmerstrand' | 'kopparberg' | 'askeborg';

function blockedChunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** En spelzon i världsenheter: gränser, kolliderare, runor, portaler och arena. Implementerar ZoneView för moduler. */
export class Zone implements ZoneView {
  colliders = new ColliderGrid();
  /** Bitmask per chunk: en ruta är TILE_WORLD, en chunk är chunkTileCount() × chunkTileCount() rutor. */
  private readonly blockedMasks = new Map<string, Uint8Array>();
  runes: RuneView[] = [];
  portals: PortalView[] = [];
  cleared: Record<string, boolean> = {};
  circle?: number;
  rect?: readonly [number, number];
  arena: Rect | null = null;
  /** Fri cirkel där monster inte vandrar in. Mittpunkten är safeCenter (lägrets eld i stor värld, origo i legacy-skog). */
  safeRadius = 0;
  safeCenter: Vec2 = { x: 0, y: 0 };
  /** varld_stor chunk-streaming (#85 del 2) — ingen spawnzoner-rullning, obegränsad vandring. */
  bigWorldStreaming = false;
  entry: Vec2 = { x: 0, y: 0 };
  /** Spawnområdets koordinater är rutor (byn): T(tx,ty) = ((tx-15.5)*2, (ty-15.5)*2). */
  tileCoords = false;

  constructor(
    public name: ZoneName,
    public areaId: string,
    public width: number,
    public height: number,
  ) {}

  /** Byns ruta → världsposition. */
  static T(tx: number, ty: number): Vec2 {
    return { x: (tx - 15.5) * 2, y: (ty - 15.5) * 2 };
  }

  toWorld(p: readonly [number, number]): Vec2 {
    return this.tileCoords ? Zone.T(p[0], p[1]) : { x: p[0], y: p[1] };
  }

  /** Puttar ut en cirkel ur kolliderare och håller den inom zonen. Läser inte blocked. */
  collide(p: Vec2, r: number): void {
    this.colliders.resolve(p, r);
    if (this.circle) {
      const d = Math.hypot(p.x, p.y);
      const lim = this.circle - r;
      if (d > lim) {
        p.x *= lim / d;
        p.y *= lim / d;
      }
    } else if (this.rect) {
      const [a, b] = this.rect;
      p.x = Math.max(a + r, Math.min(b - r, p.x));
      p.y = Math.max(a + r, Math.min(b - r, p.y));
    }
  }

  inArena(p: Vec2): boolean {
    const a = this.arena;
    return !!a && p.x > a.x0 - 1 && p.x < a.x1 + 1 && p.y > a.y0 - 1 && p.y < a.y1;
  }

  contains(p: Vec2): boolean {
    if (this.circle) return Math.hypot(p.x, p.y) < this.circle;
    if (this.rect) return p.x > this.rect[0] && p.x < this.rect[1] && p.y > this.rect[0] && p.y < this.rect[1];
    return true;
  }

  /**
   * Sant om rutan (2 världsenheter) är spärrad. Default är gångbar.
   * Används senare av vatten — påverkar inte collide i det här steget.
   */
  blocked(wx: number, wy: number): boolean {
    const at = this.blockedAt(wx, wy);
    if (!at) return false;
    const mask = this.blockedMasks.get(at.key);
    if (mask === undefined) return false;
    const byte = mask[at.bit >> 3] ?? 0;
    return ((byte >> (at.bit & 7)) & 1) === 1;
  }

  /** Sätter eller tar bort spärren på rutan som innehåller (wx, wy). */
  setBlocked(wx: number, wy: number, value: boolean): void {
    const at = this.blockedAt(wx, wy);
    if (!at) return;
    const byteIndex = at.bit >> 3;
    const bitIn = at.bit & 7;
    let mask = this.blockedMasks.get(at.key);
    if (mask === undefined) {
      if (!value) return;
      const tiles = chunkTileCount();
      mask = new Uint8Array(Math.ceil((tiles * tiles) / 8));
      this.blockedMasks.set(at.key, mask);
    }
    const cur = mask[byteIndex] ?? 0;
    if (value) {
      mask[byteIndex] = cur | (1 << bitIn);
      return;
    }
    const next = cur & ~(1 << bitIn);
    mask[byteIndex] = next;
    if (next !== 0) return;
    for (let i = 0; i < mask.length; i++) {
      if ((mask[i] ?? 0) !== 0) return;
    }
    this.blockedMasks.delete(at.key);
  }

  /** Glömmer hela chunkens bitmask så en urlastad chunk inte läcker spärrar. */
  clearBlockedChunk(cx: number, cy: number): void {
    this.blockedMasks.delete(blockedChunkKey(cx, cy));
  }

  private blockedAt(wx: number, wy: number): { key: string; bit: number } | null {
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null;
    const { cx, cy } = worldToChunk(wx, wy);
    const min = chunkMinWorld(cx, cy);
    const tiles = chunkTileCount();
    const ti = Math.floor((wx - min.x) / TILE_WORLD);
    const tj = Math.floor((wy - min.y) / TILE_WORLD);
    if (ti < 0 || tj < 0 || ti >= tiles || tj >= tiles) return null;
    return { key: blockedChunkKey(cx, cy), bit: tj * tiles + ti };
  }
}
