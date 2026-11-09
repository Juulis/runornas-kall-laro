import { Assets as PixiAssets, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Vec2 } from '../core/GameContext';
import type { FoundRegistry } from '../core/SaveBackend';
import type { AssetStore } from '../render/Assets';
import { Iso } from '../render/Iso';
import { autoEquipItem } from '../learn/gearScore';
import { shouldKeepInInventory } from '../logic/inventoryDiscard';
import type { Drop, Item } from '../logic/loot/types';
import type { GroundDrop, World } from './World';

const QRANK: Record<string, number> = { legendary: 0, set: 1, rare: 2, magic: 3, normal: 4 };

/** Lägger loot på marken, plockar upp (guld automatiskt) och registrerar fynd för loreboken via FoundRegistry. */
export class LootSystem {
  constructor(
    private readonly w: () => World,
    private readonly assets: AssetStore,
    private readonly found: () => FoundRegistry,
  ) {}

  /** Lägger droppar (rullade av GameAuthority) runt en punkt. */
  scatter(at: Vec2, drops: Drop[]): void {
    const w = this.w();
    const m = { pos: at };
    drops.forEach((d, i) => {
      const a = (i / drops.length) * 6.28 + w.rng.next();
      const r = drops.length > 1 ? 0.6 + w.rng.next() * 0.6 : w.rng.next() * 0.3;
      const p = { x: m.pos.x + Math.cos(a) * r, y: m.pos.y + Math.sin(a) * r };
      w.zone.collide(p, 0.2);
      this.spawn(p, d);
    });
  }

  label(d: Drop): string {
    const L = this.w().L;
    if (d.gold) return this.w().text.t('tooltip.gold', { n: d.gold });
    const it = d.item as Item;
    return L.nameOf(it) + ((it.n ?? 1) > 1 ? ` (${it.n})` : '');
  }
  color(d: Drop): string {
    return d.gold ? '#f2c46b' : this.w().L.colorOf(d.item as Item);
  }
  rank(d: Drop): number {
    return d.item ? (QRANK[d.item.quality] ?? 5) : 6;
  }

  spawn(pos: Vec2, d: Drop): void {
    const w = this.w();
    const view = new Container();
    const col = parseInt(this.color(d).slice(1), 16);
    const glow = new Graphics().ellipse(0, 0, 22, 11).fill({ color: col, alpha: 0.25 });
    view.addChild(glow);
    if (d.gold) view.addChild(new Graphics().circle(0, -6, 7).fill(0xf2c46b).stroke({ color: 0x8a6420, width: 2 }));
    else {
      const it = d.item as Item;
      const q = it.quality;
      if (q === 'set' || q === 'legendary') view.addChild(new Graphics().rect(-6, -260, 12, 260).fill({ color: col, alpha: 0.22 }));
      const url = this.assets.iconUrl([it.leg, w.L.setPiece(it)?.id, it.set && `${it.set}.${it.base}`, it.base]);
      if (url) {
        const s = new Sprite();
        s.anchor.set(0.5, 0.85);
        s.scale.set(0.32);
        s.rotation = -0.35;
        view.addChild(s);
        void PixiAssets.load<Texture>(url).then((t) => {
          if (!s.destroyed) s.texture = t;
        });
      } else view.addChild(new Graphics().poly([0, -18, 8, -8, 0, 0, -8, -8]).fill(col));
      w.bus.emit('loot_drop', { quality: q });
      if (q === 'set' || q === 'legendary') w.fb.flash(w.text.t('msg.fell', { name: this.label(d) }), this.color(d));
    }
    const s = Iso.worldToScreen(pos.x, pos.y);
    view.position.set(s.x, s.y);
    view.zIndex = pos.x + pos.y - 0.5;
    w.objects.addChild(view);
    w.drops.push({ pos: { ...pos }, data: d, view, t: w.rng.next() * 6 });
  }

  /**
   * Plockar upp droppar direkt. Bättre utrustning tas på.
   * Bara unika, set och legendaries läggs i väskan. Annat som inte tas på slängs.
   * Returnerar namn på det som togs på, så anroparen kan visa toasten efter nivå-upp.
   */
  grantAuto(drops: Drop[]): string[] {
    const w = this.w();
    const h = w.hero;
    const equipped: string[] = [];
    for (const d of drops) {
      if (d.gold) {
        h.s.gold += d.gold;
        w.bus.emit('gold', { amount: d.gold });
        w.fb.float(h.pos, w.text.t('msg.gold', { amount: d.gold }), 'gold');
        continue;
      }
      const it = d.item;
      if (!it) continue;
      void this.recordFound(it).catch((e) => console.warn('LootSystem: fyndregistrering misslyckades', e));
      const name = this.label(d);
      const foundId = w.L.foundId(it);
      if (autoEquipItem(w.L, h, it)) {
        equipped.push(name);
        w.bus.emit('pickup', { itemId: foundId, first: false, quality: it.quality });
        continue;
      }
      if (!shouldKeepInInventory(it)) continue;
      if (h.inv.add(it)) {
        w.bus.emit('pickup', { itemId: foundId, first: false, quality: it.quality });
        continue;
      }
      this.spawn(h.pos, { item: it });
    }
    return equipped;
  }

  /** Slängt föremål från väskan hamnar på marken nära hjälten. */
  dropFromHero(it: Item): void {
    const w = this.w();
    const h = w.hero;
    const a = w.rng.float(0, Math.PI * 2);
    const d = 0.35 + w.rng.float(0, 0.35);
    const pos = { x: h.pos.x + Math.cos(a) * d, y: h.pos.y + Math.sin(a) * d };
    w.zone.collide(pos, 0.2);
    this.spawn(pos, { item: it });
  }

  remove(g: GroundDrop): void {
    const w = this.w();
    g.view.destroy({ children: true });
    const i = w.drops.indexOf(g);
    if (i >= 0) w.drops.splice(i, 1);
  }

  /** Plockar upp. Returnerar false om väskan är full. */
  async pickup(g: GroundDrop): Promise<boolean> {
    const w = this.w();
    const h = w.hero;
    if (g.data.gold) {
      h.s.gold += g.data.gold;
      w.bus.emit('gold', { amount: g.data.gold });
      w.fb.float(h.pos, w.text.t('msg.gold', { amount: g.data.gold }), 'gold');
      this.remove(g);
      return true;
    }
    const it = g.data.item as Item;
    const name = this.label(g.data);
    if (g.picking) return false;
    if (!h.inv.findSpot(it)) {
      w.fb.flash(w.text.t('msg.bag_full'));
      return false;
    }
    g.picking = true;
    const foundId = w.L.foundId(it);
    try {
      const first = await this.recordFound(it);
      try {
        if (!h.inv.add(it)) {
          if (first) await this.found().unmarkFound(foundId);
          w.fb.flash(w.text.t('msg.bag_full'));
          return false;
        }
        this.remove(g);
        w.bus.emit('pickup', { itemId: foundId, first, quality: it.quality });
        w.fb.flash(w.text.t('msg.found', { name }), this.color(g.data));
        return true;
      } catch (e) {
        if (first) await this.found().unmarkFound(foundId);
        throw e;
      }
    } catch (e) {
      console.warn('LootSystem: upplock misslyckades', e);
      return false;
    } finally {
      if (w.drops.includes(g)) g.picking = false;
    }
  }

  /** Första upplock per föremåls-id registreras via FoundRegistry (SaveBackend), aldrig direkt i localStorage. */
  private async recordFound(it: Item): Promise<boolean> {
    return await this.found().markFound(this.w().L.foundId(it), {
      first: new Date().toISOString(),
      quality: it.quality,
      base: it.base,
      ilvl: it.ilvl,
    });
  }

  update(dt: number): void {
    const w = this.w();
    for (const g of [...w.drops]) {
      g.t += dt;
      const top = g.view.children.at(-1);
      if (top) top.y = Math.sin(g.t * 3) * 2;
      if (g.data.gold && Math.hypot(g.pos.x - w.hero.pos.x, g.pos.y - w.hero.pos.y) < 1.2) void this.pickup(g);
    }
  }
}
