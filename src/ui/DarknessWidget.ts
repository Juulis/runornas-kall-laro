import en from '../i18n/locales/en.json';
import sv from '../i18n/locales/sv.json';
import type { DarknessSettings } from '../render/DarknessSettings';

/** Knapp för mörker, intill skuggorna. Klick når inte spelplanen. */
export class DarknessWidget {
  readonly root: HTMLSpanElement;
  private readonly btn: HTMLButtonElement;
  private readonly unsub: () => void;
  private locale: 'sv' | 'en';

  constructor(private readonly settings: DarknessSettings) {
    this.locale = document.documentElement.lang === 'en' ? 'en' : 'sv';
    this.root = document.createElement('span');
    this.root.className = 'darkness-ctl';
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
    const mild = this.settings.current === 'light';
    this.root.classList.toggle('mild', mild);
    const label = mild ? dict.darkness_light : dict.darkness_normal;
    this.btn.textContent = mild ? dict.darkness_light : dict.darkness;
    this.btn.title = label;
    this.btn.setAttribute('aria-label', label);
    this.btn.setAttribute('aria-pressed', mild ? 'true' : 'false');
  }

  dispose(): void {
    this.unsub();
    this.root.remove();
  }
}
