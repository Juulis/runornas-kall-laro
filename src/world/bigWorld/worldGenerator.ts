import { DATA } from '../../data';
import type { BigWorldDataFile, BigWorldRegion } from '../../data/bigWorldTypes';
import type { EliteKind } from '../../data/types';
import { Rng } from '../../core/Rng';
import { blendBiomesAtChunk, biomeRenderPlaceholders, isTownBiomeChunk } from './biomeBlend';
import { buildRoadIndex, roadTileInChunk, roadsAtChunk, type RoadIndex } from './roads';
import { resolveRegionAtChunk } from './regionIndex';
import { chunkDistanceFromStart, ringAtChunkDistance } from './ringZone';
import { planMellanmarkSpawn, filterSubtypesByBand, regionSpawnLevelBand, mellanmarkLevelBand } from './spawnRules';
import {
  mellanmarkChampionRoll,
  mellanmarkSpawnCountRange,
  regionSpawnCountRange,
  skipSpawnNearRoad,
  spawnTileNearRoad,
  subtypeSpawnWeight,
} from './spawnDensity';
import { isLegacyOnlySpawnChunk } from './startskogenFootprint';
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

function neighborBiomeFactory(catalog: BigWorldCatalog): (ncx: number, ncy: number) => string {
  return (ncx, ncy) => primaryBiomeAt(catalog, ncx, ncy).region.biom;
}

const GROUP_MAX = 3;

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
): BigWorldSpawnRoll[] {
  if (!genereradSpawn || subtypes.length === 0) return [];
  const allowed = filterSubtypesByBand(subtypes, band);
  if (allowed.length === 0) return [];
  const rng = new Rng(chunkSpawnRollSeed(gameSeed, cx, cy));
  const champ = mellanmarkChampionRoll();
  const range = mellanmark ? mellanmarkSpawnCountRange(ring) : regionSpawnCountRange(region, ring, catalog.data, cx, cy, gameSeed);
  const target = rng.int(range);
  const tileSize = catalog.data.meta.chunk?.storlek_rutor ?? 64;
  const hasRoadAtTile = (ccx: number, ccy: number, ti: number, tj: number) => roadTileInChunk(catalog.roads, ccx, ccy, ti, tj, tileSize);
  const out: BigWorldSpawnRoll[] = [];
  const fixed = DATA.monsterLevels.fixed_levels ?? {};
  const levelBonus = DATA.monsterLevels.elites.champion.level_bonus;
  let championUsed = false;
  let guard = 0;
  const place = (id: string, makeChamp: boolean): boolean => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const localX = rng.float(8, tileSize - 8);
      const localY = rng.float(8, tileSize - 8);
      const nearRoad = spawnTileNearRoad(localX, localY, cx, cy, roadIds, hasRoadAtTile);
      if (skipSpawnNearRoad(nearRoad, rng.next())) continue;
      const base = fixed[id] ?? band[0];
      out.push({
        uid: `bw:${cx},${cy}:${out.length}:${id}`,
        enemy: id,
        level: makeChamp ? base + levelBonus : base,
        localX,
        localY,
        elite: makeChamp ? 'champion' : null,
      });
      return true;
    }
    return false;
  };
  while (out.length < target && guard < Math.max(target * 16, 16)) {
    guard++;
    const remaining = target - out.length;
    let size = mellanmark ? remaining : rng.int([1, Math.min(GROUP_MAX, remaining)]);
    const enemy = weightedSubtype(rng, allowed);
    const members: string[] = [];
    if (!mellanmark && isPackLeader(enemy) && remaining >= GROUP_MAX) {
      size = GROUP_MAX;
      const follower = nearestLowerSameFamily(enemy, allowed);
      members.push(enemy);
      for (let i = 1; i < size; i++) members.push(follower ?? enemy);
    } else {
      for (let i = 0; i < size; i++) members.push(enemy);
    }
    const canChamp = mellanmark && ring >= champ.minRing && !championUsed;
    const makeChamp = canChamp && rng.chance(champ.chance);
    const before = out.length;
    for (const id of members) {
      if (out.length >= target) break;
      let placed = false;
      for (let t = 0; t < 12 && !placed; t++) placed = place(id, makeChamp);
    }
    if (makeChamp && out.length > before) championUsed = true;
    if (mellanmark) break;
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
    ),
  };
}
