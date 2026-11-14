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

/** Överlapp mindre än så här räknas som tangerande och puttas inte. */
const BLOCK_SKIN = 1e-4;

const BLOCK_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

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

  /**
   * Puttar ut en cirkel ur kolliderare och spärrade rutor, och håller den inom zonen.
   * Utan spärrade rutor är resultatet detsamma som bara cirkel/rektangel.
   */
  collide(p: Vec2, r: number): void {
    this.colliders.resolve(p, r);
    this.pushOutOfBlocked(p, r);
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

  /** Sant om rutan (2 världsenheter) är spärrad. Default är gångbar. Vatten sätter biten. */
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

  /**
   * Cirkel mot axelräta spärrutor, efter cirkelresolving.
   * Närmaste kant. En kropp som bara tangerar flyttas inte.
   * Står mitten redan i en spärrad ruta puttas den till närmaste gångbara punkt.
   */
  private pushOutOfBlocked(p: Vec2, r: number): void {
    if (this.blockedMasks.size === 0 || !(r > 0)) return;
    for (let pass = 0; pass < 12; pass++) {
      const x = p.x;
      const y = p.y;
      if (this.blocked(p.x, p.y)) {
        if (!this.ejectBlockedCenter(p, r)) return;
      } else {
        const hit = this.deepestBlockedOverlap(p.x, p.y, r);
        if (!hit) return;
        p.x += hit.x;
        p.y += hit.y;
      }
      if (p.x === x && p.y === y) return;
    }
  }

  private deepestBlockedOverlap(px: number, py: number, r: number): { x: number; y: number } | null {
    const tw = TILE_WORLD;
    const gx0 = Math.floor((px - r) / tw);
    const gx1 = Math.floor((px + r) / tw);
    const gy0 = Math.floor((py - r) / tw);
    const gy1 = Math.floor((py + r) / tw);
    let bestPen = BLOCK_SKIN;
    let bestX = 0;
    let bestY = 0;
    let bestGx = 0;
    let bestGy = 0;
    let found = false;
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const x0 = gx * tw;
        const y0 = gy * tw;
        const x1 = x0 + tw;
        const y1 = y0 + tw;
        if (!this.blocked(x0 + tw * 0.5, y0 + tw * 0.5)) continue;
        const cx = px < x0 ? x0 : px > x1 ? x1 : px;
        const cy = py < y0 ? y0 : py > y1 ? y1 : py;
        const dx = px - cx;
        const dy = py - cy;
        const dist2 = dx * dx + dy * dy;
        let pushX: number;
        let pushY: number;
        let pen: number;
        if (dist2 <= 1e-12) {
          // Mitten ligger på rutans kant men floor() säger att den är fri. Puta ut längs normalen.
          let nx = 0;
          let ny = 0;
          if (px <= x0 + 1e-12) nx = -1;
          else if (px >= x1 - 1e-12) nx = 1;
          if (py <= y0 + 1e-12) ny = -1;
          else if (py >= y1 - 1e-12) ny = 1;
          if (nx === 0 && ny === 0) continue;
          const len = Math.hypot(nx, ny);
          pen = r;
          pushX = (nx / len) * r;
          pushY = (ny / len) * r;
        } else {
          const dist = Math.sqrt(dist2);
          if (dist >= r - BLOCK_SKIN) continue;
          pen = r - dist;
          const scale = pen / dist;
          pushX = dx * scale;
          pushY = dy * scale;
        }
        const nearer = pen > bestPen + 1e-9;
        const tie = !nearer && Math.abs(pen - bestPen) <= 1e-9 && (gx < bestGx || (gx === bestGx && gy < bestGy));
        if (!found || nearer || tie) {
          bestPen = pen;
          bestX = pushX;
          bestY = pushY;
          bestGx = gx;
          bestGy = gy;
          found = true;
        }
      }
    }
    if (!found) return null;
    return { x: bestX, y: bestY };
  }

  /** Mitten står i en spärrad ruta. Flytta till närmaste kant där cirkeln är ute. */
  private ejectBlockedCenter(p: Vec2, r: number): boolean {
    const tw = TILE_WORLD;
    const startGx = Math.floor(p.x / tw);
    const startGy = Math.floor(p.y / tw);
    const tiles: { gx: number; gy: number }[] = [];
    const seen = new Set<string>();
    const queue: { gx: number; gy: number }[] = [{ gx: startGx, gy: startGy }];
    seen.add(`${startGx},${startGy}`);
    let qi = 0;
    while (qi < queue.length && tiles.length < 64) {
      const cur = queue[qi];
      qi += 1;
      if (!cur) break;
      if (!this.blocked(cur.gx * tw + tw * 0.5, cur.gy * tw + tw * 0.5)) continue;
      tiles.push(cur);
      for (const [dx, dy] of BLOCK_DIRS) {
        const nx = cur.gx + dx;
        const ny = cur.gy + dy;
        const key = `${nx},${ny}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({ gx: nx, gy: ny });
      }
    }
    let bestD = Number.POSITIVE_INFINITY;
    let bestX = p.x;
    let bestY = p.y;
    for (const tile of tiles) {
      const x0 = tile.gx * tw;
      const y0 = tile.gy * tw;
      const x1 = x0 + tw;
      const y1 = y0 + tw;
      for (const [dx, dy] of BLOCK_DIRS) {
        const nx = tile.gx + dx;
        const ny = tile.gy + dy;
        if (this.blocked(nx * tw + tw * 0.5, ny * tw + tw * 0.5)) continue;
        const fx0 = nx * tw;
        const fy0 = ny * tw;
        const fx1 = fx0 + tw;
        const fy1 = fy0 + tw;
        let tx = dx < 0 ? x0 - r : dx > 0 ? x1 + r : p.x;
        let ty = dy < 0 ? y0 - r : dy > 0 ? y1 + r : p.y;
        // Håll den andra axeln inne i den fria grannen, annars glider man in i nästa vattenruta.
        if (dx !== 0) {
          if (ty < fy0) ty = fy0;
          else if (ty >= fy1) ty = fy1 - 1e-4;
        } else if (tx < fx0) tx = fx0;
        else if (tx >= fx1) tx = fx1 - 1e-4;
        if (this.blocked(tx, ty)) {
          tx = dx !== 0 ? (dx < 0 ? fx1 - Math.min(r, tw * 0.5) : fx0 + Math.min(r, tw * 0.5)) : (fx0 + fx1) * 0.5;
          ty = dy !== 0 ? (dy < 0 ? fy1 - Math.min(r, tw * 0.5) : fy0 + Math.min(r, tw * 0.5)) : (fy0 + fy1) * 0.5;
          if (this.blocked(tx, ty)) continue;
        }
        const dist = Math.hypot(tx - p.x, ty - p.y);
        const nearer = dist < bestD - 1e-9;
        const tie = Math.abs(dist - bestD) <= 1e-9 && (tx < bestX - 1e-9 || (Math.abs(tx - bestX) <= 1e-9 && ty < bestY));
        if (nearer || tie) {
          bestD = dist;
          bestX = tx;
          bestY = ty;
        }
      }
    }
    if (!Number.isFinite(bestD)) return false;
    p.x = bestX;
    p.y = bestY;
    return true;
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
