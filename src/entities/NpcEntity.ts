import { Container, Graphics } from 'pixi.js';
import type { ResolvedNpc } from '../npc/npcPlacement';
import { activityIsMoving, stepNpcToward } from '../npc/npcMovement';
import { DirSprite } from '../render/DirSprite';
import { scaleKForWorldHeightM, shadowRadiusForWorldHeightM, worldHeightMForHeroOrNpc } from '../render/figureWorldHeights';
import { Iso } from '../render/Iso';
import type { Anim, AnimSet } from '../render/spriteAnim';
import type { Zone } from '../world/Zone';

const NPC_FACE_DIR = 1; // SV

/** NPC-sprite i världen (ingen skada); kan följa dygnsrutiner. */
export class NpcEntity {
  readonly view = new Container();
  readonly resolved: ResolvedNpc;
  private readonly sprite: DirSprite | null = null;
  private target = { x: 0, y: 0 };
  private atTarget = true;

  constructor(resolved: ResolvedNpc, anim: Anim | null) {
    this.resolved = resolved;
    this.target.x = resolved.pos.x;
    this.target.y = resolved.pos.y;
    const npcHm = worldHeightMForHeroOrNpc();
    const npcShadow = shadowRadiusForWorldHeightM(npcHm);
    if (anim && !anim.single) {
      const set: AnimSet = { idle: anim, gang: anim };
      const v = new DirSprite(set, scaleKForWorldHeightM(set, npcHm), npcShadow, false, 'npc');
      v.dir = NPC_FACE_DIR;
      v.play('idle');
      this.sprite = v;
      this.view.addChild(v);
    } else if (anim?.frames[0]?.[0]) {
      const set: AnimSet = { idle: anim, gang: anim };
      const v = new DirSprite(set, scaleKForWorldHeightM(set, npcHm), npcShadow, true, 'npc');
      v.dir = NPC_FACE_DIR;
      v.play('idle');
      this.sprite = v;
      this.view.addChild(v);
    } else {
      const g = new Graphics().ellipse(0, -24, 14, 22).fill({ color: 0x9a8a70, alpha: 0.9 });
      g.circle(0, -48, 10).fill(0xc4b59a);
      this.view.addChild(g);
    }
    this.syncView();
  }

  setRoutineTarget(x: number, y: number, aktivitet: string): void {
    this.target.x = x;
    this.target.y = y;
    this.atTarget = Math.hypot(x - this.resolved.pos.x, y - this.resolved.pos.y) <= 0.35;
    if (this.sprite) {
      const moving = !this.atTarget || activityIsMoving(aktivitet);
      this.sprite.play(moving ? 'gang' : 'idle');
    }
  }

  update(dt: number, zone: Zone): void {
    if (!this.atTarget) {
      this.atTarget = stepNpcToward(this.resolved.pos, this.target, dt, zone);
      if (this.atTarget && this.sprite) this.sprite.play('idle');
    }
    this.sprite?.update(dt);
    this.syncView();
  }

  private syncView(): void {
    const p = Iso.worldToScreen(this.resolved.pos.x, this.resolved.pos.y);
    this.view.position.set(p.x, p.y);
    this.view.zIndex = this.resolved.pos.x + this.resolved.pos.y;
  }
}
