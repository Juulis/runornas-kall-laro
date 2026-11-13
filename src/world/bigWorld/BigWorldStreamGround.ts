import type { Container, Renderer } from 'pixi.js';
import { Container as PixiContainer, Rectangle, Sprite } from 'pixi.js';
import { Rng } from '../../core/Rng';
import { pickChunkGroundTileId } from './groundTiles';
import type { Vec2, Collider } from '../../core/GameContext';
import { biomeLoadLabel, canonicalBiomeId, decorForBiome, tilesForBiome } from '../../render/biomeAssetGroups';
import type { AssetStore } from '../../render/Assets';
import { Iso, TILE_WORLD } from '../../render/Iso';
import { trackChunkLoad } from '../../ui/chunkLoad';
import { ChunkWorldCache } from './chunkCache';
import type { ChunkWorldData } from './worldGenerator';
import { chunkMinWorld, chunkTileCount, chunkWorldSpan, worldToChunk } from './bigWorldCoords';
import { patchWorldBounds } from './groundPatchBounds';
import {
  BIG_WORLD_CACHE_KEEP_RADIUS,
  BIG_WORLD_GROUND_BUILD_BUDGET_MS,
  BIG_WORLD_GROUND_PATCH_TILES,
  BIG_WORLD_RENDER_RADIUS,
  BIG_WORLD_SKY_CLEAR_COLOR,
} from './bigWorldConfig';
import type { Zone } from '../Zone';

export interface BigWorldStreamScene {
  objects: Container;
  zone: Zone;
}

export interface BigWorldViewBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PatchVisual {
  layer: PixiContainer;
  tilesBuilt: number;
  totalTiles: number;
}

interface ChunkVisual {
  root: PixiContainer;
  data: ChunkWorldData;
  patches: PatchVisual[][];
  decor: DecorEntry[];
  decorDone: boolean;
}

interface DecorEntry {
  sprite: Sprite;
  collider: Collider | null;
  wx: number;
  wy: number;
}

function visualKey(worldSeed: number, gameSeed: number, cx: number, cy: number): string {
  return `${worldSeed}|${gameSeed}|${cx}|${cy}`;
}

/** Delade asset-texturer får aldrig förstöras — bara sprite-noder. */
function clearContainerChildren(layer: PixiContainer): void {
  for (const ch of layer.removeChildren()) ch.destroy();
}

/** Pixi v8: position blir null efter destroy — använd inte lagret. */
export function patchLayerUsable(layer: PixiContainer | null | undefined): layer is PixiContainer {
  if (!layer || layer.destroyed) return false;
  return layer.position != null;
}

function destroyPatch(patch: PatchVisual): void {
  if (patchLayerUsable(patch.layer)) clearContainerChildren(patch.layer);
  if (patchLayerUsable(patch.layer)) patch.layer.destroy();
}

function countPixiDisplayObjects(root: PixiContainer): number {
  let n = 0;
  const walk = (c: PixiContainer) => {
    for (const ch of c.children) {
      n++;
      if (ch instanceof PixiContainer) walk(ch);
    }
  };
  walk(root);
  return n;
}

function aabbOverlap(a: BigWorldViewBounds, minX: number, minY: number, maxX: number, maxY: number): boolean {
  return minX <= a.maxX && maxX >= a.minX && minY <= a.maxY && maxY >= a.minY;
}

/** Räknar RenderTexture-baserade mark-patchar (GPU-minne). */
export function countBigWorldGroundRenderTextures(ground: BigWorldStreamGround): number {
  return ground.countRenderTextures();
}

/**
 * Chunkad mark från varld_stor. Rutor byggs inkrementellt som sprites (ingen RT-bakning).
 */
export class BigWorldStreamGround extends PixiContainer {
  private readonly visuals = new Map<string, ChunkVisual>();
  private readonly cache: ChunkWorldCache;
  private lastCx = NaN;
  private lastCy = NaN;
  private lastHeroWx = NaN;
  private lastHeroWy = NaN;
  private activeWorldSeed = 0;
  private activeGameSeed = 0;
  private scene: BigWorldStreamScene | null = null;
  private allowBuild = true;
  private viewBounds: BigWorldViewBounds | null = null;
  /** Biom vars plattor och dekor redan finns i AssetStore. */
  private readonly biomeReady = new Set<string>();
  private readonly biomePending = new Map<string, Promise<void>>();

  constructor(
    private readonly assets: AssetStore,
    cache?: ChunkWorldCache,
  ) {
    super();
    const keep = BIG_WORLD_CACHE_KEEP_RADIUS;
    const side = 2 * keep + 1;
    this.cache = cache ?? new ChunkWorldCache({ maxEntries: side * side, keepRadius: keep });
  }

  get chunkCache(): ChunkWorldCache {
    return this.cache;
  }

  countGroundDisplayObjects(): number {
    return countPixiDisplayObjects(this);
  }

  countRenderTextures(): number {
    return 0;
  }

  isGroundReady(): boolean {
    const view = this.viewBounds;
    const patchTiles = BIG_WORLD_GROUND_PATCH_TILES;
    const tiles = chunkTileCount();
    let need = 0;
    for (const vis of this.visuals.values()) {
      const { cx, cy } = vis.data;
      for (let pi = 0; pi < vis.patches.length; pi++) {
        const row = vis.patches[pi];
        if (!row) continue;
        for (let pj = 0; pj < row.length; pj++) {
          const p = row[pj];
          if (!p) continue;
          if (view) {
            const b = patchWorldBounds(cx, cy, pi, pj, patchTiles, tiles);
            if (!aabbOverlap(view, b.minX, b.minY, b.maxX, b.maxY)) continue;
          }
          need++;
          if (p.tilesBuilt < p.totalTiles) return false;
        }
      }
    }
    return need > 0;
  }

  /** Teleport eller stor hopp — tvinga om chunk-sync och markbygge. */
  bumpHeroPosition(hero: Vec2): void {
    this.lastCx = NaN;
    this.lastCy = NaN;
    this.lastHeroWx = hero.x;
    this.lastHeroWy = hero.y;
  }

  sync(
    hero: Vec2,
    worldSeed: number,
    gameSeed: number,
    scene: BigWorldStreamScene | null,
    renderer: Renderer | null,
    viewBounds: BigWorldViewBounds | null = null,
  ): void {
    this.scene = scene;
    this.allowBuild = renderer != null;
    this.viewBounds = viewBounds;
    const span = chunkWorldSpan();
    if (!Number.isNaN(this.lastHeroWx) && Math.hypot(hero.x - this.lastHeroWx, hero.y - this.lastHeroWy) > span * 1.25) {
      this.lastCx = NaN;
      this.lastCy = NaN;
    }
    this.lastHeroWx = hero.x;
    this.lastHeroWy = hero.y;
    const { cx, cy } = worldToChunk(hero.x, hero.y);
    const movedChunk = cx !== this.lastCx || cy !== this.lastCy;
    const seedChanged = worldSeed !== this.activeWorldSeed || gameSeed !== this.activeGameSeed;
    if (seedChanged) {
      this.dropAllVisuals();
      this.activeWorldSeed = worldSeed;
      this.activeGameSeed = gameSeed;
      this.lastCx = NaN;
      this.lastCy = NaN;
    }
    if (!movedChunk && !seedChanged && !this.pendingBuild()) {
      this.applyViewCulling();
      return;
    }
    this.lastCx = cx;
    this.lastCy = cy;
    this.cache.syncNear(worldSeed, gameSeed, cx, cy);

    const rr = BIG_WORLD_RENDER_RADIUS;
    const keep = new Set<string>();
    for (let dx = -rr; dx <= rr; dx++) {
      for (let dy = -rr; dy <= rr; dy++) {
        const k = visualKey(worldSeed, gameSeed, cx + dx, cy + dy);
        keep.add(k);
        if (!this.visuals.has(k)) {
          const data = this.cache.get(worldSeed, gameSeed, cx + dx, cy + dy);
          this.startChunkVisual(k, data);
        }
      }
    }
    for (const [key, vis] of this.visuals) {
      if (!keep.has(key)) this.dropChunkVisual(key, vis);
    }
    for (const vis of this.visuals.values()) {
      if (!vis.root.parent) this.addChild(vis.root);
    }
    this.applyViewCulling();
    this.tickBuildBudget();
  }

  private applyViewCulling(): void {
    const view = this.viewBounds;
    const patchTiles = BIG_WORLD_GROUND_PATCH_TILES;
    const tiles = chunkTileCount();
    for (const vis of this.visuals.values()) {
      const { cx, cy } = vis.data;
      for (let pi = 0; pi < vis.patches.length; pi++) {
        const row = vis.patches[pi];
        if (!row) continue;
        for (let pj = 0; pj < row.length; pj++) {
          const patch = row[pj];
          if (!patch || !patchLayerUsable(patch.layer)) continue;
          const b = patchWorldBounds(cx, cy, pi, pj, patchTiles, tiles);
          const on = !view || aabbOverlap(view, b.minX, b.minY, b.maxX, b.maxY);
          patch.layer.renderable = on;
          patch.layer.visible = on;
        }
      }
      for (const d of vis.decor) {
        if (d.sprite.destroyed) continue;
        const on = !view || aabbOverlap(view, d.wx, d.wy, d.wx, d.wy);
        d.sprite.renderable = on;
        d.sprite.visible = on;
      }
    }
  }

  private pendingBuild(): boolean {
    for (const vis of this.visuals.values()) {
      if (!vis.decorDone) return true;
      for (const row of vis.patches) {
        for (const p of row) {
          if (p.tilesBuilt < p.totalTiles) return true;
        }
      }
    }
    return false;
  }

  private dropAllVisuals(): void {
    for (const [key, vis] of this.visuals) this.dropChunkVisual(key, vis);
  }

  private dropChunkVisual(_key: string, vis: ChunkVisual): void {
    if (this.scene) {
      for (const d of vis.decor) {
        d.sprite.parent?.removeChild(d.sprite);
        d.sprite.destroy();
        if (d.collider) {
          const i = this.scene.zone.colliders.indexOf(d.collider);
          if (i >= 0) this.scene.zone.colliders.splice(i, 1);
        }
      }
    }
    for (const row of vis.patches) {
      for (const p of row) destroyPatch(p);
    }
    vis.root.destroy({ children: true });
    this.visuals.delete(_key);
  }

  private startChunkVisual(key: string, data: ChunkWorldData): void {
    const root = new PixiContainer();
    const tiles = chunkTileCount();
    const patchTiles = BIG_WORLD_GROUND_PATCH_TILES;
    const patchesPerSide = Math.ceil(tiles / patchTiles);
    const patches: PatchVisual[][] = [];
    for (let pi = 0; pi < patchesPerSide; pi++) {
      const row: PatchVisual[] = [];
      for (let pj = 0; pj < patchesPerSide; pj++) {
        const ti0 = pi * patchTiles;
        const tj0 = pj * patchTiles;
        const tw = Math.min(patchTiles, tiles - ti0);
        const th = Math.min(patchTiles, tiles - tj0);
        const layer = new PixiContainer();
        root.addChild(layer);
        row.push({ layer, tilesBuilt: 0, totalTiles: tw * th });
      }
      patches.push(row);
    }
    this.visuals.set(key, {
      root,
      data,
      patches,
      decor: [],
      decorDone: false,
    });
    this.requestBiomeAssets(data.biomeId);
  }

  /**
   * Startar lazy-laddning för chunkens biom. Klar genast om texturerna redan finns
   * eller om anroparen inte har ensureBiomeAssets (tester med färdiga texturer).
   */
  private biomeAssetsPresent(id: string): boolean {
    return (
      tilesForBiome(id).every((tileId) => this.assets.tiles.has(tileId)) &&
      decorForBiome(id).every((decorId) => this.assets.decor.has(decorId))
    );
  }

  private requestBiomeAssets(biomeId: string): void {
    const id = canonicalBiomeId(biomeId || 'skog');
    if (this.biomeReady.has(id) || this.biomePending.has(id)) return;
    const ensure = this.assets.ensureBiomeAssets;
    if (typeof ensure !== 'function' || this.biomeAssetsPresent(id)) {
      this.biomeReady.add(id);
      return;
    }
    const job = trackChunkLoad(biomeLoadLabel(id), (onProgress) => ensure.call(this.assets, id, onProgress)).then(
      () => {
        this.biomeReady.add(id);
      },
      () => {
        this.biomePending.delete(id);
      },
    );
    this.biomePending.set(id, job);
  }

  private chunkBiomeReady(vis: ChunkVisual): boolean {
    const id = canonicalBiomeId(vis.data.biomeId || 'skog');
    if (this.biomeReady.has(id)) return true;
    this.requestBiomeAssets(id);
    return this.biomeReady.has(id);
  }

  private spawnDecorForChunk(vis: ChunkVisual): void {
    if (vis.decorDone || !this.scene) return;
    if (!this.chunkBiomeReady(vis)) return;
    const data = vis.data;
    if (data.decorPool.length === 0 || data.safe) {
      vis.decorDone = true;
      return;
    }
    const tiles = chunkTileCount();
    const chunkMin = chunkMinWorld(data.cx, data.cy);
    const decorEvery = 11;
    for (let ti = 0; ti < tiles; ti += decorEvery) {
      for (let tj = 0; tj < tiles; tj += decorEvery) {
        const cell = new Rng(Rng.hash(data.chunkSeed, 'decor', ti, tj));
        if (cell.next() > 0.55) continue;
        const raw = cell.pick(data.decorPool.length ? data.decorPool : ['gran']);
        if (!this.assets.decor.has(raw)) continue;
        const d = this.assets.decor.get(raw);
        if (!d?.tex) continue;
        const decorId = raw;
        const wx = chunkMin.x + (ti + cell.float(0, decorEvery - 1)) * TILE_WORLD;
        const wy = chunkMin.y + (tj + cell.float(0, decorEvery - 1)) * TILE_WORLD;
        const s = new Sprite(d.tex);
        s.anchor.set(d.size.anchor[0] / d.size.w, d.size.anchor[1] / d.size.h);
        s.scale.set(0.35 + cell.next() * 0.2, 0.35 + cell.next() * 0.2);
        const p = Iso.worldToScreen(wx, wy);
        s.position.set(p.x, p.y);
        s.zIndex = wx + wy + 0.5;
        this.scene.objects.addChild(s);
        const collider: Collider | null =
          decorId === 'gran' ? { x: wx, y: wy, r: 0.9 } : decorId === 'stenhog' || decorId === 'stubbe' ? { x: wx, y: wy, r: 0.8 } : null;
        if (collider) this.scene.zone.colliders.push(collider);
        vis.decor.push({ sprite: s, collider, wx, wy });
      }
    }
    vis.decorDone = true;
  }

  private tickBuildBudget(): void {
    if (!this.allowBuild) return;
    const t0 = performance.now();
    while (performance.now() - t0 < BIG_WORLD_GROUND_BUILD_BUDGET_MS) {
      if (!this.buildTilesStep()) break;
    }
    for (const vis of this.visuals.values()) {
      if (this.chunkTilesComplete(vis) && !vis.decorDone) this.spawnDecorForChunk(vis);
    }
  }

  private chunkTilesComplete(vis: ChunkVisual): boolean {
    for (const row of vis.patches) {
      for (const p of row) {
        if (p.tilesBuilt < p.totalTiles) return false;
      }
    }
    return true;
  }

  private buildTilesStep(): boolean {
    const view = this.viewBounds;
    const patchTiles = BIG_WORLD_GROUND_PATCH_TILES;
    const tiles = chunkTileCount();
    const tryBuild = (vis: ChunkVisual, pi: number, pj: number): boolean => {
      const prow = vis.patches[pi];
      if (!prow) return false;
      const patch = prow[pj];
      if (!patch || !patchLayerUsable(patch.layer)) return false;
      if (patch.tilesBuilt >= patch.totalTiles) return false;
      if (view) {
        const b = patchWorldBounds(vis.data.cx, vis.data.cy, pi, pj, patchTiles, tiles);
        if (!aabbOverlap(view, b.minX, b.minY, b.maxX, b.maxY)) return false;
      }
      const data = vis.data;
      const chunkMin = chunkMinWorld(data.cx, data.cy);
      const pool = data.tilePool.length ? data.tilePool : ['gras_1'];
      const ti0 = pi * patchTiles;
      const tj0 = pj * patchTiles;
      const tw = Math.min(patchTiles, tiles - ti0);
      let built = 0;
      while (patch.tilesBuilt < patch.totalTiles && built < 128) {
        const local = patch.tilesBuilt;
        const di = Math.floor(local / tw);
        const dj = local % tw;
        const ti = ti0 + di;
        const tj = tj0 + dj;
        const tileId = pickChunkGroundTileId(data.chunkSeed, ti, tj, pool);
        const tex = this.assets.tiles.get(tileId);
        if (tex) {
          const wx = chunkMin.x + ti * TILE_WORLD;
          const wy = chunkMin.y + tj * TILE_WORLD;
          const s = new Sprite(tex);
          s.anchor.set(0.5, 0.85);
          const pos = Iso.worldToScreen(wx, wy);
          s.position.set(pos.x, pos.y);
          patch.layer.addChild(s);
        }
        patch.tilesBuilt++;
        built++;
      }
      return built > 0;
    };

    for (const vis of this.visuals.values()) {
      for (let pi = 0; pi < vis.patches.length; pi++) {
        for (let pj = 0; pj < (vis.patches[pi]?.length ?? 0); pj++) {
          if (tryBuild(vis, pi, pj)) return true;
        }
      }
    }
    return false;
  }

  probeGroundPixel(renderer: Renderer, heroScreenX: number, heroScreenY: number): boolean {
    if (!this.isGroundReady()) return false;
    const x = Math.max(0, Math.floor(heroScreenX));
    const y = Math.max(0, Math.floor(heroScreenY));
    try {
      const out = renderer.extract.pixels({
        target: renderer.canvas as unknown as Container,
        frame: new Rectangle(x, y, 1, 1),
      });
      const px = out?.pixels;
      if (!px || px.length < 3) return false;
      const r = px[0] ?? 0;
      const g = px[1] ?? 0;
      const b = px[2] ?? 0;
      const sky = BIG_WORLD_SKY_CLEAR_COLOR;
      const sr = (sky >> 16) & 255;
      const sg = (sky >> 8) & 255;
      const sb = sky & 255;
      return Math.abs(r - sr) + Math.abs(g - sg) + Math.abs(b - sb) > 24;
    } catch {
      return false;
    }
  }
}
