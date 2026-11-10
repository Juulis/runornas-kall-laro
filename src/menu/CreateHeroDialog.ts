import type { LocaleManager } from '../i18n/LocaleManager';
import { LocalStore } from '../core/storage';
import type { HeroRoster } from '../save/HeroRoster';
import { readLastHeroClass, writeLastHeroClass, type HeroClassId } from '../save/heroRegistry';
import type { SaveFile } from '../save/types';
import { button, el } from './dom';
import { renderHeroClassGrid } from './heroClassGrid';
import type { MenuAssets } from './MenuAssets';

const NAME_MIN = 2;
const NAME_MAX = 16;

/** Ny hjälte: välj figur med förhandsbild, namn med validering i realtid, Enter skapar. */
export class CreateHeroDialog {
  private cls: HeroClassId = readLastHeroClass(new LocalStore());
  private nameDraft = '';

  constructor(
    private readonly roster: HeroRoster,
    private readonly assets: MenuAssets,
    private readonly i18n: LocaleManager,
  ) {}

  private rosterMsg(s: string): string {
    if (!s) return '';
    if (s.startsWith('Namnet måste vara')) return this.i18n.t('errors.name_length', { min: NAME_MIN, max: NAME_MAX });
    if (s.startsWith('Bara bokstäver')) return this.i18n.t('errors.name_chars');
    if (s.startsWith('Det finns redan')) return this.i18n.t('errors.name_taken');
    if (s.startsWith('Alla hjälteplatser')) return this.i18n.t('errors.slots_full');
    return s;
  }

  resetDraft(): void {
    this.cls = readLastHeroClass(new LocalStore());
    this.nameDraft = '';
  }

  render(onCreated: (d: SaveFile) => void, onBack: () => void): { root: HTMLElement; focus: () => void } {
    const grid = renderHeroClassGrid({
      selected: this.cls,
      i18n: this.i18n,
      assets: this.assets,
      onPick: (id) => {
        this.cls = id;
        writeLastHeroClass(new LocalStore(), id);
      },
    });
    const input = el('input', {
      class: 'hero-name',
      maxlength: String(NAME_MAX),
      placeholder: this.i18n.t('menu.name_placeholder', { min: NAME_MIN, max: NAME_MAX }),
      autocomplete: 'off',
    }) as HTMLInputElement;
    input.value = this.nameDraft;
    const err = el('div', { class: 'hero-err' });
    input.addEventListener('input', () => {
      this.nameDraft = input.value;
      err.textContent = input.value.trim().length >= NAME_MIN ? this.rosterMsg(this.roster.validName(input.value)) : '';
    });
    const ok = (): void => {
      const e = this.roster.validName(input.value);
      if (e) {
        err.textContent = this.rosterMsg(e);
        return;
      }
      writeLastHeroClass(new LocalStore(), this.cls);
      this.roster.create(input.value, this.cls).then(
        (d) => {
          this.resetDraft();
          onCreated(d);
        },
        (x: unknown) => {
          err.textContent = x instanceof Error ? this.rosterMsg(x.message) : String(x);
        },
      );
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ok();
    });
    const root = el(
      'div',
      { class: 'hero-new' },
      grid,
      input,
      err,
      el(
        'div',
        { class: 'btns' },
        button(this.i18n.t('menu.create_play'), ok, false, 'hnOk'),
        button(this.i18n.t('common.back'), onBack, false, 'hnBack'),
      ),
    );
    return { root, focus: () => input.focus() };
  }
}
