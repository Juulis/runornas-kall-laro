import type { GameContext, GameModule } from '../core/GameContext';
import type { SaveModule } from '../save/SaveModule';
import type { LocaleManager } from '../i18n/LocaleManager';
import { applyLoadingLocale, dismissLoadingWhenMenuReady } from '../ui/loadingScreen';
import { ConfirmDialog } from './ConfirmDialog';
import { CreateHeroDialog } from './CreateHeroDialog';
import { HeroSelectMenu } from './HeroSelectMenu';
import { LocalePicker } from './LocalePicker';
import { MenuAssets } from './MenuAssets';

/** Startmenyn. Kräver att SaveModule är initierad före (main.ts registrerar save före menu). */
export class MenuModule implements GameModule {
  private menu: HeroSelectMenu | null = null;
  private style: HTMLStyleElement | null = null;

  constructor(
    private readonly save: SaveModule,
    private readonly i18n: LocaleManager,
    private readonly host: () => HTMLElement = () => document.body,
    private readonly showOnInit = true,
    /** Laddar spriteark för vald figur innan världen byggs. Tester kan lämna den tom. */
    private readonly loadHeroClass: (cls: string) => Promise<void> = async () => {},
  ) {}

  init(ctx: GameContext): void {
    const assets = new MenuAssets(this.i18n);
    this.style = document.createElement('style');
    this.style.textContent = assets.css();
    document.head.appendChild(this.style);
    this.menu = new HeroSelectMenu({
      bus: ctx.bus,
      roster: this.save.roster,
      loader: this.save.loader,
      onLeaveGame: () => {
        if (this.save.autosave.isPlaying) this.save.autosave.end(true);
      },
      assets,
      create: new CreateHeroDialog(this.save.roster, assets, this.i18n),
      confirm: new ConfirmDialog(this.i18n),
      i18n: this.i18n,
      picker: new LocalePicker(this.i18n),
      loadHeroClass: (cls) => this.loadHeroClass(cls),
    });
    this.host().appendChild(this.menu.root);
    const menu = this.menu;
    if (this.showOnInit)
      void this.save.ready.then(() => {
        applyLoadingLocale(document, (key) => this.i18n.t(key));
        if (this.save.autosave.isPlaying) {
          dismissLoadingWhenMenuReady(false);
          return;
        }
        menu.show();
        dismissLoadingWhenMenuReady(menu.isOpen);
      });
  }

  /** Visa hjältevalet (t.ex. från motorns "Spela igen"/Esc-meny). */
  show(): void {
    const menu = this.menu;
    if (this.save.isReady) menu?.show();
    else void this.save.ready.then(() => menu?.show());
  }

  get isOpen(): boolean {
    return this.menu?.isOpen ?? false;
  }

  dispose(): void {
    this.menu?.dispose();
    this.style?.remove();
    this.menu = null;
  }
}
