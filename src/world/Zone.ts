import type { Collider, PortalView, RuneView, Vec2, ZoneView } from '../core/GameContext';

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export type ZoneName = 'forest' | 'village' | 'wolfstead' | 'dimmerstrand' | 'kopparberg' | 'askeborg';

/** En spelzon i världsenheter: gränser, kolliderare, runor, portaler och arena. Implementerar ZoneView för moduler. */
export class Zone implements ZoneView {
  colliders: Collider[] = [];
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

  /** Puttar ut en cirkel ur kolliderare och håller den inom zonen. */
  collide(p: Vec2, r: number): void {
    for (const c of this.colliders) {
      if (c.off) continue;
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const d = Math.hypot(dx, dy);
      const m = c.r + r;
      if (d < m && d > 1e-4) {
        p.x = c.x + (dx / d) * m;
        p.y = c.y + (dy / d) * m;
      }
    }
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
}
