import { assetUrl } from '../core/assets';
import type { LocaleManager } from '../i18n/LocaleManager';
import { classById } from '../save/types';
import { el } from './dom';

/** Menygrafik som filer i public/assets/ui (tidigare base64 i js/menu-data.js). */
export class MenuAssets {
  constructor(private readonly i18n: LocaleManager) {}

  static readonly FILES = [
    'bg',
    'titel',
    'plats',
    'tom',
    'knapp',
    'textfalt',
    'save',
    'amazonkrigare',
    'barbar',
    'riddare',
    'kattflickan',
    'gnistan',
    'valpen',
    'grisan',
  ] as const;

  url(name: (typeof MenuAssets.FILES)[number] | string): string {
    return assetUrl(`ui/${name}.webp`);
  }

  portrait(cls: string): HTMLDivElement {
    const p = el('div', { class: 'portrait' }, classById(cls)?.icon ?? '❔');
    if (classById(cls)) {
      const img = el('img', { src: this.url(cls), alt: '' });
      img.addEventListener('error', () => img.remove()); // reserv: ikon
      p.append(img);
    }
    return p;
  }

  title(): HTMLImageElement {
    return el('img', { class: 'titel', src: this.url('titel'), alt: this.i18n.t('common.title') });
  }

  css(): string {
    const u = (n: string): string => `url(${this.url(n)})`;
    return `.save-icon{position:fixed;right:14px;top:12px;z-index:30;width:24px;height:24px;background:center/contain no-repeat;opacity:0;transition:opacity .3s;pointer-events:none;filter:drop-shadow(0 0 4px #000)}.save-icon.on{opacity:.95}.save-icon.save-error{filter:drop-shadow(0 0 6px #c00) hue-rotate(320deg) saturate(1.8);opacity:.95}
.hero-menu{position:fixed;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;background:#000 ${u('bg')} center/cover;gap:8px;overflow:auto}
.hero-menu.hidden{display:none}
.hero-menu .titel{width:min(34vw,420px);margin-top:1vh;filter:drop-shadow(0 0 18px rgba(192,24,42,.35))}
.hero-menu .rubrik{font:26px Cinzel,serif;color:#e6dfcc;letter-spacing:2px;margin:2px 0}
.hero-slots{display:grid;grid-template-columns:repeat(2,min(44vw,420px));gap:6px 14px}
.hslot{position:relative;height:76px;background:${u('plats')} 0 0/100% 100% no-repeat;cursor:pointer;text-align:left;color:#cbb994}
.hslot .portrait{position:absolute;left:7.8%;top:23.6%;width:9.96%;height:52.1%;border:0;background:#120f0b;font-size:20px}
.hslot .info{position:absolute;left:24%;top:50%;transform:translateY(-50%)}
.hslot b{display:block;color:#efe7d2;font:20px Cinzel,serif}.hslot small{font-size:13px;color:#a89a80}
.hslot.sel{filter:drop-shadow(0 0 10px rgba(199,163,90,.8))}.hslot.sel b{color:#e0b060}
.hslot.empty{background-image:${u('tom')};cursor:default}
.portrait{width:48px;height:48px;flex:none;position:relative;display:flex;align-items:center;justify-content:center;font-size:26px;overflow:hidden;background:radial-gradient(#3a3226,#120f0b)}
.portrait img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero-menu .btns{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;align-items:center;margin-top:8px;color:#e6dfcc}
.hero-menu button{border-style:solid;border-width:16px 44px;border-image:${u('knapp')} 20 60 fill / 16px 44px stretch;background:none;color:#e6dfcc;font:18px Cinzel,serif;padding:0 6px;min-width:170px;cursor:pointer;text-shadow:0 1px 2px #000}
.hero-menu button:hover:not(:disabled){color:#fff;filter:brightness(1.25) drop-shadow(0 0 6px rgba(199,163,90,.5))}.hero-menu button:disabled{opacity:.4;cursor:default}
.hero-new{display:flex;flex-direction:column;gap:10px;align-items:center;width:min(1040px,96vw)}
.hero-menu .underrubrik{font:20px Cinzel,serif;color:#e6dfcc;letter-spacing:1px;margin:10px 0 2px;text-align:center}
.hero-menu .figure-pick{display:flex;flex-direction:column;align-items:center;width:min(1040px,96vw)}
.hero-menu .hero-class-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:12px 14px;width:min(980px,96vw);margin:0 auto}
.hero-menu .hero-class-grid .clsbtn{display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;opacity:.65;color:#cbb994;font:16px Cinzel,serif;min-width:0}
.hero-menu .hero-class-grid .clsbtn span{text-align:center;line-height:1.15;max-width:100%}
.hero-menu .hero-class-grid .clsbtn .portrait{width:100%;height:auto;aspect-ratio:1;min-width:80px;min-height:80px;max-width:128px;border:3px solid #3a3f45}
.hero-menu .hero-class-grid .clsbtn.sel{opacity:1;color:#e0b060}
.hero-menu .hero-class-grid .clsbtn.sel .portrait{border-color:#c7a35a;box-shadow:0 0 24px 4px rgba(199,163,90,.5)}
.hero-name{width:400px;height:56px;box-sizing:border-box;border-style:solid;border-width:16px 44px;border-image:${u('textfalt')} 20 55 fill / 16px 44px stretch;background:none;color:#e6dfcc;font:18px Cinzel,serif;text-align:center;outline:none}
.lang-picker{display:flex;gap:6px;margin-top:6px}.hero-menu .lang-picker button.lang{min-width:0;border-width:10px 20px;font-size:14px;opacity:.6}.hero-menu .lang-picker button.lang.sel{opacity:1;color:#e0b060}.slots-free{color:#a89a80;font-size:13px}
.hero-err{color:#e06060;min-height:18px;font-size:14px;text-shadow:0 1px 2px #000}
.sfx-ctl{display:inline-flex;align-items:center;gap:4px}.sfx-ctl button{font-size:12px;padding:2px 6px;border-color:#6b5a3e;background:#2a2420}.sfx-ctl input{width:70px;accent-color:#f2c46b}.shadow-ctl{display:inline-flex;align-items:center}.shadow-ctl button{font-size:12px;padding:2px 8px;border-color:#6b5a3e;background:#2a2420;color:#e6dfcc;cursor:pointer}.shadow-ctl.off button{opacity:.55}
.hero-menu .learn-setup{display:flex;gap:16px;flex-wrap:wrap;justify-content:center;align-items:flex-end;margin-top:8px}
.hero-menu .learn-setup label{display:flex;flex-direction:column;gap:4px;color:#e6dfcc;font:16px Cinzel,serif}
.hero-menu .learn-setup label.learn-read{flex-direction:row;align-items:center;gap:8px;font-size:18px}
.hero-menu .learn-setup label.learn-read input{width:22px;height:22px;accent-color:#e0b060}
.hero-menu .learn-setup select{font:20px Cinzel,serif;padding:8px 12px;background:#1a1612;color:#efe7d2;border:2px solid #c7a35a;border-radius:8px;min-width:180px}
.hero-menu .enemy-theme-picker{display:flex;flex-direction:column;align-items:center;gap:6px;width:min(92vw,880px);margin-top:2px}
.hero-menu .enemy-theme-label{color:#e6dfcc;font:18px Cinzel,serif;letter-spacing:.5px}
.hero-menu .enemy-theme-choices{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;width:100%}
.hero-menu .enemy-theme-picker button.enemy-theme-btn{flex:1 1 160px;max-width:240px;min-width:140px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:8px 12px;border-style:solid;border-width:3px;border-image:none;border-color:#3a3f45;border-radius:10px;background:#1a1612;color:#cbb994;opacity:.7;font:16px Cinzel,serif;cursor:pointer;text-shadow:0 1px 2px #000;box-shadow:none}
.hero-menu .enemy-theme-picker button.enemy-theme-btn.sel{opacity:1;color:#e0b060;border-color:#c7a35a;box-shadow:0 0 24px 4px rgba(199,163,90,.5)}
.hero-menu .enemy-theme-picker button.enemy-theme-btn:hover:not(:disabled){color:#efe7d2;filter:brightness(1.12) drop-shadow(0 0 6px rgba(199,163,90,.35))}
.hero-menu .enemy-theme-picker button.enemy-theme-btn.sel:hover:not(:disabled){color:#e0b060}
.hero-menu .enemy-theme-mark{font-size:22px;line-height:1.1}
.hero-menu .enemy-theme-name{font:16px Cinzel,serif}
.hero-menu .enemy-theme-sub{font:13px Cinzel,serif;color:#a89a80}
.hero-menu .enemy-theme-picker button.enemy-theme-btn.sel .enemy-theme-sub{color:#e0b060}`;
  }
}
