/** Issue #85 del 2: chunk-streaming kring hjälten (varld_stor + ChunkWorldCache). */
export const BIG_WORLD_STREAMING_ENABLED = true;

/** Chunkdata hålls laddad (Chebyshev) — större än render så avlastning inte fladdrar. */
export const BIG_WORLD_CACHE_KEEP_RADIUS = 3;

/** Synlig mark laddas inom denna radie (Chebyshev). 3×3 chunkar + vy-culling. */
export const BIG_WORLD_RENDER_RADIUS = 1;

/** Extra marginal (världsenheter) runt kamerans vy vid patch-culling. */
export const BIG_WORLD_GROUND_VIEW_MARGIN = 8;

/** Max ms tile-bygge per bildruta innan vi fortsätter nästa frame. */
export const BIG_WORLD_GROUND_BUILD_BUDGET_MS = 4;

/** Max chunk-monster som instansieras per frame. Högt nog att en tät chunk syns samma sekund. */
export const BIG_WORLD_MONSTER_SPAWN_BUDGET = 24;

/** Rutor per byggbatch (64×64 chunk → 4×4 delar à 16×16 för budget). */
export const BIG_WORLD_GROUND_PATCH_TILES = 16;

/**
 * Generatorregler: spel/design/varldsgenerator.json (+ varld_stor.json, bana1_stor.json).
 * world_seed = session.worldSeed (geografi), game_seed = session.seed (chunk-spawns m.m.).
 */
export const BIG_WORLD_DESIGN_REFS = [
  'spel/design/varldsgenerator.json',
  'spel/design/varld_stor.json',
  'spel/design/bana1_stor.json',
] as const;

/** Stor värld utan hård ytterkant (design meta.ytterkant saknar implementation — obegränsad värld). */
export const BIG_WORLD_UNBOUNDED = true;

/** Bakgrundsfärg i Renderer.init — pixelprov ska skilja sig från mark. */
export const BIG_WORLD_SKY_CLEAR_COLOR = 0x0d0f12;
