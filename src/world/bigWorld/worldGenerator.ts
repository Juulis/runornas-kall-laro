import { DATA } from '../../data';
import type { BigWorldDataFile, BigWorldRegion } from '../../data/bigWorldTypes';
import type { EliteKind } from '../../data/types';
import { Rng } from '../../core/Rng';
import { TILE_WORLD } from '../../render/Iso';
import { blendBiomesAtChunk, biomeRenderPlaceholders, isTownBiomeChunk } from './biomeBlend';
import type { DecorLayerPool } from './decorPlanner';
import { chunkSpawnToWorld } from './bigWorldCoords';
import { buildRoadIndex, roadTileInChunk, roadsAtChunk, type RoadIndex } from './roads';
import { resolveRegionAtChunk } from './regionIndex';
import { chunkDistanceFromStart, ringAtChunkDistance } from './ringZone';
import { planMellanmarkSpawn, filterSubtypesByBand, regionSpawnLevelBand, mellanmarkLevelBand } from './spawnRules';
import {
  MELLANMARK_GROUP_MAX,
  MELLANMARK_GROUP_MIN,
  MELLANMARK_GROUP_SEPARATION,
  MELLANMARK_GROUP_SPREAD,
  mellanmarkChampionRoll,
  mellanmarkSpawnCountRange,
  regionSpawnCountRange,
  roadSkipRadius,
  skipSpawnNearRoad,
  spawnTileNearRoad,
  subtypeSpawnWeight,
} from './spawnDensity';
import { CAMP_SAFE_RADIUS, campFirePos, START_POS_SAFE_RADIUS } from './campMonsterField';
import { campStartPos, isLegacyOnlySpawnChunk } from './startskogenFootprint';
import { regionMonsterPerGame } from './regionSpawnBudget';

export interface BigWorldSpawnRoll {
  uid: string;
  enemy: string;
  level: number;
  localX: number;
  localY: number;
  elite?: EliteKind | null;
}

export interface ChunkWorldData {
  cx: number;
  cy: number;
  chunkSeed: number;
  distanceChunks: number;
  ring: number;
  levelBand: [number, number];
  mellanmark: boolean;
  regionId: string;
  regionTyp: string;
  biomeId: string;
  biomeBlend: ReturnType<typeof blendBiomesAtChunk>;
  roads: string[];
  roadTypes: string[];
  pois: string[];
  safe: boolean;
  act: string | null;
  access: string;
  monsterFamily: string | null;
  spawnSubtypes: string[];
  generatedSpawn: boolean;
  tilePool: string[];
  decorPool: string[];
  decorLayers: DecorLayerPool;
  music: 'explore' | 'town';
  spawns: BigWorldSpawnRoll[];
}

export interface BigWorldCatalog {
  data: BigWorldDataFile;
  roads: RoadIndex;
  regionById: Map<string, BigWorldRegion>;
  poisByRegionChunk: Map<string, string[]>;
  startChunk: readonly [number, number];
}

let catalogSingleton: BigWorldCatalog | null = null;

export function buildBigWorldCatalog(data: BigWorldDataFile): BigWorldCatalog {
  const roads = buildRoadIndex(data.vagar, data.regioner);
  const regionById = new Map(data.regioner.map((r) => [r.id, r]));
  const poisByRegionChunk = new Map<string, string[]>();
  for (const poi of data.pois) {
    const region = regionById.get(poi.region);
    if (!region) continue;
    const k = `${region.chunk[0]},${region.chunk[1]}`;
    const list = poisByRegionChunk.get(k) ?? [];
    list.push(poi.id);
    poisByRegionChunk.set(k, list);
  }
  return {
    data,
    roads,
    regionById,
    poisByRegionChunk,
    startChunk: data.meta.startpunkt.chunk,
  };
}

export function resetBigWorldCatalogCache(): void {
  catalogSingleton = null;
}

export function getBigWorldCatalog(): BigWorldCatalog {
  if (catalogSingleton) return catalogSingleton;
  catalogSingleton = buildBigWorldCatalog(DATA.varldStor);
  return catalogSingleton;
}

function chunkLayoutSeed(worldSeed: number, cx: number, cy: number): number {
  return Rng.hash('chunk', worldSeed, cx, cy);
}

function chunkSpawnRollSeed(gameSeed: number, cx: number, cy: number): number {
  return Rng.hash('spawn', gameSeed, cx, cy);
}

/** Publik för cache-validering (world_seed per chunk). */
export function chunkWorldSeed(worldSeed: number, cx: number, cy: number): number {
  return chunkLayoutSeed(worldSeed, cx, cy);
}

function primaryBiomeAt(catalog: BigWorldCatalog, cx: number, cy: number): { region: BigWorldRegion; mellanmark: boolean } {
  const { region, inside } = resolveRegionAtChunk(cx, cy, catalog.data.regioner);
  return { region, mellanmark: !inside };
}

/** Samma biom som chunkens region. TransitionResolver använder den här, inte en egen karta. */
export function chunkRegionBiome(cx: number, cy: number, catalog: BigWorldCatalog = getBigWorldCatalog()): string {
  return primaryBiomeAt(catalog, cx, cy).region.biom;
}

function neighborBiomeFactory(catalog: BigWorldCatalog): (ncx: number, ncy: number) => string {
  return (ncx, ncy) => primaryBiomeAt(catalog, ncx, ncy).region.biom;
}

const GROUP_MAX = 4;

/** Gruppstorlekar 2 till 4 som summerar exakt till target. Snitt cirka 3. */
function planGroupSizes(rng: Rng, total: number): number[] {
  const sizes: number[] = [];
  let left = total;
  while (left > 0) {
    if (left <= MELLANMARK_GROUP_MAX) {
      if (left < MELLANMARK_GROUP_MIN && sizes.length > 0) {
        const prev = sizes.pop() ?? MELLANMARK_GROUP_MIN;
        const merged = prev + left;
        if (merged <= MELLANMARK_GROUP_MAX) sizes.push(merged);
        else sizes.push(MELLANMARK_GROUP_MIN, merged - MELLANMARK_GROUP_MIN);
      } else if (left >= MELLANMARK_GROUP_MIN) {
        sizes.push(left);
      }
      break;
    }
    let size = rng.int([MELLANMARK_GROUP_MIN, MELLANMARK_GROUP_MAX]);
    if (left - size < MELLANMARK_GROUP_MIN) size = left - MELLANMARK_GROUP_MIN;
    sizes.push(size);
    left -= size;
  }
  return sizes;
}

function centersSeparated(x: number, y: number, chosen: readonly { x: number; y: number }[]): boolean {
  const min2 = MELLANMARK_GROUP_SEPARATION * MELLANMARK_GROUP_SEPARATION;
  for (const c of chosen) {
    const dx = (x - c.x) * TILE_WORLD;
    const dy = (y - c.y) * TILE_WORLD;
    if (dx * dx + dy * dy < min2) return false;
  }
  return true;
}

/** Rutnät med jitter så centra hamnar minst MELLANMARK_GROUP_SEPARATION isär. */
function pickGroupCenters(
  rng: Rng,
  count: number,
  tileSize: number,
  accept: (x: number, y: number) => boolean,
): { x: number; y: number }[] {
  const margin = 8;
  const minTiles = MELLANMARK_GROUP_SEPARATION / TILE_WORLD;
  const step = minTiles + 1;
  const jitter = (step - minTiles) * 0.4;
  const lo = margin + step / 2;
  const hi = tileSize - margin - step / 2;
  const candidates: { x: number; y: number }[] = [];
  for (let x = lo; x <= hi + 1e-6; x += step) {
    for (let y = lo; y <= hi + 1e-6; y += step) {
      candidates.push({
        x: x + (rng.next() - 0.5) * 2 * jitter,
        y: y + (rng.next() - 0.5) * 2 * jitter,
      });
    }
  }
  const chosen: { x: number; y: number }[] = [];
  for (const p of rng.shuffle(candidates)) {
    if (chosen.length >= count) break;
    if (!centersSeparated(p.x, p.y, chosen)) continue;
    if (!accept(p.x, p.y)) continue;
    chosen.push(p);
  }
  let guard = 0;
  while (chosen.length < count && guard < 500) {
    guard++;
    const x = rng.float(margin, tileSize - margin);
    const y = rng.float(margin, tileSize - margin);
    if (!centersSeparated(x, y, chosen)) continue;
    if (!accept(x, y)) continue;
    chosen.push({ x, y });
  }
  return chosen;
}

/** Symmetrisk ring så gruppens tyngdpunkt blir centret. Radie cirka 3 världsenheter. */
function placeSymmetricGroup(
  rng: Rng,
  center: { x: number; y: number },
  size: number,
  tileSize: number,
  accept: (x: number, y: number) => boolean,
): { x: number; y: number }[] | null {
  const spreadTiles = MELLANMARK_GROUP_SPREAD / TILE_WORLD;
  const margin = 8;
  for (let attempt = 0; attempt < 20; attempt++) {
    const base = rng.next() * Math.PI * 2;
    const rad = spreadTiles * (0.85 + 0.15 * rng.next());
    const pts: { x: number; y: number }[] = [];
    let ok = true;
    for (let i = 0; i < size; i++) {
      const ang = base + (i * Math.PI * 2) / size;
      const x = center.x + Math.cos(ang) * rad;
      const y = center.y + Math.sin(ang) * rad;
      if (x < margin || y < margin || x > tileSize - margin || y > tileSize - margin || !accept(x, y)) {
        ok = false;
        break;
      }
      pts.push({ x, y });
    }
    if (ok) return pts;
  }
  return null;
}

function isPackLeader(id: string): boolean {
  return id.includes('ledare') || id.endsWith('kapten');
}

function nearestLowerSameFamily(leaderId: string, allowed: readonly string[]): string | null {
  const byId = new Map(DATA.families.monsters.map((m) => [m.id, m]));
  const leader = byId.get(leaderId);
  if (!leader) return null;
  const fixed = DATA.monsterLevels.fixed_levels ?? {};
  const leaderLv = fixed[leaderId] ?? leader.level;
  let best: string | null = null;
  let bestGap = Infinity;
  for (const id of allowed) {
    if (id === leaderId || isPackLeader(id)) continue;
    const def = byId.get(id);
    if (!def || def.family !== leader.family) continue;
    const lv = fixed[id] ?? def.level;
    if (lv > leaderLv) continue;
    const gap = leaderLv - lv;
    if (gap < bestGap) {
      bestGap = gap;
      best = id;
    }
  }
  return best;
}

function weightedSubtype(rng: Rng, ids: readonly string[]): string {
  return rng.weighted(ids.map((id) => ({ id, weight: subtypeSpawnWeight(id) }))).id;
}

function rollChunkSpawns(
  catalog: BigWorldCatalog,
  gameSeed: number,
  cx: number,
  cy: number,
  subtypes: readonly string[],
  genereradSpawn: boolean,
  band: readonly [number, number],
  ring: number,
  mellanmark: boolean,
  region: BigWorldRegion,
  roadIds: readonly string[],
  worldSeed: number,
): BigWorldSpawnRoll[] {
  if (!genereradSpawn || subtypes.length === 0) return [];
  const allowed = filterSubtypesByBand(subtypes, band);
  if (allowed.length === 0) return [];
  const rng = new Rng(chunkSpawnRollSeed(gameSeed, cx, cy));
  const champ = mellanmarkChampionRoll();
  const range = mellanmark ? mellanmarkSpawnCountRange(ring) : regionSpawnCountRange(region, ring, catalog.data, cx, cy, gameSeed);
  const target = rng.int(range);
  const tileSize = catalog.data.meta.chunk?.storlek_rutor ?? 64;
  const hasRoadAtTile = (ccx: number, ccy: number, ti: number, tj: number) =>
    roadTileInChunk(catalog.roads, ccx, ccy, ti, tj, tileSize, worldSeed);
  const out: BigWorldSpawnRoll[] = [];
  const fixed = DATA.monsterLevels.fixed_levels ?? {};
  const levelBonus = DATA.monsterLevels.elites.champion.level_bonus;
  const fire = campFirePos();
  const start = campStartPos();
  const roadRadius = roadSkipRadius(ring);

  const campBlocked = (localX: number, localY: number): boolean => {
    const world = chunkSpawnToWorld(cx, cy, localX, localY);
    if (Math.hypot(world.x - fire.x, world.y - fire.y) < CAMP_SAFE_RADIUS) return true;
    if (Math.hypot(world.x - start.x, world.y - start.y) < START_POS_SAFE_RADIUS) return true;
    return false;
  };

  const acceptSpot = (localX: number, localY: number): boolean => {
    if (campBlocked(localX, localY)) return false;
    const nearRoad = spawnTileNearRoad(localX, localY, cx, cy, roadIds, hasRoadAtTile, roadRadius);
    if (!nearRoad) return true;
    if (ring <= 1) return false;
    return !skipSpawnNearRoad(true, rng.next(), ring);
  };

  const pushAt = (id: string, localX: number, localY: number, makeChamp: boolean) => {
    const base = fixed[id] ?? band[0];
    out.push({
      uid: `bw:${cx},${cy}:${out.length}:${id}`,
      enemy: id,
      level: makeChamp ? base + levelBonus : base,
      localX,
      localY,
      elite: makeChamp ? 'champion' : null,
    });
  };

  // Mellanmark: en familj, grupper om 2 till 4. Högst en championgrupp.
  if (mellanmark) {
    const enemy = weightedSubtype(rng, allowed);
    const sizes = planGroupSizes(rng, target);
    const centers = pickGroupCenters(rng, sizes.length, tileSize, acceptSpot);
    let championUsed = false;
    for (let g = 0; g < sizes.length; g++) {
      const size = sizes[g] ?? MELLANMARK_GROUP_MIN;
      const center = centers[g];
      if (!center) continue;
      const makeChamp = !championUsed && ring >= champ.minRing && rng.chance(champ.chance);
      if (makeChamp) championUsed = true;
      const pts = placeSymmetricGroup(rng, center, size, tileSize, acceptSpot);
      if (pts) {
        for (const p of pts) pushAt(enemy, p.x, p.y, makeChamp);
      } else {
        for (let i = 0; i < size; i++) pushAt(enemy, center.x, center.y, makeChamp);
      }
    }
    return out;
  }

  let guard = 0;
  while (out.length < target && guard < Math.max(target * 16, 16)) {
    guard++;
    const remaining = target - out.length;
    let size = rng.int([1, Math.min(GROUP_MAX, remaining)]);
    const enemy = weightedSubtype(rng, allowed);
    const members: string[] = [];
    if (isPackLeader(enemy) && remaining >= GROUP_MAX) {
      size = GROUP_MAX;
      const follower = nearestLowerSameFamily(enemy, allowed);
      members.push(enemy);
      for (let i = 1; i < size; i++) members.push(follower ?? enemy);
    } else {
      for (let i = 0; i < size; i++) members.push(enemy);
    }
    for (const id of members) {
      if (out.length >= target) break;
      let placed = false;
      for (let t = 0; t < 40 && !placed; t++) {
        const localX = rng.float(8, tileSize - 8);
        const localY = rng.float(8, tileSize - 8);
        if (!acceptSpot(localX, localY)) continue;
        pushAt(id, localX, localY, false);
        placed = true;
      }
    }
  }
  return out;
}

/** Generererar all data för en chunk (layout = world_seed, spawns = game_seed). */
export function generateChunkWorldData(
  worldSeed: number,
  gameSeed: number,
  cx: number,
  cy: number,
  catalog: BigWorldCatalog = getBigWorldCatalog(),
): ChunkWorldData {
  const { region, mellanmark } = primaryBiomeAt(catalog, cx, cy);
  const distance = chunkDistanceFromStart(cx, cy, catalog.startChunk);
  const ringar = catalog.data.meta.zonmodell?.ringar ?? [];
  const chunkRing = ringAtChunkDistance(distance, ringar);
  const biome = catalog.data.biomer[region.biom];
  const blend = blendBiomesAtChunk(cx, cy, region.biom, neighborBiomeFactory(catalog));
  const { ids: roads, types: roadTypes } = roadsAtChunk(catalog.roads, cx, cy);
  const poiKey = `${region.chunk[0]},${region.chunk[1]}`;
  const pois =
    !mellanmark && region.chunk[0] === cx && region.chunk[1] === cy ? (catalog.poisByRegionChunk.get(poiKey) ?? region.poi ?? []) : [];

  const placeholders = biomeRenderPlaceholders(biome);
  const town = !mellanmark && isTownBiomeChunk(region.typ);

  let spawnSubtypes: string[];
  let generatedSpawn: boolean;
  let access: string;
  let regionTyp: string;
  let safe: boolean;
  let act: string | null;
  let monsterFamily: string | null = region.monsterfamilj ?? null;
  let spawnBand = mellanmark
    ? mellanmarkLevelBand(catalog.data, chunkRing.ring, chunkRing.levelBand)
    : regionSpawnLevelBand(catalog.data, region);

  if (mellanmark) {
    const plan = planMellanmarkSpawn(catalog.data, biome, region, chunkRing.ring, chunkRing.levelBand);
    spawnBand = plan.spawnBand;
    monsterFamily = plan.monsterFamily;
    spawnSubtypes = plan.spawnSubtypes;
    generatedSpawn = spawnSubtypes.length > 0;
    access = 'oppen';
    regionTyp = 'mellanmark';
    safe = false;
    act = region.akt ?? null;
  } else {
    spawnSubtypes = filterSubtypesByBand(region.undertyper ?? [], spawnBand);
    const legacyChunk = isLegacyOnlySpawnChunk(cx, cy);
    const regionBudget = regionMonsterPerGame(region, chunkRing.ring, catalog.data);
    generatedSpawn = !legacyChunk && spawnSubtypes.length > 0 && (region.genererad_spawn === true || regionBudget > 0);
    access = region.atkomst ?? 'oppen';
    regionTyp = region.typ;
    safe = region.sakert === true;
    act = region.akt ?? null;
  }

  return {
    cx,
    cy,
    chunkSeed: chunkLayoutSeed(worldSeed, cx, cy),
    distanceChunks: distance,
    ring: chunkRing.ring,
    levelBand: spawnBand,
    mellanmark,
    regionId: mellanmark ? `mellanmark:${region.id}` : region.id,
    regionTyp,
    biomeId: region.biom,
    biomeBlend: blend,
    roads,
    roadTypes,
    pois,
    safe,
    act,
    access,
    monsterFamily,
    spawnSubtypes,
    generatedSpawn,
    tilePool: placeholders.tilePool,
    decorPool: placeholders.decorPool,
    decorLayers: placeholders.decorLayers,
    music: town ? 'town' : placeholders.music,
    spawns: rollChunkSpawns(
      catalog,
      gameSeed,
      cx,
      cy,
      spawnSubtypes,
      generatedSpawn && !isLegacyOnlySpawnChunk(cx, cy),
      spawnBand,
      chunkRing.ring,
      mellanmark,
      region,
      roads,
      worldSeed,
    ),
  };
}
