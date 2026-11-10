import type { EventBus } from '../core/EventBus';
import type { GameEvents, UiPanel } from '../core/events';
import type { HeroLoader } from '../save/HeroLoader';
import type { HeroRoster } from '../save/HeroRoster';
import type { LocaleManager } from '../i18n/LocaleManager';
import type { Key } from '../i18n/types';
import { MAX_HEROES, classById, type SaveFile } from '../save/types';
import { writeLastHeroClass, type HeroClassId } from '../save/heroRegistry';
import type { ConfirmDialog } from './ConfirmDialog';
import type { CreateHeroDialog } from './CreateHeroDialog';
import { button, el } from './dom';
import { renderHeroClassGrid } from './heroClassGrid';
import type { LocalePicker } from './LocalePicker';
import type { MenuAssets } from './MenuAssets';
import { buildLearnFields } from '../ui/learnDom';
import { preloadLearnForPlay } from '../learn/preloadLearn';
import { readLearnSettings, writeLearnSettings } from '../learn/settings';
import type { LearnSettings } from '../learn/types';
import { LocalStore } from '../core/storage';

/** Hjälteval: 8 platser, Fortsätt / Nytt game / Ny hjälte / Radera (med bekräftelse). Dubbelklick startar. */
export class HeroSelectMenu {
  static readonly PANEL: UiPanel = 'menu';
  readonly root: HTMLDivElement;
  private selected: string | null = null;
  private open = false;
  private view: 'list' | 'create' = 'list';
  /** Håller raderingsbekräftelsen vid språkbyte. */
  private deleteConfirmHeroId: string | null = null;
  private learnDraft: LearnSettings = readLearnSettings(new LocalStore());
  private starting = false;
  private startError = '';
  private readonly offLocale: () => void;

  constructor(
    private readonly deps: {
      bus: EventBus<GameEvents>;
      roster: HeroRoster;
      loader: HeroLoader;
      onLeaveGame: () => void;
      assets: MenuAssets;
      create: CreateHeroDialog;
      confirm: ConfirmDialog;
      i18n: LocaleManager;
      picker: LocalePicker;
      /** Spriteark för vald figur, innan världen skapas. */
      loadHeroClass: (cls: string) => Promise<void>;
    },
  ) {
    this.root = el('div', { class: 'hero-menu overlay hidden' });
    // tangenter i menyn ska inte nå spelet (Tab, M, …)
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
    this.root.addEventListener('keyup', (e) => e.stopPropagation());
    // språkbyte: rita om aktuell vy med nya texter
    this.offLocale = deps.i18n.onChange(() => {
      if (!this.open) return;
      if (this.view === 'create') this.renderCreate();
      else this.renderList();
    });
  }

  dispose(): void {
    this.offLocale();
    this.root.remove();
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.starting = false;
    this.deps.onLeaveGame();
    this.deleteConfirmHeroId = null;
    if (!this.open) {
      this.open = true;
      this.root.classList.remove('hidden');
      this.deps.bus.emit('ui_open', { panel: HeroSelectMenu.PANEL });
    }
    this.renderList();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    const ae = document.activeElement;
    if (ae instanceof HTMLElement && this.root.contains(ae)) ae.blur(); // namnfältet får inte behålla fokus (Tab/M)
    this.root.classList.add('hidden');
    this.deps.bus.emit('ui_close', { panel: HeroSelectMenu.PANEL });
  }

  private start(d: SaveFile, resume: boolean): void {
    if (this.starting) return;
    this.starting = true;
    this.startError = '';
    this.deleteConfirmHeroId = null;
    d.learn = { ...this.learnDraft };
    writeLearnSettings(new LocalStore(), this.learnDraft);
    writeLastHeroClass(new LocalStore(), d.hero.cls);
    const settings = this.learnDraft;
    const note = el('div', { class: 'slots-free', text: this.deps.i18n.t('menu.loading_figure') });
    this.root.append(note);
    void this.play(d, resume, settings, note);
  }

  /** Laddar vald figur innan spelet byggs, så världen och striden får rätt sprites. */
  private async play(d: SaveFile, resume: boolean, settings: LearnSettings, note: HTMLElement): Promise<void> {
    try {
      await preloadLearnForPlay(settings);
      if (!this.starting) return;
      await this.deps.loadHeroClass(d.hero.cls);
      if (!this.starting) return;
      note.remove();
      this.hide();
      await this.deps.loader.start(d, resume);
    } catch (e) {
      console.warn('[meny] kunde inte starta', e);
      note.remove();
      this.starting = false;
      this.startError = this.deps.i18n.t('menu.figure_load_failed');
      this.show();
    }
  }

  renderList(): void {
    this.view = 'list';
    const { roster, assets, i18n } = this.deps;
    const t = i18n.t.bind(i18n);
    const hs = roster.list();
    if (!hs.some((h) => h.id === this.selected)) this.selected = roster.defaultSelection();
    const d = this.selected ? roster.load(this.selected) : null;
    this.learnDraft = d?.learn ?? readLearnSettings(new LocalStore());
    const slots = el('div', { class: 'hero-slots' });
    for (let i = 0; i < MAX_HEROES; i++) {
      const h = hs[i];
      if (!h) {
        slots.append(el('div', { class: 'hslot empty' }));
        continue;
      }
      const slot = el(
        'div',
        { class: `hslot${h.id === this.selected ? ' sel' : ''}`, 'data-id': h.id },
        assets.portrait(h.cls),
        el(
          'div',
          { class: 'info' },
          el('b', { text: h.name || t('menu.unnamed') }),
          el('small', {
            text: t('menu.slot_info', {
              cls: classById(h.cls) ? t(`classes.${classById(h.cls)?.id ?? 'riddare'}` as Key) : h.cls,
              level: h.level,
            }),
          }),
        ),
      );
      slot.addEventListener('click', () => {
        this.selected = h.id;
        if (this.deleteConfirmHeroId !== h.id) this.deleteConfirmHeroId = null;
        this.renderList();
      });
      slot.addEventListener('dblclick', () => {
        const x = roster.load(h.id);
        if (x) this.start(x, !!x.game);
      });
      slots.append(slot);
    }
    const btns = el(
      'div',
      { class: 'btns' },
      button(t('menu.continue'), () => d?.game && this.start(d, true), !d?.game, 'hmCont'),
      button(t('menu.new_game'), () => d && this.start(d, false), !d, 'hmNewGame'),
      button(
        t('menu.create_hero'),
        () => {
          this.deleteConfirmHeroId = null;
          this.deps.create.resetDraft();
          this.renderCreate();
        },
        hs.length >= MAX_HEROES,
        'hmNewHero',
      ),
      button(
        t('menu.delete_hero'),
        () => {
          if (!d) return;
          this.deleteConfirmHeroId = d.hero.id;
          this.renderList();
        },
        !d,
        'hmDel',
      ),
    );
    const actionRow = this.deleteConfirmHeroId && d?.hero.id === this.deleteConfirmHeroId ? this.confirmDelete(d) : btns;
    const figures = d ? this.figurePicker(d) : null;
    const learn = buildLearnFields(this.learnDraft, (next) => {
      this.learnDraft = next;
      writeLearnSettings(new LocalStore(), next);
      void preloadLearnForPlay(next);
      if (!d) return;
      d.learn = { ...next };
      void roster.store(d);
    });
    this.root.replaceChildren(
      assets.title(),
      el('div', { class: 'rubrik', text: t('menu.choose_hero') }),
      el('small', { class: 'slots-free', text: t('menu.slots_free', { count: MAX_HEROES - hs.length }) }),
      slots,
      ...(figures ? [figures] : []),
      learn,
      el('small', { class: 'slots-free', text: 'Frågorna följer nivå och ämne.' }),
      ...(this.startError ? [el('div', { class: 'hero-err', text: this.startError })] : []),
      actionRow,
      this.deps.picker.render(),
    );
  }

  /** Byt utseende på vald hjälte utan att skapa en ny. */
  private figurePicker(d: SaveFile): HTMLElement {
    const t = this.deps.i18n.t.bind(this.deps.i18n);
    const grid = renderHeroClassGrid({
      selected: d.hero.cls,
      i18n: this.deps.i18n,
      assets: this.deps.assets,
      onPick: (id) => this.pickFigure(d, id),
    });
    return el('div', { class: 'figure-pick' }, el('div', { class: 'underrubrik', text: t('menu.choose_figure') }), grid);
  }

  private pickFigure(d: SaveFile, id: HeroClassId): void {
    if (this.starting || d.hero.cls === id) return;
    const prev = d.hero.cls;
    d.hero.cls = id;
    writeLastHeroClass(new LocalStore(), id);
    this.startError = '';
    void this.deps.roster.store(d).then(
      () => {
        if (this.open && this.view === 'list' && this.selected === d.hero.id) this.renderList();
      },
      (e: unknown) => {
        d.hero.cls = prev;
        console.warn('[meny] kunde inte byta figur', e);
        this.startError = this.deps.i18n.t('menu.figure_save_failed');
        if (this.open && this.view === 'list') this.renderList();
      },
    );
  }

  private confirmDelete(d: SaveFile): HTMLElement {
    return this.deps.confirm.render(
      this.deps.i18n.t('menu.delete_confirm', { name: d.hero.name || this.deps.i18n.t('menu.unnamed') }),
      this.deps.i18n.t('menu.delete_yes'),
      () => {
        void this.deps.roster.delete(d.hero.id).then(() => {
          this.deleteConfirmHeroId = null;
          this.selected = null;
          this.renderList();
        });
      },
      () => {
        this.deleteConfirmHeroId = null;
        this.renderList();
      },
    );
  }

  private renderCreate(): void {
    this.view = 'create';
    this.deleteConfirmHeroId = null;
    const { root, focus } = this.deps.create.render(
      (d) => {
        this.selected = d.hero.id;
        this.start(d, false);
      },
      () => {
        this.deps.create.resetDraft();
        this.renderList();
      },
    );
    this.root.replaceChildren(
      this.deps.assets.title(),
      el('div', { class: 'rubrik', text: this.deps.i18n.t('menu.new_hero') }),
      root,
      this.deps.picker.render(),
    );
    focus();
  }
}
