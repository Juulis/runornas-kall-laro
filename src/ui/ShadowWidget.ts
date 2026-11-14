import en from '../i18n/locales/en.json';
import sv from '../i18n/locales/sv.json';
import type { ShadowSettings } from '../render/ShadowSettings';

/** Kryssknapp för skuggor, intill volymen. Klick når inte spelplanen. */
export class ShadowWidget {
  readonly root: HTMLSpanElement;
  private readonly btn: HTMLButtonElement;
  private readonly unsub: () => void;
  private locale: 'sv' | 'en';

  constructor(private readonly settings: ShadowSettings) {
    this.locale = document.documentElement.lang === 'en' ? 'en' : 'sv';
    this.root = document.createElement('span');
    this.root.className = 'shadow-ctl';
    this.btn = document.createElement('button');
    this.btn.type = 'button';
    this.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.settings.toggle();
      this.btn.blur();
    });
    for (const t of ['pointerdown', 'mousedown', 'click']) this.root.addEventListener(t, (e) => e.stopPropagation());
    this.root.append(this.btn);
    this.unsub = settings.onChange(() => this.sync());
    this.sync();
  }

  setLocale(locale: string): void {
    this.locale = locale === 'en' ? 'en' : 'sv';
    this.sync();
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
  }

  sync(): void {
    const dict = this.locale === 'en' ? en.gfx : sv.gfx;
    const on = this.settings.enabled;
    this.root.classList.toggle('off', !on);
    this.btn.textContent = on ? dict.shadows : dict.shadows_off;
    this.btn.title = on ? dict.shadows_on : dict.shadows_off;
    this.btn.setAttribute('aria-label', on ? dict.shadows_on : dict.shadows_off);
    this.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  dispose(): void {
    this.unsub();
    this.root.remove();
  }
}
