import { Rng } from '../../core/Rng';

/** Första oktavens cellbredd i världsrutor. Typiska fläckar landar runt 8–20. */
const OCTAVE0_TILES = 14;
/** Andra oktaven har ungefär dubbel frekvens. */
const OCTAVE1_TILES = 7;
const OCTAVE0_WEIGHT = 0.7;
const OCTAVE1_WEIGHT = 0.3;

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Gittervärde i [0, 1). Samma seed och gitterpunkt ger alltid samma tal. */
function latticeValue(worldSeed: number, ix: number, iy: number, octave: number): number {
  return new Rng(Rng.hash(worldSeed, 'markbrus', octave, ix, iy)).next();
}

interface NoiseCell {
  seed: number;
  x: number;
  y: number;
  v00: number;
  v10: number;
  v01: number;
  v11: number;
}

function freshCell(): NoiseCell {
  return { seed: 0, x: Number.NaN, y: Number.NaN, v00: 0, v10: 0, v01: 0, v11: 0 };
}

/** Senaste cellen per oktav. Grannrutor i samma cell delar fyra gittervärden. */
const cell0 = freshCell();
const cell1 = freshCell();

function cellCorners(worldSeed: number, x0: number, y0: number, octave: number): readonly [number, number, number, number] {
  const cell = octave === 0 ? cell0 : cell1;
  if (cell.seed === worldSeed && cell.x === x0 && cell.y === y0) {
    return [cell.v00, cell.v10, cell.v01, cell.v11];
  }
  cell.seed = worldSeed;
  cell.x = x0;
  cell.y = y0;
  cell.v00 = latticeValue(worldSeed, x0, y0, octave);
  cell.v10 = latticeValue(worldSeed, x0 + 1, y0, octave);
  cell.v01 = latticeValue(worldSeed, x0, y0 + 1, octave);
  cell.v11 = latticeValue(worldSeed, x0 + 1, y0 + 1, octave);
  return [cell.v00, cell.v10, cell.v01, cell.v11];
}

function valueNoiseOctave(worldSeed: number, x: number, y: number, octave: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const sx = fade(x - x0);
  const sy = fade(y - y0);
  const [v00, v10, v01, v11] = cellCorners(worldSeed, x0, y0, octave);
  return lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy);
}

/**
 * Värdebrus i världens rutkoordinater, två oktaver, ungefär [0, 1].
 * Bara worldSeed och (gx, gy) ingår, så samma ruta ger samma värde oavsett chunk.
 */
export function worldValueNoise(worldSeed: number, gx: number, gy: number): number {
  const n0 = valueNoiseOctave(worldSeed, gx / OCTAVE0_TILES, gy / OCTAVE0_TILES, 0);
  const n1 = valueNoiseOctave(worldSeed, gx / OCTAVE1_TILES, gy / OCTAVE1_TILES, 1);
  return n0 * OCTAVE0_WEIGHT + n1 * OCTAVE1_WEIGHT;
}
