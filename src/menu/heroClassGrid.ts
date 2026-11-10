import type { LocaleManager } from '../i18n/LocaleManager';
import type { Key } from '../i18n/types';
import { HERO_APPEARANCES, type HeroClassId } from '../save/heroRegistry';
import { el } from './dom';
import type { MenuAssets } from './MenuAssets';

/** Wrappande rutnät med porträtt. Samma vy vid ny hjälte och när man byter figur. */
export function renderHeroClassGrid(opts: {
  selected: string;
  i18n: LocaleManager;
  assets: MenuAssets;
  onPick: (id: HeroClassId) => void;
}): HTMLDivElement {
  const row = el('div', { class: 'hero-class-grid' });
  const btns: HTMLDivElement[] = [];
  for (const c of HERO_APPEARANCES) {
    const b = el(
      'div',
      { class: `clsbtn${c.id === opts.selected ? ' sel' : ''}`, 'data-c': c.id },
      opts.assets.portrait(c.id),
      el('span', { text: opts.i18n.t(`classes.${c.id}` as Key) }),
    );
    b.addEventListener('click', () => {
      opts.onPick(c.id);
      for (const x of btns) x.classList.toggle('sel', x === b);
    });
    btns.push(b);
  }
  row.append(...btns);
  return row;
}
