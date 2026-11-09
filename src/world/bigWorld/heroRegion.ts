import type { Vec2 } from '../../core/GameContext';
import { chebyshevChunkDist } from './ringZone';
import { resolveRegionAtChunk } from './regionIndex';
import { worldToChunk } from './bigWorldCoords';
import { getBigWorldCatalog } from './worldGenerator';

export { campStartPos, isInsideStartskogenChunk, isLegacyOnlySpawnChunk, runglantanWorldCenter } from './startskogenFootprint';

/** Hjälten i startskogens region (chebyshev ≤ radie) — legacy-kö och närhet. */
export function heroInsideStartskogenRegion(hero: Vec2): boolean {
  const region = getBigWorldCatalog().regionById.get('startskogen');
  if (!region) return false;
  const { cx, cy } = worldToChunk(hero.x, hero.y);
  const [rx, ry] = region.chunk;
  return chebyshevChunkDist(cx, cy, rx, ry) <= region.radie;
}

export function regionAtHero(hero: Vec2): ReturnType<typeof resolveRegionAtChunk> {
  const { cx, cy } = worldToChunk(hero.x, hero.y);
  return resolveRegionAtChunk(cx, cy, getBigWorldCatalog().data.regioner);
}
