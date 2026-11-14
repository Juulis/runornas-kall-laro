import { Container } from 'pixi.js';
import type { Vec2 } from '../core/GameContext';
import { DirSprite } from '../render/DirSprite';
import { scaleKForWorldHeightM, shadowRadiusForWorldHeightM, worldHeightMForHeroOrNpc } from '../render/figureWorldHeights';
import type { AnimSet } from '../render/spriteAnim';
import type { WorldHumanFigure } from '../render/WorldFigureSprites';
import { Iso } from '../render/Iso';
import type { Zone } from '../world/Zone';

const BODY_R = 0.45;

function faceDir(dx: number, dy: number): number {
  const a = Math.atan2(dy, dx);
  return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
}

/** Patrull-NPC som slåss mot monster i öppen värld (akt 1). */
export class WorldFighter {
  readonly view = new Container();
  readonly id: string;
  readonly figure: WorldHumanFigure;
  readonly home: Vec2;
  readonly pos: Vec2;
  readonly maxHp: number;
  hp: number;
  atkCd = 0;
  /** Död: räknare tills borttagen, sedan respawn. */
  dead = 0;
  respawn = 0;
  private readonly sprite: DirSprite;
  readonly damage: number;

  constructor(id: string, figure: WorldHumanFigure, pos: Vec2, set: AnimSet, opts: { maxHp: number; damage: number }) {
    this.id = id;
    this.figure = figure;
    this.home = { x: pos.x, y: pos.y };
    this.pos = { x: pos.x, y: pos.y };
    this.maxHp = opts.maxHp;
    this.hp = opts.maxHp;
    this.damage = opts.damage;
    const hm = worldHeightMForHeroOrNpc();
    const k = scaleKForWorldHeightM(set, hm);
    this.sprite = new DirSprite(set, k, shadowRadiusForWorldHeightM(hm), false, 'npc');
    this.sprite.play('idle');
    this.view.addChild(this.sprite);
    this.syncView();
  }

  get alive(): boolean {
    return this.dead <= 0 && this.respawn <= 0;
  }

  updateSprite(dt: number): void {
    this.sprite.update(dt);
    if (this.dead > 0) this.view.alpha = Math.max(0, 1 - Math.max(0, this.dead - 0.5) * 2);
    else this.view.alpha = 1;
    this.syncView();
  }

  playIdle(): void {
    this.sprite.play('idle');
  }

  playMove(run: boolean): void {
    this.sprite.play(run ? 'run' : 'gang');
  }

  playAttack(): void {
    this.sprite.play('attack', true);
  }

  playDeath(): void {
    this.sprite.play('dod', true);
  }

  setFacing(dx: number, dy: number): void {
    this.sprite.dir = faceDir(dx, dy);
  }

  collide(zone: Zone): void {
    zone.collide(this.pos, BODY_R);
  }

  private syncView(): void {
    const p = Iso.worldToScreen(this.pos.x, this.pos.y);
    this.view.position.set(p.x, p.y);
    this.view.zIndex = this.pos.x + this.pos.y;
  }
}
