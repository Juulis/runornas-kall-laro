import type { RoadFamily } from './roadTileResolver';

/**
 * Procedur-tile 128×64, samma diamant som markplattorna:
 * |x−64|/64 + |y−32|/32 ≤ 1.
 *
 * Väderstreck i texturen, när norr är −y i världen:
 * topp (64,0) = norr, höger (127,32) = öster, botten (64,63) = söder, vänster (0,32) = väster.
 * Utanför diamanten och utanför vägkroppen är pixeln genomskinlig.
 * Kanten är mjuk och lite fransad i pixlarna, inte en hel ruta på eller av.
 */
export const ROAD_MASK_TEX_W = 128;
export const ROAD_MASK_TEX_H = 64;

const cache = new Map<string, Uint8ClampedArray>();

type RGB = [number, number, number];

function byte(n: number): number {
  if (n <= 0) return 0;
  if (n >= 255) return 255;
  return Math.round(n);
}

function hash01(x: number, y: number, salt: number): number {
  let h = (Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca6b) ^ Math.imul(salt | 0, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function normMask(mask: number): number {
  if (!Number.isFinite(mask)) return 0;
  const m = mask | 0;
  if (m < 0) return 0;
  if (m > 15) return 15;
  return m;
}

function familySalt(family: RoadFamily): number {
  if (family === 'stig_jord') return 11;
  if (family === 'vag_sten') return 29;
  if (family === 'vag_grus') return 47;
  return 71;
}

/** Avstånd till ett rakt segment i diamantens u/v (u höger, v nedåt). */
function distSeg(u: number, v: number, x0: number, y0: number, x1: number, y1: number): number {
  const abx = x1 - x0;
  const aby = y1 - y0;
  const ab2 = abx * abx + aby * aby;
  let t = ab2 < 1e-8 ? 0 : ((u - x0) * abx + (v - y0) * aby) / ab2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = u - (x0 + abx * t);
  const dy = v - (y0 + aby * t);
  return Math.hypot(dx, dy);
}

function distToMask(u: number, v: number, mask: number): number {
  if (mask === 0) return Math.hypot(u, v);
  let best = Number.POSITIVE_INFINITY;
  if (mask & 1) best = Math.min(best, distSeg(u, v, 0, 0, 0, -1));
  if (mask & 2) best = Math.min(best, distSeg(u, v, 0, 0, 1, 0));
  if (mask & 4) best = Math.min(best, distSeg(u, v, 0, 0, 0, 1));
  if (mask & 8) best = Math.min(best, distSeg(u, v, 0, 0, -1, 0));
  return best;
}

/** 0 vid armens spets så skarven mot grannen inte äts upp av fransen. */
function tipDamp(u: number, v: number, mask: number): number {
  const soften = (along: number): number => {
    if (along < 0.72) return 1;
    return Math.max(0, 1 - (along - 0.72) / 0.28);
  };
  let damp = 1;
  if (mask & 1 && v < 0 && Math.abs(u) < 0.35) damp = Math.min(damp, soften(-v));
  if (mask & 4 && v > 0 && Math.abs(u) < 0.35) damp = Math.min(damp, soften(v));
  if (mask & 2 && u > 0 && Math.abs(v) < 0.35) damp = Math.min(damp, soften(u));
  if (mask & 8 && u < 0 && Math.abs(v) < 0.35) damp = Math.min(damp, soften(-u));
  return damp;
}

function halfWidth(mask: number): number {
  if (mask === 0) return 0.2;
  if (mask === 15) return 0.58;
  return 0.36;
}

function edgeAlpha(margin: number, fringe: number): number {
  const t = margin / fringe;
  if (t >= 1) return 1;
  if (t <= 0) return 0;
  return t * t * (3 - 2 * t);
}

function colorAt(family: RoadFamily, u: number, v: number, x: number, y: number, salt: number): RGB {
  if (family === 'stig_jord') {
    const blot = hash01(x >> 2, y >> 2, salt);
    const base = mix([22, 14, 10], [36, 24, 16], blot);
    const speck = hash01(x, y, salt + 3);
    if (speck > 0.9) return mix(base, [52, 40, 30], 0.7);
    if (speck < 0.08) return mix(base, [14, 9, 6], 0.6);
    return base;
  }
  if (family === 'vag_sten') {
    const cell = 0.18;
    const uu = u + 1.25;
    const vv = v + 1.25;
    const cu = Math.floor(uu / cell);
    const cv = Math.floor(vv / cell);
    const fu = (uu - cu * cell) / cell;
    const fv = (vv - cv * cell) / cell;
    if (fu < 0.14 || fv < 0.14 || fu > 0.88 || fv > 0.88) return [30, 32, 30];
    if (hash01(cu, cv, salt) > 0.84) return mix([40, 52, 28], [52, 64, 34], hash01(x, y, salt));
    return mix([44, 46, 44], [70, 72, 68], hash01(cu + 2, cv + 5, salt + 1));
  }
  if (family === 'vag_grus') {
    const base = mix([58, 52, 44], [78, 70, 60], hash01(x >> 1, y >> 1, salt));
    const speck = hash01(x, y, salt + 5);
    if (speck > 0.85) return mix(base, [96, 88, 76], 0.65);
    if (speck < 0.12) return mix(base, [42, 36, 30], 0.55);
    return base;
  }
  const pitch = 0.15;
  const bv = v + 1.05;
  const band = Math.floor(bv / pitch);
  const f = bv / pitch - band;
  if (f < 0.14) return [22, 14, 10];
  const plank = hash01(band, 1, salt);
  const grain = hash01(x, band, salt + 4);
  return mix(plank > 0.5 ? [70, 46, 30] : [54, 34, 22], [80, 56, 36], grain * 0.5);
}

function paint(family: RoadFamily, mask: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(ROAD_MASK_TEX_W * ROAD_MASK_TEX_H * 4);
  const hw = halfWidth(mask);
  const salt = familySalt(family) * 17 + mask * 131;
  const fringe = 0.05;
  for (let y = 0; y < ROAD_MASK_TEX_H; y++) {
    for (let x = 0; x < ROAD_MASK_TEX_W; x++) {
      const u = (x - 64) / 64;
      const v = (y - 32) / 32;
      if (Math.abs(u) + Math.abs(v) > 1) continue;
      const dist = distToMask(u, v, mask);
      const damp = tipDamp(u, v, mask);
      const wobble = (hash01(x, y, salt) * 2 - 1) * 0.045 * damp;
      let alpha = edgeAlpha(hw + wobble - dist, fringe);
      if (alpha <= 0) continue;
      if (damp > 0.65 && dist > hw - 0.03 && hash01(x, y, salt + 17) > 0.93) alpha *= 0.45;
      const rgb = colorAt(family, u, v, x, y, salt);
      const i = (y * ROAD_MASK_TEX_W + x) * 4;
      px[i] = byte(rgb[0]);
      px[i + 1] = byte(rgb[1]);
      px[i + 2] = byte(rgb[2]);
      px[i + 3] = byte(alpha * 255);
    }
  }
  return px;
}

/** RGBA för familj och mask 0..15. Cachad. Genomskinlig utanför diamant och vägkropp. */
export function roadMaskPixels(family: RoadFamily, mask: number): Uint8ClampedArray {
  const m = normMask(mask);
  const key = `${family}_${m}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const px = paint(family, m);
  cache.set(key, px);
  return px;
}

/** Alfa 0–255. Utanför texturen räknas som 0. */
export function roadMaskPixelAlpha(family: RoadFamily, mask: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= ROAD_MASK_TEX_W || y >= ROAD_MASK_TEX_H) return 0;
  return roadMaskPixels(family, mask)[(y * ROAD_MASK_TEX_W + x) * 4 + 3] ?? 0;
}
