import type { KeyValueStore } from '../core/storage';
import { el } from '../menu/dom';
import {
  COSMETICS,
  STICKERS,
  buyCosmetic,
  cosmeticById,
  equipCosmetic,
  loadRewards,
  saveRewards,
  stickerName,
  type BuyReason,
  type RewardState,
} from '../learn/rewards';
import { bindCosmeticImg, bindStickerImg } from './rewardArt';

const CSS = `
.rk-album{position:fixed;inset:0;z-index:60;background:rgba(12,8,6,.72);display:flex;justify-content:center;overflow:auto;padding:24px 16px}
.rk-album.is-hidden{display:none}
.rk-album-card{width:min(880px,100%);background:#1c1612;color:#efe7d2;border:4px solid #c7a35a;border-radius:18px;padding:20px 18px 28px;box-shadow:0 12px 40px #000;font:500 16px/1.35 Nunito,Cinzel,sans-serif}
.rk-album-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.rk-album h2{margin:0;font:700 28px Cinzel,serif;color:#fff8e8}
.rk-album h3{margin:22px 0 8px;font:700 20px Cinzel,serif;color:#f2c46b}
.rk-album-stars{color:#f2c46b;font:700 18px Cinzel,serif}
.rk-album button{min-height:44px;border-radius:12px;border:2px solid #c7a35a;background:#2a231c;color:#fff8e8;padding:8px 12px;cursor:pointer;font:700 16px Cinzel,serif}
.rk-album button:focus-visible{outline:3px solid #c7a35a;outline-offset:2px}
.rk-album button:disabled{opacity:.45;cursor:default}
.rk-album-note{color:#cbb994;margin:8px 0 0}
.rk-album-msg{min-height:1.2em;color:#ffd58a;margin:8px 0}
.rk-stickers{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}
.rk-sticker{background:#2a231c;border:2px solid #6b5a3e;border-radius:16px;padding:10px 8px;text-align:center}
.rk-sticker.locked{border-style:dashed}
.rk-sticker img,.rk-sticker-emoji{width:96px;height:96px;object-fit:contain;display:inline-flex;align-items:center;justify-content:center;font-size:48px}
.rk-sticker b{display:block;margin-top:4px;font:700 15px Cinzel,serif}
.rk-sticker small{display:block;color:#cbb994;min-height:2.4em}
.rk-gear{display:flex;flex-direction:column;gap:8px}
.rk-gear-row{display:flex;align-items:center;gap:10px;border:2px solid #6b5a3e;border-radius:14px;padding:8px 10px}
.rk-gear-row .emoji,.rk-gear-icon{font-size:28px;width:48px;height:48px;object-fit:contain;text-align:center;flex:0 0 auto}
.rk-gear-row .txt{flex:1}
.rk-gear-row .txt small{display:block;color:#cbb994}
@media (max-width:640px){
  .rk-album{padding:12px}
  .rk-album h2{font-size:22px}
}
`;

const BUY_TEXT: Record<BuyReason, string> = {
  okand: 'Det där finns inte.',
  redan: 'Du har den redan.',
  stjarnor: 'Du behöver fler stjärnor.',
  marke: 'Du behöver märket först.',
};

export interface AlbumHooks {
  onDirty?: () => void;
  onClose?: () => void;
}

/** Samling av märken och kläder. Kläder syns bara som ikon, inte på hjälten. */
export class StickerAlbum {
  private readonly style: HTMLStyleElement;
  private readonly root: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private opened = false;
  private message = '';

  constructor(
    private readonly store: KeyValueStore,
    private readonly hooks: AlbumHooks = {},
  ) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);
    this.root = el('div', { class: 'rk-album is-hidden', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Samling' });
    this.card = el('div', { class: 'rk-album-card' });
    this.root.append(this.card);
    this.root.addEventListener('click', (ev) => {
      if (ev.target === this.root) this.close();
    });
    document.body.append(this.root);
  }

  isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    this.opened = true;
    this.message = '';
    this.root.classList.remove('is-hidden');
    this.render();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.classList.add('is-hidden');
    this.hooks.onClose?.();
  }

  dispose(): void {
    this.opened = false;
    this.root.remove();
    this.style.remove();
  }

  private render(): void {
    const state = loadRewards(this.store);
    const head = el('div', { class: 'rk-album-head' }, el('h2', { text: 'Samling' }), el('button', { type: 'button', text: 'Stäng' }));
    const closeBtn = head.querySelector('button');
    closeBtn?.addEventListener('click', () => this.close());
    const stars = el('p', { class: 'rk-album-stars', text: `Stjärnor: ${state.stjarnor}` });
    const grid = el('div', { class: 'rk-stickers' });
    for (const sticker of STICKERS) {
      const unlocked = state.klistermarken.includes(sticker.id);
      const cell = el('div', { class: unlocked ? 'rk-sticker' : 'rk-sticker locked' });
      const img = el('img', {
        alt: unlocked ? sticker.namn : `${sticker.namn}, låst`,
        width: '96',
        height: '96',
      });
      bindStickerImg(img, sticker.id, unlocked);
      cell.append(img, el('b', { text: sticker.namn }), el('small', { text: unlocked ? 'Upplåst' : sticker.hint }));
      grid.append(cell);
    }
    const gearTitle = el('h3', { text: 'Kläder' });
    const note = el('p', { class: 'rk-album-note', text: 'Kläderna syns som ikon. De ändrar inte striden.' });
    const msg = el('p', { class: 'rk-album-msg', text: this.message });
    const gear = el('div', { class: 'rk-gear' });
    for (const item of COSMETICS) gear.append(this.gearRow(state, item.id));
    this.card.replaceChildren(head, stars, grid, gearTitle, note, msg, gear);
    if (!this.message && closeBtn instanceof HTMLButtonElement) closeBtn.focus();
  }

  private gearRow(state: RewardState, id: (typeof COSMETICS)[number]['id']): HTMLDivElement {
    const item = cosmeticById(id);
    if (!item) return el('div');
    const owned = state.upplast.includes(id);
    const equipped = state.aktiv_hatt === id || state.aktiv_mantel === id;
    const detail = equipped
      ? 'På'
      : owned
        ? 'I garderoben'
        : item.marke
          ? `Kräver märket ${stickerName(item.marke)}`
          : `Kostar ${item.kostnad ?? 0} stjärnor`;
    const btn = el('button', { type: 'button' });
    if (!owned) {
      btn.textContent = item.marke ? 'Lås upp' : `Köp ${item.kostnad ?? 0}`;
      const need = item.marke ? !state.klistermarken.includes(item.marke) : state.stjarnor < (item.kostnad ?? 0);
      btn.disabled = need;
      btn.addEventListener('click', () => {
        const bought = buyCosmetic(state, id);
        if (!bought.ok) {
          this.message = BUY_TEXT[bought.reason];
          this.render();
          return;
        }
        saveRewards(this.store, bought.state);
        this.message = `${item.namn} är din.`;
        this.hooks.onDirty?.();
        this.render();
      });
    } else {
      btn.textContent = equipped ? 'Ta av' : 'Ta på';
      btn.addEventListener('click', () => {
        const next = equipCosmetic(state, id);
        saveRewards(this.store, next);
        this.message = next.aktiv_hatt === id || next.aktiv_mantel === id ? `${item.namn} är på.` : `${item.namn} är av.`;
        this.hooks.onDirty?.();
        this.render();
      });
    }
    const icon = el('img', { class: 'rk-gear-icon', width: '48', height: '48', alt: item.namn });
    bindCosmeticImg(icon, id, item.emoji, item.namn);
    return el(
      'div',
      { class: 'rk-gear-row' },
      icon,
      el('span', { class: 'txt' }, el('b', { text: item.namn }), el('small', { text: detail })),
      btn,
    );
  }
}
