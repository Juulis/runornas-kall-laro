import { themedMonsterTitle } from '../entities/enemyThemes';
import type { Monster } from '../entities/Monster';
import { MODIFIER_NAME } from '../systems/SpawnSystem';
import type { Text } from '../text/Text';

/** Monstermätare överst (D2): namn i elitfärg, modifierare och exakt HP för monstret under pekaren / senast träffat. */
export class MonsterBar {
  private readonly el = document.createElement('div');

  constructor(private readonly text: Text) {
    this.el.id = 'monbar';
    this.el.className = 'hidden';
    this.el.innerHTML = '<div class="mbFill"></div><div class="mbName"></div><div class="mbMods"></div>';
    document.body.appendChild(this.el);
  }

  name(m: Monster): string {
    return themedMonsterTitle(m.appearanceId, this.text.data('monsterfamiljer', m.id, 'name', m.def.name), m.uname);
  }

  show(m: Monster | null): void {
    if (!m || m.dead || m.boss) {
      this.el.classList.add('hidden');
      return;
    }
    const t = this.text;
    this.el.classList.remove('hidden');
    this.el.dataset.elite = m.elite ?? '';
    (this.el.querySelector('.mbFill') as HTMLElement).style.width = Math.max(0, m.hp / m.max) * 100 + '%';
    const kind =
      m.elite === 'unik'
        ? t.t('monster.unique')
        : m.elite === 'champion'
          ? t.t('monster.champion')
          : m.elite === 'minion'
            ? t.t('monster.minion')
            : '';
    const nameEl = this.el.querySelector('.mbName') as HTMLElement;
    const label = `${this.name(m)} · ${t.t('tooltip.level', { level: m.lvl })}${kind ? ' · ' + kind : ''} — ${Math.max(0, Math.ceil(m.hp))} / ${m.max}`;
    if (nameEl.textContent !== label) nameEl.textContent = label;
    const mods = m.mods.map((x) => t.data('monster_niva', x, 'name', MODIFIER_NAME[x] ?? x)).join(', ');
    const modEl = this.el.querySelector('.mbMods') as HTMLElement;
    if (modEl.textContent !== mods) modEl.textContent = mods;
  }

  dispose(): void {
    this.el.remove();
  }
}
