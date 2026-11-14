import { Graphics } from 'pixi.js';
import type { Container } from 'pixi.js';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { Rng } from '../core/Rng';
import { setClockTime } from '../render/ShadowLayer';
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

/** Mörk overlay, facklor i byn och nattljud (ingen spawn-/nivåpåverkan). */
export class DayNightPresenter {
  private readonly shade = new Graphics();
  private torches = new Graphics();
  private screenW = 0;
  private screenH = 0;
  private nightCryT = 8;

  constructor(
    screenLayer: Container,
    worldEffects: Container,
    private readonly bus: EventBus<GameEvents>,
    private readonly clock: GameClock,
    private readonly rng: Rng,
  ) {
    screenLayer.addChild(this.shade);
    this.attachWorldEffects(worldEffects);
    this.shade.eventMode = 'none';
    this.torches.eventMode = 'none';
    setClockTime(this.clock.timeSeconds);
  }

  get torchLayer(): Graphics {
    return this.torches;
  }

  attachWorldEffects(worldEffects: Container): void {
    if (this.torches.destroyed) {
      this.torches = new Graphics();
      this.torches.eventMode = 'none';
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

  update(dt: number, zoneName: string): void {
    setClockTime(this.clock.timeSeconds);
    const blend = nightBlend(this.clock.timeSeconds);
    this.drawShade(blend);
    this.drawTorches(zoneName, blend);
    if (blend > 0.55) {
      this.nightCryT -= dt;
      if (this.nightCryT <= 0) {
        this.nightCryT = 10 + this.rng.float(0, 14);
        this.bus.emit('night_ambient', { intensity: blend });
      }
    } else this.nightCryT = 8;
  }

  private drawShade(blend: number): void {
    const w = this.screenW;
    const h = this.screenH;
    if (w <= 0 || h <= 0) return;
    this.shade.clear();
    const alpha = 0.08 + blend * 0.42;
    this.shade.rect(0, 0, w, h).fill({ color: 0x060a14, alpha });
    if (blend > 0.2) {
      const edge = 0.12 * blend;
      this.shade.rect(0, 0, w, h * 0.12).fill({ color: 0x000000, alpha: edge });
      this.shade.rect(0, h * 0.88, w, h * 0.12).fill({ color: 0x000000, alpha: edge });
    }
  }

  private drawTorches(zoneName: string, blend: number): void {
    this.torches.clear();
    if (zoneName !== 'village' || blend < 0.35) return;
    const a = 0.35 + blend * 0.5;
    for (const [tx, ty] of VILLAGE_TORCH_TILES) {
      const p = Zone.T(tx, ty);
      this.torches.circle(p.x, p.y, 2.2).fill({ color: 0xffa040, alpha: a * 0.25 });
      this.torches.circle(p.x, p.y, 1.1).fill({ color: 0xffcc66, alpha: a * 0.55 });
    }
  }

  destroy(): void {
    this.shade.destroy();
    this.torches.destroy();
  }
}
