import { LocalStore } from '../core/storage';
import { ENEMY_THEMES, readEnemyTheme, writeEnemyTheme, type EnemyThemeId } from '../entities/enemyThemes';
import type { LocaleManager } from '../i18n/LocaleManager';
import type { Key } from '../i18n/types';
import { el } from './dom';

const THEME_MENU: Record<EnemyThemeId, { name: Key; sub?: Key; mark: string }> = {
  vanliga: { name: 'menu.enemy_theme_vanliga', mark: '🍃' },
  digital_cirkus: { name: 'menu.enemy_theme_digital_cirkus', mark: '🎪' },
  karatedojo: { name: 'menu.enemy_theme_karatedojo', sub: 'menu.enemy_theme_skorpionklubben', mark: '🥋' },
};

/** Väljare för fiendetema. Valet sparas direkt, samma mönster som lärinställningen. */
export function buildEnemyThemePicker(i18n: LocaleManager): HTMLDivElement {
  const current = readEnemyTheme(new LocalStore());
  const t = i18n.t.bind(i18n);
  const choices = el('div', { class: 'enemy-theme-choices' });
  for (const theme of ENEMY_THEMES) {
    const meta = THEME_MENU[theme.id];
    const sel = theme.id === current;
    const btn = el(
      'button',
      {
        type: 'button',
        class: sel ? 'enemy-theme-btn sel' : 'enemy-theme-btn',
        'aria-pressed': sel ? 'true' : 'false',
        'data-theme': theme.id,
      },
      el('span', { class: 'enemy-theme-mark', 'aria-hidden': 'true', text: meta.mark }),
      el('span', { class: 'enemy-theme-name', text: t(meta.name) }),
    );
    if (meta.sub) btn.append(el('span', { class: 'enemy-theme-sub', text: t(meta.sub) }));
    btn.addEventListener('click', () => {
      writeEnemyTheme(new LocalStore(), theme.id);
      const root = btn.parentElement;
      if (!root) return;
      for (const child of root.children) {
        if (!(child instanceof HTMLButtonElement)) continue;
        const on = child === btn;
        child.classList.toggle('sel', on);
        child.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    });
    choices.append(btn);
  }
  return el(
    'div',
    { class: 'enemy-theme-picker', role: 'group', 'aria-label': t('menu.choose_enemy_theme') },
    el('div', { class: 'enemy-theme-label', text: t('menu.choose_enemy_theme') }),
    choices,
  );
}
