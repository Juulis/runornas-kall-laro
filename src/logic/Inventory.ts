import type { Loot } from './loot/Loot';
import { isQuestItemProtected } from '../quest/questItems';
import { isConsumableCategory } from './consumables';
import { SLOTS, type Equip, type Item, type Slot } from './loot/types';

export const BAG_W = 10;
export const BAG_H = 12;

/** Väska (10×12) och utrustning: logik utan DOM. Ändringar meddelas via onChange. */
export class Inventory {
  onChange: () => void = () => undefined;

  constructor(
    private readonly L: Loot,
    readonly bag: Item[],
    readonly equip: Equip,
    private readonly level: () => number,
  ) {}

  size(it: Item): [number, number] {
    return this.L.sizeOf(this.L.base(it));
  }
  private overlaps(x: number, y: number, w: number, h: number, ignore?: Item): Item[] {
    return this.bag.filter((o) => {
      if (o === ignore) return false;
      const [ow, oh] = this.size(o);
      const ox = o.x ?? 0;
      const oy = o.y ?? 0;
      return ox < x + w && x < ox + ow && oy < y + h && y < oy + oh;
    });
  }
  fits(x: number, y: number, w: number, h: number, ignore?: Item): boolean {
    return x >= 0 && y >= 0 && x + w <= BAG_W && y + h <= BAG_H && this.overlaps(x, y, w, h, ignore).length === 0;
  }
  findSpot(it: Item, ignore?: Item): [number, number] | null {
    const [w, h] = this.size(it);
    for (let x = 0; x <= BAG_W - w; x++) for (let y = 0; y <= BAG_H - h; y++) if (this.fits(x, y, w, h, ignore)) return [x, y];
    return null;
  }
  add(it: Item): boolean {
    const b = this.L.base(it);
    if (b.stack) {
      const st = this.bag.find((o) => o.base === it.base && (o.n ?? 1) < (b.stack ?? 1));
      if (st) {
        const m = Math.min((b.stack ?? 1) - (st.n ?? 1), it.n ?? 1);
        st.n = (st.n ?? 1) + m;
        it.n = (it.n ?? 1) - m;
        if (it.n <= 0) return this.changed();
      }
    }
    const p = this.findSpot(it);
    if (!p) return false;
    [it.x, it.y] = p;
    this.bag.push(it);
    return this.changed();
  }
  reqOk(it: Item): boolean {
    const r = this.L.base(it).requirements;
    return !r?.level || r.level <= this.level();
  }
  slotKind(s: Slot): string {
    return s === 'ring1' || s === 'ring2' ? 'ring' : s;
  }
  canEquip(it: Item, slot: Slot): boolean {
    const b = this.L.base(it);
    if (!this.L.equipable(b) || this.L.slotOf(b) !== this.slotKind(slot) || !this.reqOk(it)) return false;
    const w = this.equip.vapen;
    return !(slot === 'offhand' && w && w !== it && this.L.base(w).two_handed);
  }
  bestSlot(it: Item): Slot | null {
    const k = this.L.slotOf(this.L.base(it));
    if (k === 'ring') return !this.equip.ring1 ? 'ring1' : !this.equip.ring2 ? 'ring2' : 'ring1';
    return (SLOTS as readonly string[]).includes(k ?? '') ? (k as Slot) : null;
  }
  slotOfItem(it: Item): Slot | undefined {
    return SLOTS.find((s) => this.equip[s] === it);
  }
  remove(it: Item): void {
    if (isQuestItemProtected(it)) return;
    this.detach(it);
  }

  /** Tar bort föremål från väska/utrustning (t.ex. efter bekräftad slängning). */
  detach(it: Item): void {
    const i = this.bag.indexOf(it);
    if (i >= 0) this.bag.splice(i, 1);
    const s = this.slotOfItem(it);
    if (s) this.equip[s] = null;
    this.changed();
  }
  /** Tar på; det gamla (och offhand vid tvåhandsvapen) läggs i väskan, gärna där det nya låg. */
  equipTo(it: Item, slot: Slot): boolean {
    if (!this.canEquip(it, slot)) return false;
    const snapBag = this.bag.slice();
    const snapEq = { ...this.equip };
    const from = { x: it.x ?? 0, y: it.y ?? 0, inBag: this.bag.includes(it) };
    this.detach(it);
    const old = this.equip[slot];
    this.equip[slot] = it;
    delete it.x;
    delete it.y;
    const out = [old];
    if (slot === 'vapen' && this.L.base(it).two_handed && this.equip.offhand) {
      out.push(this.equip.offhand);
      this.equip.offhand = null;
    }
    for (const o of out) {
      if (!o) continue;
      const [w, h] = this.size(o);
      const p = from.inBag && this.fits(from.x, from.y, w, h) ? ([from.x, from.y] as [number, number]) : this.findSpot(o);
      if (!p) {
        for (const s of SLOTS) this.equip[s] = snapEq[s] ?? null;
        this.bag.length = 0;
        this.bag.push(...snapBag);
        it.x = from.x;
        it.y = from.y;
        return false;
      }
      [o.x, o.y] = p;
      this.bag.push(o);
      from.inBag = false;
    }
    return this.changed();
  }
  unequip(slot: Slot, pos?: [number, number]): boolean {
    const it = this.equip[slot];
    if (!it) return false;
    const [w, h] = this.size(it);
    const p = pos && this.fits(pos[0], pos[1], w, h) ? pos : this.findSpot(it);
    if (!p) return false;
    this.equip[slot] = null;
    [it.x, it.y] = p;
    this.bag.push(it);
    return this.changed();
  }
  /** Lägger ett upplockat föremål (ur handen) på (x,y). Returnerar föremålet som byttes ut (nu i handen), null om tomt, false om ogiltigt. */
  place(it: Item, x: number, y: number): Item | null | false {
    const [w, h] = this.size(it);
    if (x < 0 || y < 0 || x + w > BAG_W || y + h > BAG_H) return false;
    const ov = this.overlaps(x, y, w, h, it);
    if (ov.length > 1) return false;
    const swapped = ov[0] ?? null;
    if (swapped) this.bag.splice(this.bag.indexOf(swapped), 1);
    it.x = x;
    it.y = y;
    this.bag.push(it);
    this.changed();
    return swapped;
  }
  /** Lägger föremålet i handen på en plats. Returnerar det som låg där (nu i handen), null om tomt, false om ogiltigt. */
  placeSlot(it: Item, slot: Slot): Item | null | false {
    if (!this.canEquip(it, slot)) return false;
    const old = this.equip[slot] ?? null;
    this.equip[slot] = it;
    delete it.x;
    delete it.y;
    if (slot === 'vapen' && this.L.base(it).two_handed && this.equip.offhand) {
      const off = this.equip.offhand;
      this.equip.offhand = null;
      if (!this.add(off)) {
        this.equip.offhand = off;
        this.equip[slot] = old;
        return false;
      }
    }
    this.changed();
    return old;
  }
  /** Lyfter ett föremål ur väska/plats (till handen). */
  lift(it: Item): void {
    this.detach(it);
  }
  findConsumable(kind: 'hp' | 'st'): Item | undefined {
    return this.bag.find((i) => {
      const b = this.L.base(i);
      return isConsumableCategory(b.category) && (kind === 'hp' ? !!(b.heal ?? b.heal_pct) : !!(b.stamina ?? b.stamina_pct));
    });
  }
  countConsumables(kind: 'hp' | 'st'): number {
    return this.bag.reduce((s, i) => {
      const b = this.L.base(i);
      const ok = isConsumableCategory(b.category) && (kind === 'hp' ? !!(b.heal ?? b.heal_pct) : !!(b.stamina ?? b.stamina_pct));
      return s + (ok ? (i.n ?? 1) : 0);
    }, 0);
  }
  private changed(): true {
    this.onChange();
    return true;
  }
}
