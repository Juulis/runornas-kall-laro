import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { Hero } from '../entities/Hero';
import { BAG_H, BAG_W } from '../logic/Inventory';
import type { Loot } from '../logic/loot/Loot';
import { SLOTS, type Item, type Slot } from '../logic/loot/types';
import { assetUrl, type AssetStore } from '../render/Assets';
import type { Text, TextKey } from '../text/Text';
import { formatSetBonusTier, setLocalizedName } from '../data/setText';
import type { ItemText } from './ItemText';
import type { Tooltip } from './Tooltip';
import { discardNeedsConfirm } from '../logic/inventoryDiscard';
import { isQuestItemProtected } from '../quest/questItems';

const CELL = 34;
const SLOT_POS: Record<Slot, [number, number, number, number]> = {
  hjalm: [8, 6, 2, 2],
  brost: [8, 80, 2, 3],
  handskar: [8, 188, 2, 2],
  stovlar: [8, 262, 2, 2],
  amulett: [84, 6, 1, 1],
  vapen: [224, 6, 2, 4],
  offhand: [224, 148, 2, 3],
  ring1: [80, 262, 1, 1],
  balte: [116, 262, 2, 1],
  ring2: [186, 262, 1, 1],
};
const pct = (v: number): string => Math.round(v * 1000) / 10 + ' %';

/**
 * Inventory i Diablo 2-stil: gubbe med platser, väska 10×12. Klick lyfter ett föremål till handen, klick lägger det
 * (byte om platsen är upptagen). Högerklick: ta på / ta av / drick. Tooltip med jämförelse och statistikruta.
 */
export class InventoryUI {
  private readonly win = document.createElement('div');
  private readonly doll: HTMLDivElement;
  private readonly bag: HTMLDivElement;
  private readonly statBox: HTMLDivElement;
  private readonly handEl = document.createElement('div');
  private readonly slotEl = {} as Record<Slot, HTMLDivElement>;
  private hand: Item | null = null;
  private hero: Hero | null = null;
  private readonly dropBtn: HTMLButtonElement;
  private readonly confirmEl: HTMLDivElement;
  private readonly off: (() => void)[] = [];

  constructor(
    private readonly L: Loot,
    private readonly text: Text,
    private readonly itemText: ItemText,
    private readonly tip: Tooltip,
    private readonly assets: AssetStore,
    private readonly bus: EventBus<GameEvents>,
    private readonly flash: (t: string) => void,
    private readonly onDrop: (it: Item) => void,
  ) {
    const w = this.win;
    w.id = 'invWin';
    w.className = 'hidden';
    w.innerHTML = `<div class="iwHead"><span class="iwTitle"></span> <small class="iwHint"></small><button type="button" class="iwDrop hidden"></button><button class="iwClose">✕</button></div>
      <div class="iwConfirm hidden"></div>
      <div class="iwBody"><div class="iwLeft"><div class="doll"><div class="dollFig"></div></div><div class="bag"></div></div><div class="statBox"></div></div>`;
    document.body.appendChild(w);
    this.doll = w.querySelector('.doll') as HTMLDivElement;
    this.bag = w.querySelector('.bag') as HTMLDivElement;
    this.statBox = w.querySelector('.statBox') as HTMLDivElement;
    this.bag.style.width = BAG_W * CELL + 'px';
    this.bag.style.height = BAG_H * CELL + 'px';
    for (const s of SLOTS) {
      const [x, y, sw, sh] = SLOT_POS[s];
      const e = document.createElement('div');
      e.className = 'eqSlot';
      e.dataset.slot = s;
      Object.assign(e.style, { left: x + 'px', top: y + 'px', width: sw * CELL + 'px', height: sh * CELL + 'px' });
      this.doll.appendChild(e);
      this.slotEl[s] = e;
    }
    this.handEl.className = 'handItem hidden';
    document.body.appendChild(this.handEl);
    this.dropBtn = w.querySelector('.iwDrop') as HTMLButtonElement;
    this.confirmEl = w.querySelector('.iwConfirm') as HTMLDivElement;
    this.dropBtn.onclick = () => this.hand && this.requestDrop(this.hand);
    (w.querySelector('.iwClose') as HTMLButtonElement).onclick = () => this.close();
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, t: K, fn: (e: HTMLElementEventMap[K]) => void): void => {
      el.addEventListener(t, fn as EventListener);
      this.off.push(() => el.removeEventListener(t, fn as EventListener));
    };
    on(w, 'mousemove', (e) => this.hover(e));
    on(w, 'mouseleave', () => this.tip.hide());
    on(w, 'mousedown', (e) => this.click(e));
    on(w, 'contextmenu', (e) => this.rclick(e));
    on(window, 'mousemove', (e) => this.moveHand(e));
    on(window, 'mouseup', (e) => this.releaseHand(e));
    this.relabel();
  }

  /** Anropas av Game efter att föremålet lagts på marken. */
  itemDropped(it: Item): void {
    if (this.hand === it) {
      this.hand = null;
      this.renderHand();
    }
    this.render();
  }

  /** Texter i fönstret (ritas om vid språkbyte). */
  relabel(): void {
    (this.win.querySelector('.iwTitle') as HTMLElement).textContent = this.text.t('inv.title');
    (this.win.querySelector('.iwHint') as HTMLElement).textContent = this.text.t('inv.hint');
    this.dropBtn.textContent = this.text.t('inv.drop');
    for (const s of SLOTS) {
      this.slotEl[s].title = this.text.t(`slot.${s}` as TextKey);
      this.slotEl[s].dataset.ph = this.text.t(`slot.${s}` as TextKey);
    }
    if (this.isOpen()) this.render();
  }

  setHero(h: Hero): void {
    this.hero = h;
    this.hand = null;
    const fig = this.win.querySelector('.dollFig') as HTMLElement;
    fig.style.backgroundImage = `url(${assetUrl('2d/sprites/hero/riddare_idle_8dir.png')})`;
    if (this.isOpen()) this.render();
  }

  isOpen(): boolean {
    return !this.win.classList.contains('hidden');
  }
  /** Föremål i handen blockerar världsklick. */
  get holding(): boolean {
    return !!this.hand;
  }
  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }
  open(): void {
    this.win.classList.remove('hidden');
    this.render();
    this.bus.emit('ui_open', { panel: 'inventory' });
  }
  close(): void {
    this.hideConfirm();
    if (this.hand && this.hero) {
      if (!this.hero.inv.add(this.hand)) return this.flash(this.text.t('msg.bag_full'));
      this.hand = null;
      this.renderHand();
    }
    this.win.classList.add('hidden');
    this.tip.hide();
    this.bus.emit('ui_close', { panel: 'inventory' });
  }

  private icon(it: Item, w: number, h: number): string {
    const url = this.assets.iconUrl([it.leg, this.L.setPiece(it)?.id, it.set && `${it.set}.${it.base}`, it.base]);
    const tall = h >= w * 1.9;
    const s = tall ? Math.min(h / 1.3, w * 2.1) : Math.min(w, h) * 0.92;
    if (!url) return `<i class="ico emo">❔</i>`;
    return `<i class="ico" style="width:${s}px;height:${s}px;background-image:url(${url})${tall ? ';transform:rotate(-45deg)' : ''}"></i>`;
  }
  private itemEl(it: Item, w: number, h: number): HTMLDivElement {
    const e = document.createElement('div');
    e.className = 'itm q-' + it.quality;
    e.style.width = w * CELL - 2 + 'px';
    e.style.height = h * CELL - 2 + 'px';
    e.style.setProperty('--qc', this.L.colorOf(it));
    e.style.setProperty('--ram', `url(${this.assets.frameUrl(it.quality)})`);
    e.innerHTML = this.icon(it, w * CELL - 2, h * CELL - 2) + ((it.n ?? 1) > 1 ? `<em>${it.n}</em>` : '');
    e.dataset.uid = it.uid;
    return e;
  }

  render(): void {
    const hero = this.hero;
    if (!hero) return;
    const inv = hero.inv;
    for (const s of SLOTS) {
      const e = this.slotEl[s];
      e.querySelectorAll('.itm').forEach((x) => x.remove());
      const it = inv.equip[s];
      e.classList.toggle('filled', !!it);
      const wpn = inv.equip.vapen;
      e.classList.toggle('blocked', s === 'offhand' && !!wpn && !!this.L.base(wpn).two_handed);
      e.classList.toggle('can', !!this.hand && inv.canEquip(this.hand, s));
      if (it) {
        const [, , w, h] = SLOT_POS[s];
        const el = this.itemEl(it, w, h);
        el.classList.add('inSlot');
        e.appendChild(el);
      }
    }
    this.bag.querySelectorAll('.itm').forEach((x) => x.remove());
    for (const it of inv.bag) {
      const [w, h] = inv.size(it);
      const el = this.itemEl(it, w, h);
      el.style.left = (it.x ?? 0) * CELL + 1 + 'px';
      el.style.top = (it.y ?? 0) * CELL + 1 + 'px';
      this.bag.appendChild(el);
    }
    this.renderStats();
  }

  private renderStats(): void {
    const hero = this.hero;
    if (!hero) return;
    const st = hero.stats;
    const lv = hero.level;
    const t = this.text;
    const hit = this.L.hitChance(st.AR, 15 + 8 * lv, lv, lv);
    const row = (k: TextKey, v: string | number): string => `<div><span>${t.t(k)}</span><b>${v}</b></div>`;
    let setBlock = '';
    const bySet = new Map<string, string[]>();
    for (const tag of st.setActive) {
      const [sid, tier] = tag.split(':');
      const def = sid ? this.L.SETS[sid] : undefined;
      if (!sid || !tier || !def) continue;
      const line = formatSetBonusTier(this.text, sid, tier, def.bonuses[tier] as Record<string, unknown>, (k, v) =>
        this.itemText.stat(k, v),
      );
      if (!line) continue;
      const list = bySet.get(sid) ?? [];
      list.push(`${t.t('tooltip.set_parts', { n: tier })}: ${line}`);
      bySet.set(sid, list);
    }
    if (bySet.size) {
      setBlock = `<div class="setActiveH">${t.t('inv.active_set_bonuses')}</div>`;
      for (const [sid, lines] of bySet) {
        const name = setLocalizedName(sid, this.L.SETS[sid]?.name ?? sid);
        setBlock += `<div class="setActiveSet">${name}</div>`;
        for (const ln of lines) setBlock += `<div class="setActiveLine">${ln}</div>`;
      }
    }
    this.statBox.innerHTML =
      `<h4>${t.data('klasser', hero.cls.id, 'name', hero.cls.name)} · ${t.t('hud.level', { level: lv })}</h4>` +
      row('stat.life', st.maxHp) +
      row('stat.damage', `${st.dmgMin}–${st.dmgMax}`) +
      row('stat.defense', Math.round(st.defense)) +
      row('stat.block', pct(st.block)) +
      row('stat.hit', pct(hit)) +
      row('stat.strong', pct(st.strong)) +
      row('stat.crit', pct(st.crit)) +
      row('stat.mf', Math.round(st.mf) + ' %') +
      row('stat.speed', st.speed.toFixed(2)) +
      setBlock +
      `<div class="gold"><span>${t.t('inv.gold')}</span><b>${hero.s.gold}</b></div>`;
  }

  private find(uid: string | undefined): Item | undefined {
    const inv = this.hero?.inv;
    if (!inv || !uid) return undefined;
    return inv.bag.find((i) => i.uid === uid) ?? SLOTS.map((s) => inv.equip[s]).find((i) => i?.uid === uid) ?? undefined;
  }

  private hover(e: MouseEvent): void {
    if (this.hand || !this.hero) return this.tip.hide();
    const el = (e.target as HTMLElement).closest<HTMLElement>('.itm');
    const it = this.find(el?.dataset.uid);
    if (!it || !el) return this.tip.hide();
    this.tip.show(this.itemText.html(it, this.hero, !el.classList.contains('inSlot')), e.clientX, e.clientY, it.quality);
  }

  private click(e: MouseEvent): void {
    if (e.button !== 0 || !this.hero) return;
    e.preventDefault();
    const inv = this.hero.inv;
    const target = e.target as HTMLElement;
    const slotEl = target.closest<HTMLElement>('.eqSlot');
    const slot = slotEl?.dataset.slot as Slot | undefined;
    this.tip.hide();
    if (!this.hand) {
      const it = this.find(target.closest<HTMLElement>('.itm')?.dataset.uid);
      if (!it) return;
      inv.lift(it);
      this.hand = it;
    } else if (slot) {
      const r = inv.placeSlot(this.hand, slot);
      if (r === false) {
        if (!inv.reqOk(this.hand)) this.flash(this.text.t('msg.need_level'));
        return;
      }
      this.hand = r;
    } else {
      const br = this.bag.getBoundingClientRect();
      if (e.clientX < br.left || e.clientX >= br.right || e.clientY < br.top || e.clientY >= br.bottom) return;
      const [w, h] = inv.size(this.hand);
      const x = Math.round((e.clientX - br.left) / CELL - w / 2);
      const y = Math.round((e.clientY - br.top) / CELL - h / 2);
      const r = inv.place(this.hand, Math.max(0, Math.min(BAG_W - w, x)), Math.max(0, Math.min(BAG_H - h, y)));
      if (r === false) return;
      this.hand = r;
    }
    this.renderHand(e);
    this.render();
  }

  private rclick(e: MouseEvent): void {
    e.preventDefault();
    if (!this.hero) return;
    const inv = this.hero.inv;
    const el = (e.target as HTMLElement).closest<HTMLElement>('.itm');
    const it = this.find(el?.dataset.uid);
    if (e.shiftKey && it) {
      this.tip.hide();
      this.requestDrop(it);
      return;
    }
    if (this.hand || !it) return;
    this.tip.hide();
    const b = this.L.base(it);
    const slot = inv.slotOfItem(it);
    if (slot) {
      if (!inv.unequip(slot)) this.flash(this.text.t('msg.bag_full'));
    } else if (b.category === 'mat' || b.category === 'dryck') this.hero.use(it);
    else if (this.L.equipable(b)) {
      const best = inv.bestSlot(it);
      if (best && !inv.equipTo(it, best)) this.flash(this.text.t(inv.reqOk(it) ? 'msg.bag_full' : 'msg.need_level'));
    }
    this.render();
  }

  private releaseHand(e: MouseEvent): void {
    if (!this.hand || !this.isOpen() || e.button !== 0) return;
    const r = this.win.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) this.requestDrop(this.hand);
  }

  private requestDrop(it: Item): void {
    if (!this.hero) return;
    if (isQuestItemProtected(it)) {
      this.flash(this.text.t('inv.quest_no_drop'));
      return;
    }
    const name = this.L.nameOf(it);
    if (discardNeedsConfirm(it)) {
      this.showConfirm(
        this.text.t('inv.drop_confirm', { name }),
        () => {
          this.hideConfirm();
          this.onDrop(it);
        },
        () => this.hideConfirm(),
      );
      return;
    }
    this.onDrop(it);
  }

  private showConfirm(question: string, onYes: () => void, onNo: () => void): void {
    this.confirmEl.classList.remove('hidden');
    this.confirmEl.innerHTML = '';
    const q = document.createElement('p');
    q.textContent = question;
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.textContent = this.text.t('inv.drop');
    yes.onclick = onYes;
    const no = document.createElement('button');
    no.type = 'button';
    no.textContent = this.text.t('inv.cancel');
    no.onclick = onNo;
    this.confirmEl.append(q, yes, no);
  }

  private hideConfirm(): void {
    this.confirmEl.classList.add('hidden');
    this.confirmEl.innerHTML = '';
  }

  private renderHand(e?: MouseEvent): void {
    const it = this.hand;
    this.handEl.classList.toggle('hidden', !it);
    this.dropBtn.classList.toggle('hidden', !it);
    this.handEl.innerHTML = '';
    if (!it || !this.hero) return;
    const [w, h] = this.hero.inv.size(it);
    this.handEl.appendChild(this.itemEl(it, w, h));
    if (e) this.moveHand(e);
  }
  private moveHand(e: MouseEvent): void {
    if (!this.hand) return;
    const r = this.handEl.getBoundingClientRect();
    this.handEl.style.left = e.clientX - r.width / 2 + 'px';
    this.handEl.style.top = e.clientY - r.height / 2 + 'px';
  }

  dispose(): void {
    for (const f of this.off) f();
    this.win.remove();
    this.handEl.remove();
  }
}
