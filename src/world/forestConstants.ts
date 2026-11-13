import type { PlayableCityZone } from './cityZones';

/** Bana 1 (Startskogen): ~10× yta jämfört med ursprunglig radie 45. */
export const FOREST_LEGACY_RADIUS = 45;
export const FOREST_AREA_SCALE = 10;
export const FOREST_PLAY_RADIUS = FOREST_LEGACY_RADIUS * Math.sqrt(FOREST_AREA_SCALE);
export const FOREST_SAFE_RADIUS = 12 * Math.sqrt(FOREST_AREA_SCALE);
export const FOREST_TILE_CUTOFF = FOREST_PLAY_RADIUS * (58 / 45);
export const FOREST_DECOR_OUTER = FOREST_PLAY_RADIUS * (57 / 45);
export const FOREST_DECOR_MID = FOREST_PLAY_RADIUS * (44 / 45);
/** Monster instansieras när hjälten är inom detta avstånd (världsenheter). */
export const FOREST_SPAWN_ACTIVE_RADIUS = 52;
/** Högst så många levande monster inom FOREST_SPAWN_ACTIVE_RADIUS. */
export const MAX_LIVE_MONSTERS = 60;
/** Mark-chunks laddas inom denna radie runt hjälten. */
export const FOREST_GROUND_CHUNK_RADIUS = 70;
export const FOREST_GROUND_CHUNK_TILES = 16;
/** Östra vägport till Vargaby (världsenheter). */
export const FOREST_VARGABY_PORTAL_X = FOREST_PLAY_RADIUS - 10;
export const FOREST_VARGABY_PORTAL_Y = 0;

/** Skogsportar till spelbara städer (inga spärrar — bara resa). */
export const FOREST_CITY_PORTALS: Readonly<Record<PlayableCityZone, { x: number; y: number }>> = {
  wolfstead: { x: FOREST_VARGABY_PORTAL_X, y: FOREST_VARGABY_PORTAL_Y },
  dimmerstrand: { x: -(FOREST_PLAY_RADIUS - 10), y: 0 },
  kopparberg: { x: 0, y: -(FOREST_PLAY_RADIUS - 10) },
  askeborg: { x: 0, y: FOREST_PLAY_RADIUS - 10 },
};
