import { Container, Graphics } from 'pixi.js';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { Rng } from '../core/Rng';
import { Iso } from '../render/Iso';
import {
  attachLight,
  bindLightLayer,
  detachAll,
  detachLight,
  getDarknessMode,
  nightOverlayAlpha,
  setAmbientBiome,
  setClockTime as setLightClock,
  setLightFocus,
  setLightZoom,
  syncAllLights,
} from '../render/LightLayer';
import { setClockTime as setShadowClock } from '../render/ShadowLayer';
import { nightBlend, type GameClock } from './GameClock';
import { Zone } from './Zone';

const VILLAGE_TORCH_TILES: [number, number][] = [
  [12, 13],
  [15, 13],
  [18, 11],
  [9, 9],
  [4, 19],
  [22, 20],
];

export interface NightViewer {
  x: number;
  y: number;
  biomeId?: string;
}

/** Mörk overlay, ljus i världen och nattljud. Skuggorna tickas via samma klocka. */
export class DayNightPresenter {
  private readonly shade = new Graphics();
  private readonly lightRoot = new Container();
  private torches = new Graphics();
  private readonly torchAnchors: Container[] = [];
  private screenW = 0;
  private screenH = 0;
  private nightCryT = 8;
  private biomeId: string | undefined;
  private worldEffects: Container;

  constructor(
    screenLayer: Container,
    worldEffects: Container,
    private readonly bus: EventBus<GameEvents>,
    private readonly clock: GameClock,
    private readonly rng: Rng,
  ) {
    this.worldEffects = worldEffects;
    this.shade.eventMode = 'none';
    this.lightRoot.eventMode = 'none';
    this.lightRoot.interactiveChildren = false;
    screenLayer.addChild(this.shade);
    screenLayer.addChild(this.lightRoot);
    bindLightLayer(this.lightRoot);
    this.attachWorldEffects(worldEffects);
    this.torches.eventMode = 'none';
    setShadowClock(this.clock.timeSeconds);
    setLightClock(this.clock.timeSeconds);
  }

  get torchLayer(): Graphics {
    return this.torches;
  }

  attachWorldEffects(worldEffects: Container): void {
    this.worldEffects = worldEffects;
    if (this.torches.destroyed) {
      this.torches = new Graphics();
      this.torches.eventMode = 'none';
      this.torchAnchors.length = 0;
    }
    if (this.torches.parent !== worldEffects) {
      this.torches.parent?.removeChild(this.torches);
      worldEffects.addChild(this.torches);
    }
  }

  resize(w: number, h: number): void {
    this.screenW = w;
    this.screenH = h;
    this.drawShade(nightBlend(this.clock.timeSeconds));
  }

  update(dt: number, zoneName: string, viewer?: NightViewer): void {
    const time = this.clock.timeSeconds;
    setShadowClock(time);
    setLightClock(time);
    this.applyZoom();
    if (viewer) this.applyViewer(viewer);
    const blend = nightBlend(time);
    this.drawShade(blend);
    this.syncVillageTorches(zoneName);
    syncAllLights();
    if (blend > 0.55) {
      this.nightCryT -= dt;
      if (this.nightCryT <= 0) {
        this.nightCryT = 10 + this.rng.float(0, 14);
        this.bus.emit('night_ambient', { intensity: blend });
      }
    } else this.nightCryT = 8;
  }

  private applyViewer(viewer: NightViewer): void {
    this.biomeId = viewer.biomeId;
    setAmbientBiome(viewer.biomeId);
    setLightFocus(viewer.x, viewer.y);
  }

  private applyZoom(): void {
    const world = this.worldEffects.parent;
    const zoom = world?.scale.x ?? 1;
    if (zoom > 0) setLightZoom(zoom);
  }

  private drawShade(blend: number): void {
    const w = this.screenW;
    const h = this.screenH;
    if (w <= 0 || h <= 0) return;
    this.shade.clear();
    const alpha = nightOverlayAlpha(blend, getDarknessMode(), this.biomeId);
    this.shade.rect(0, 0, w, h).fill({ color: 0x060a14, alpha });
    if (blend > 0.2) {
      const edge = 0.12 * blend;
      this.shade.rect(0, 0, w, h * 0.12).fill({ color: 0x000000, alpha: edge });
      this.shade.rect(0, h * 0.88, w, h * 0.12).fill({ color: 0x000000, alpha: edge });
    }
  }

  /** Byns fasta facklor är riktiga ljuskällor, inte extra cirklar ovanpå. */
  private syncVillageTorches(zoneName: string): void {
    if (zoneName !== 'village') {
      this.clearVillageTorches();
      return;
    }
    if (this.torchAnchors.length > 0) return;
    for (const [tx, ty] of VILLAGE_TORCH_TILES) {
      const world = Zone.T(tx, ty);
      const anchor = new Container();
      anchor.eventMode = 'none';
      const p = Iso.worldToScreen(world.x, world.y);
      anchor.position.set(p.x, p.y);
      this.torches.addChild(anchor);
      attachLight(anchor, 'torch', world);
      this.torchAnchors.push(anchor);
    }
  }

  private clearVillageTorches(): void {
    for (const anchor of this.torchAnchors) {
      detachLight(anchor);
      if (!anchor.destroyed) anchor.destroy({ children: true });
    }
    this.torchAnchors.length = 0;
  }

  destroy(): void {
    this.clearVillageTorches();
    detachAll();
    bindLightLayer(null);
    if (!this.lightRoot.destroyed) this.lightRoot.destroy({ children: true });
    if (!this.shade.destroyed) this.shade.destroy();
    if (!this.torches.destroyed) this.torches.destroy();
  }
}
