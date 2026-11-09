import type { EventBus } from './EventBus';
import type { GameEvents } from './events';
import type { Session } from './Session';
import type { Rng } from './Rng';
import type { FoundEntry } from './SaveBackend';
import type { GameData, VillageZoneDef } from '../data/types';
import type { LearnSettings } from '../learn/types';
import type { WorldState } from '../world/worldStateTypes';
import type { WorldStateService } from '../world/WorldStateService';
import type { GameClockSnapshot } from '../world/GameClock';

/**
 * Koordinater (se ARCHITECTURE.md): världsenheter = samma enhet som i speldata (spawnzoner/portal_by, 3D-versionens meter).
 * x österut, y söderut (3D:s z). Origo = zonens mittpunkt. En iso-ruta = 2 världsenheter (byns tile_size).
 */
export interface Vec2 {
  x: number;
  y: number;
}

export interface ItemInstance {
  base: string;
  quality?: string;
  ilvl?: number;
  affixes?: unknown[];
  n?: number;
}
export type Equipment = Record<string, ItemInstance | null | undefined>;

/** Hjältens tillstånd. Moduler läser via ctx.hero; bara Game/gameplay skriver (laddning via Game.loadHero). */
export interface HeroState {
  id: string | null;
  name: string;
  cls: string;
  level: number;
  xp: number;
  gold: number;
  hp: number;
  maxHp: number;
  /** Världsposition (världsenheter). */
  pos: Vec2;
  inv: ItemInstance[];
  equip: Equipment;
  stage: number;
  runes: number;
  city: string;
  /** Zon att starta i vid new_game, och aktuell zon under spel. */
  zone: string;
  /** Riktning i radianer; framåt = (sin, cos) i (x, y). */
  facing: number;
  playing: boolean;
  /** Position att återuppta på vid new_game (null = zonens startpunkt). */
  resumePos: Vec2 | null;
  /** Nyskapad hjälte: motorn delar ut startutrustning. */
  fresh: boolean;
}

export interface Collider {
  x: number;
  y: number;
  r: number;
  off?: boolean;
}
export interface RuneView {
  x: number;
  y: number;
  active: boolean;
}
export interface PortalView {
  x: number;
  y: number;
  target: string;
}

/** Vad moduler behöver veta om aktuell zon (karta, ljud, lorebok …). Alla längder i världsenheter. */
export interface ZoneView {
  name: string;
  areaId: string;
  /** Storlek i världsenheter. */
  width: number;
  height: number;
  /** Rund zon: radie runt origo. */
  circle?: number;
  /** Rektangulär zon: [min, max] på båda axlarna. */
  rect?: readonly [number, number];
  colliders: readonly Collider[];
  runes: readonly RuneView[];
  portals: readonly PortalView[];
  /** Rensade delområden (bara information, ingen spärr). */
  cleared: Readonly<Record<string, boolean>>;
  arena?: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Stor skog med chunk-streaming (#85). */
  bigWorldStreaming?: boolean;
}

/** Sparbar ögonblicksbild av hjälte + session (Game.getSnapshot / Game.loadHero). */
export interface HeroSave {
  hero: Pick<HeroState, 'id' | 'name' | 'cls' | 'level' | 'xp' | 'gold' | 'inv' | 'equip' | 'fresh'>;
  game: {
    seed: number;
    /** Geografiseed (chunk-layout); saknas i äldre sparfiler → migreras från seed. */
    worldSeed?: number;
    killed: string[];
    zone: string;
    pos: Vec2 | null;
    stage: number;
    runes: number;
    city: string;
    /** Spelklocka i sekunder (#47). */
    worldTime?: number;
    /** Stor-värld koordinat-epoch (offset 192); saknas → migreras vid load. */
    bwCoordEpoch?: number;
  } | null;
  /** Per-hjälte fynd (lorebok); sätts av SaveBackend vid load, inte av Game.getSnapshot(). */
  foundItems?: Record<string, FoundEntry>;
  worldState?: WorldState;
  /** Nivå och ämne för frågespelet. Saknas i äldre sparfiler. */
  learn?: LearnSettings;
}

/** Delas ut till varje modul via init(). Inga globaler. */
export interface GameContext {
  bus: EventBus<GameEvents>;
  hero: Readonly<HeroState>;
  zone: Readonly<ZoneView>;
  session: Session;
  data: GameData;
  /** Seedad slumptjänst (Math.random är förbjudet via ESLint). */
  rng: Rng;
  /** Per-hjälte världstillstånd (#37). */
  worldState: WorldStateService;
  /** Spelklocka: `day`, `time` (sekunder), `isNight` (#47). */
  clock: Readonly<GameClockSnapshot>;
}

/** En utbytbar del av spelet (AudioManager, SaveManager, MapUI, StartMenu, Lorebook …). Registreras i src/main.ts. */
export interface GameModule {
  init(ctx: GameContext): void;
  dispose(): void;
}

export interface VillageLayout {
  zones: VillageZoneDef[];
  /** Byns rutnät i rutor och rutstorlek i världsenheter. */
  grid: [number, number];
  tileSize: number;
  forestPortal: [number, number];
}
/** Bylayout och skogsportal ur portal_by.json (typat). */
export function villageLayout(data: GameData): VillageLayout {
  const v = data.portalVillage.village;
  return { zones: v.zones, grid: v.grid, tileSize: v.tile_size, forestPortal: data.portalVillage.portal.forest_position };
}
