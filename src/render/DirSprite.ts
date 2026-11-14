import { Container, Sprite } from 'pixi.js';
import { equipmentDrawOrder, equipmentDrawOrderUnarmed, type UtrustningLayer } from './heroEquipment';
import type { HeroEquipmentViewState } from './heroEquipmentView';
import { attachShadow, type ShadowKind } from './ShadowLayer';
import type { Anim, AnimName, AnimSet } from './spriteAnim';
import { animDisplayScale, animSetRefHeight } from './spriteLayout';

/** Animerad 8-riktningsfigur med skugga. Fotpunkt = containerns origo. */
export class DirSprite extends Container {
  readonly sprite = new Sprite();
  /** Delad skuggtextur, barn vid fotpunkten så den följer med utan extra sync. */
  readonly shadowSprite: Sprite;
  private readonly layerRoot = new Container();
  private readonly layerSprites: Sprite[] = [];
  private equipment: HeroEquipmentViewState | null = null;
  private anim: AnimName = 'idle';
  private t = 0;
  dir = 0;
  done = false;
  /** Attackfart m.m. (1 = normal). */
  playbackRate = 1;
  /** Extra vertikal offset (t.ex. gammal attack-nick). */
  bobY = 0;

  private readonly refH: number;

  constructor(
    private readonly set: AnimSet,
    private readonly scaleK: number,
    shadowR: number,
    private readonly mirrorSingle = true,
    shadowKind: ShadowKind = 'hero',
  ) {
    super();
    void shadowR;
    this.refH = animSetRefHeight(set);
    this.shadowSprite = attachShadow(this, shadowKind);
    this.addChild(this.layerRoot, this.sprite);
    this.apply();
  }

  /** Visa eller dölj skuggan utan att bygga om figuren. */
  setShadowVisible(on: boolean): void {
    this.shadowSprite.visible = on;
    this.shadowSprite.renderable = on;
  }

  /** Sätter skuggans alfa (natt och inställning kan också styra den delade listan). */
  setShadowAlpha(alpha: number): void {
    this.shadowSprite.alpha = alpha;
  }

  /** Riddare paper-doll; null = enkel sprite (amazon/barbar). */
  setEquipmentView(state: HeroEquipmentViewState | null): void {
    this.equipment = state;
    if (!state) {
      this.layerRoot.visible = false;
      this.sprite.visible = true;
      return;
    }
    this.layerRoot.visible = true;
    this.sprite.visible = false;
    const maxLayers = 8;
    while (this.layerSprites.length < maxLayers) {
      const sp = new Sprite();
      this.layerSprites.push(sp);
      this.layerRoot.addChild(sp);
    }
    this.apply();
  }

  /** Färgar kropp och paper-doll-lager så en blink syns även på riddaren. */
  applyTint(color: number): void {
    this.sprite.tint = color;
    for (const sp of this.layerSprites) sp.tint = color;
  }

  play(name: AnimName, restart = false): void {
    let n: AnimName = name;
    if (!this.set[n]) {
      if (n === 'run') n = this.set.gang ? 'gang' : 'idle';
      else n = this.set.idle ? 'idle' : 'gang';
    }
    if (n === this.anim && !restart) return;
    const locomotion = (a: AnimName, b: AnimName) => (a === 'gang' && b === 'run') || (a === 'run' && b === 'gang');
    const keepPhase = locomotion(this.anim, n);
    const prev = this.cur();
    this.anim = n;
    if (!keepPhase) this.t = 0;
    else if (prev) {
      const next = this.cur();
      if (next && prev.fps > 0) this.t *= next.fps / prev.fps;
    }
    this.done = false;
  }

  update(dt: number): void {
    this.t += dt * this.playbackRate;
    this.apply();
  }

  /** Visuell höjd i px (för etiketter och träffytor). */
  get height2(): number {
    const a = this.cur();
    if (!a) return 60;
    const k = animDisplayScale(this.scaleK, this.refH, a);
    return a.anchor[1] * k;
  }

  private cur(): Anim | undefined {
    return this.set[this.anim] ?? this.set.idle ?? this.set.gang ?? this.set.run;
  }

  /** Aktuell animation (för träffsynk). */
  currentAnim(): Anim | undefined {
    return this.cur();
  }

  hasAnim(name: AnimName): boolean {
    return !!this.set[name];
  }

  getAnim(name: AnimName): Anim | undefined {
    return this.set[name];
  }

  private apply(): void {
    const a = this.cur();
    if (!a) return;
    const single = !!a.single;
    const row = a.frames[single ? 0 : this.dir] ?? a.frames[0];
    if (!row) return;
    let f = Math.floor(this.t * a.fps);
    if (a.loop) f %= row.length;
    else if (f >= row.length) {
      f = row.length - 1;
      this.done = true;
    }
    const mirror = single && this.mirrorSingle && this.dir >= 4;
    const ax = a.alignX?.[single ? 0 : this.dir]?.[f] ?? 0;
    const ay = a.alignY?.[single ? 0 : this.dir]?.[f] ?? 0;
    const k = animDisplayScale(this.scaleK, this.refH, a);
    const d = single ? 0 : this.dir;

    if (this.equipment) {
      const layerAnims = this.equipment.layersByAnim[this.anim] ?? this.equipment.layersByAnim.idle;
      const drawOrders = this.equipment.drawOrdersByAnim[this.anim];
      if (!layerAnims || !drawOrders) {
        for (const sp of this.layerSprites) sp.visible = false;
        return;
      }
      const order =
        this.equipment.weaponVisual == null
          ? equipmentDrawOrderUnarmed(drawOrders, d, this.equipment.activeLayers)
          : equipmentDrawOrder(drawOrders, this.equipment.weaponVisual, d, this.equipment.activeLayers);
      order.forEach((layerName, i) => {
        const sp = this.layerSprites[i];
        if (!sp) return;
        const la = layerAnims[layerName as UtrustningLayer];
        if (!la) {
          sp.visible = false;
          return;
        }
        const lSingle = !!la.single;
        const lRow = la.frames[lSingle ? 0 : d] ?? la.frames[0];
        const lLen = lRow?.length ?? 0;
        let lf = la === a ? f : Math.floor(this.t * (la.fps || a.fps));
        if (lLen > 0) lf = la.loop === false ? Math.min(lf, lLen - 1) : lf % lLen;
        const lTex = lRow?.[lf];
        if (!lTex) {
          sp.visible = false;
          return;
        }
        sp.visible = true;
        sp.texture = lTex;
        const lax = la.alignX?.[lSingle ? 0 : d]?.[lf] ?? ax;
        const lay = la.alignY?.[lSingle ? 0 : d]?.[lf] ?? ay;
        sp.anchor.set(la.anchor[0] / la.w, la.anchor[1] / la.h);
        sp.scale.set(mirror ? -k : k, k);
        sp.x = lax * k * (mirror ? -1 : 1);
        sp.y = lay * k + this.bobY;
      });
      for (let i = order.length; i < this.layerSprites.length; i++) {
        const sp = this.layerSprites[i];
        if (sp) sp.visible = false;
      }
      return;
    }

    const tex = row[f];
    if (tex) this.sprite.texture = tex;
    this.sprite.anchor.set(a.anchor[0] / a.w, a.anchor[1] / a.h);
    this.sprite.scale.set(mirror ? -k : k, k);
    this.sprite.x = ax * k * (mirror ? -1 : 1);
    this.sprite.y = ay * k + this.bobY;
  }
}
