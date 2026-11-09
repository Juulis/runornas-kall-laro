import type { Vec2 } from '../../core/GameContext';
import { DATA } from '../../data';
import { chunkCenterWorld } from './bigWorldCoords';

/** Lätta fotavtrycksfunktioner. Ingen världsgenerator — den laddas separat. */

/** Chunk [1,1] (Rungläntan) — endast legacy spawnzoner, ingen chunk-genererad spawn. */
export function isLegacyOnlySpawnChunk(cx: number, cy: number): boolean {
  const fp = DATA.varldStor.meta.startskogen_fotavtryck?.chunk ?? [1, 1];
  return cx === fp[0] && cy === fp[1];
}

/** @deprecated använd isLegacyOnlySpawnChunk för spawn-system */
export function isInsideStartskogenChunk(cx: number, cy: number): boolean {
  return isLegacyOnlySpawnChunk(cx, cy);
}

/** Hjältens start vid lägret (design start_pos), inte Rungläntan. */
export function campStartPos(): Vec2 {
  const p = DATA.varldStor.meta.startskogen_fotavtryck?.start_pos;
  if (p && p.length === 2) return { x: p[0], y: p[1] };
  return { x: -128, y: -132 };
}

/** Världsposition för Rungläntans mitt (0,0). */
export function runglantanWorldCenter(): Vec2 {
  const fp = DATA.varldStor.meta.startskogen_fotavtryck?.chunk ?? [1, 1];
  return chunkCenterWorld(fp[0], fp[1]);
}
