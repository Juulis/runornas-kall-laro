import type { Collider, Vec2 } from '../core/GameContext';

/** Cellstorlek i världsenheter. Kollisionshashen delar världen i rutor 8 × 8. */
export const COLLIDER_CELL = 8;

/** Unikt för cellindex inom ±2^25 (långt utanför spelvärlden). */
const PACK_BIAS = 1 << 25;
const PACK_SPAN = 1 << 26;

interface Node {
  c: Collider;
  ord: number;
  prev: Node | null;
  next: Node | null;
  /** null när cirkeln inte ligger i hashen (off vid push). 0 är en giltig nyckel. */
  cellKey: number | null;
}

function cellIndex(v: number): number {
  return Math.floor(v / COLLIDER_CELL);
}

function packCell(ix: number, iy: number): number {
  return (ix + PACK_BIAS) * PACK_SPAN + (iy + PACK_BIAS);
}

function lowerBound(bucket: readonly Node[], afterOrd: number): number {
  let lo = 0;
  let hi = bucket.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const node = bucket[mid];
    if (node !== undefined && node.ord <= afterOrd) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function sortByOrd(scratch: Node[], count: number): void {
  for (let a = 1; a < count; a++) {
    const node = scratch[a];
    if (node === undefined) continue;
    let b = a;
    while (b > 0) {
      const prev = scratch[b - 1];
      if (prev === undefined || prev.ord <= node.ord) break;
      scratch[b] = prev;
      b -= 1;
    }
    scratch[b] = node;
  }
}

/**
 * Kolliderare i insättningsordning, med hash för träfftest.
 * x/y antas fasta efter push — en flytt görs med remove och push igen.
 */
export class ColliderGrid {
  private head: Node | null = null;
  private tail: Node | null = null;
  private readonly nodes = new Map<Collider, Node>();
  private readonly cells = new Map<number, Node[]>();
  private readonly scratch: Node[] = [];
  private _length = 0;
  /** Cirklar som faktiskt kan träffa (inte off vid push). */
  private active = 0;
  private nextOrd = 1;
  private maxR = 0;
  private maxRDirty = false;

  get length(): number {
    return this._length;
  }

  push(c: Collider): void {
    if (this.nodes.has(c)) return;
    const node: Node = { c, ord: this.nextOrd++, prev: this.tail, next: null, cellKey: null };
    if (this.tail) this.tail.next = node;
    else this.head = node;
    this.tail = node;
    this.nodes.set(c, node);
    this._length += 1;
    if (c.off) return;
    this.linkHash(node);
  }

  /** Tar bort samma objektreferens. Gör inget om cirkeln inte finns. */
  remove(c: Collider): void {
    const node = this.nodes.get(c);
    if (node === undefined) return;
    this.nodes.delete(c);
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
    node.prev = null;
    node.next = null;
    this._length -= 1;
    if (node.cellKey === null) return;
    const bucket = this.cells.get(node.cellKey);
    if (bucket !== undefined) {
      const i = bucket.indexOf(node);
      if (i >= 0) bucket.splice(i, 1);
      if (bucket.length === 0) this.cells.delete(node.cellKey);
    }
    this.active -= 1;
    if (node.c.r >= this.maxR) this.maxRDirty = true;
  }

  *[Symbol.iterator](): IterableIterator<Collider> {
    for (let n = this.head; n; n = n.next) yield n.c;
  }

  every(predicate: (c: Collider, index: number) => boolean): boolean {
    let i = 0;
    for (let n = this.head; n; n = n.next) {
      if (!predicate(n.c, i)) return false;
      i += 1;
    }
    return true;
  }

  /**
   * Puttar ut p ur cirklar i insättningsordning (hoppar över off).
   * Hashen cullar bara kandidater. Flyttas p till nya celler frågas hashen igen,
   * utan att redan behandlade cirklar tas om.
   */
  resolve(p: Vec2, r: number): void {
    if (this.active === 0) return;
    const reach = r + this.currentMaxR() + 1e-7;
    let after = 0;
    let x0 = Math.floor((p.x - reach) / COLLIDER_CELL);
    let x1 = Math.floor((p.x + reach) / COLLIDER_CELL);
    let y0 = Math.floor((p.y - reach) / COLLIDER_CELL);
    let y1 = Math.floor((p.y + reach) / COLLIDER_CELL);
    let count = this.fill(x0, x1, y0, y1, after);
    let i = 0;
    let guard = 0;
    while (i < count && guard < this.active) {
      const node = this.scratch[i];
      i += 1;
      guard += 1;
      if (node === undefined) break;
      after = node.ord;
      const c = node.c;
      if (c.off) continue;
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const d = Math.hypot(dx, dy);
      const m = c.r + r;
      if (d < m && d > 1e-4) {
        const ox = p.x;
        const oy = p.y;
        p.x = c.x + (dx / d) * m;
        p.y = c.y + (dy / d) * m;
        if (p.x !== ox || p.y !== oy) {
          const nx0 = Math.floor((p.x - reach) / COLLIDER_CELL);
          const nx1 = Math.floor((p.x + reach) / COLLIDER_CELL);
          const ny0 = Math.floor((p.y - reach) / COLLIDER_CELL);
          const ny1 = Math.floor((p.y + reach) / COLLIDER_CELL);
          if (nx0 !== x0 || nx1 !== x1 || ny0 !== y0 || ny1 !== y1) {
            x0 = nx0;
            x1 = nx1;
            y0 = ny0;
            y1 = ny1;
            count = this.fill(x0, x1, y0, y1, after);
            i = 0;
          }
        }
      }
    }
  }

  private linkHash(node: Node): void {
    const key = packCell(cellIndex(node.c.x), cellIndex(node.c.y));
    node.cellKey = key;
    let bucket = this.cells.get(key);
    if (bucket === undefined) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    bucket.push(node);
    this.active += 1;
    if (!this.maxRDirty && node.c.r > this.maxR) this.maxR = node.c.r;
    else if (this.maxRDirty && node.c.r >= this.maxR) {
      this.maxR = node.c.r;
      this.maxRDirty = false;
    }
  }

  private currentMaxR(): number {
    if (!this.maxRDirty) return this.maxR;
    let m = 0;
    for (let n = this.head; n; n = n.next) {
      if (n.cellKey !== null && n.c.r > m) m = n.c.r;
    }
    this.maxR = m;
    this.maxRDirty = false;
    return m;
  }

  private fill(x0: number, x1: number, y0: number, y1: number, afterOrd: number): number {
    const scratch = this.scratch;
    let count = 0;
    let buckets = 0;
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const bucket = this.cells.get(packCell(ix, iy));
        if (bucket === undefined || bucket.length === 0) continue;
        buckets += 1;
        const start = lowerBound(bucket, afterOrd);
        for (let k = start; k < bucket.length; k++) {
          const node = bucket[k];
          if (node !== undefined) scratch[count++] = node;
        }
      }
    }
    if (buckets > 1 && count > 1) sortByOrd(scratch, count);
    return count;
  }
}
