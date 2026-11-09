import { el } from '../menu/dom';
import { DAILY_GOAL, cosmeticById, type RewardState } from '../learn/rewards';
import { bindCosmeticImg, flameIconUrl, starIconUrl } from './rewardArt';

const CSS = `
.rk-reward-hud{position:fixed;left:112px;top:10px;z-index:16;display:flex;flex-wrap:wrap;gap:6px;align-items:center;max-width:calc(100vw - 126px);pointer-events:none}
#rk-learn.quiz-open .rk-reward-hud{display:none}
.rk-reward-hud .rk-stars,.rk-reward-hud .rk-today,.rk-reward-hud .rk-wear{display:inline-flex;align-items:center;gap:4px;background:#1a1612;color:#efe7d2;border:2px solid #c7a35a;border-radius:12px;padding:2px 8px;font:700 16px Cinzel,serif}
.rk-reward-hud .rk-today{font-weight:500;color:#cbb994;font-size:14px}
.rk-reward-hud .rk-wear{font:700 14px Nunito,Cinzel,sans-serif}
.rk-reward-hud img{width:36px;height:36px;display:block}
.rk-reward-hud .rk-flame{position:relative;width:36px;height:36px;display:grid}
.rk-reward-hud .rk-flame img{grid-area:1/1}
.rk-reward-hud .rk-flame b{grid-area:1/1;place-self:center;font:700 13px Nunito,Cinzel,sans-serif;color:#2a241c;text-shadow:0 1px 0 #fff3c4}
@media (max-width:640px){
  .rk-reward-hud{left:14px;top:58px;max-width:calc(100vw - 28px)}
}
`;

/** Stjärnor, streakflamma och dagens mål, nära nivåknappen. */
export class RewardHud {
  readonly root: HTMLDivElement;
  private readonly style: HTMLStyleElement;

  constructor(parent: HTMLElement) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);
    this.root = el('div', { class: 'rk-reward-hud', role: 'status', 'aria-live': 'polite' });
    parent.append(this.root);
  }

  render(state: RewardState): void {
    const stars = el(
      'span',
      { class: 'rk-stars' },
      el('img', { src: starIconUrl(state.stjarnor > 0), alt: '', width: '36', height: '36' }),
      el('b', { text: String(state.stjarnor) }),
    );
    const parts: Node[] = [stars];
    const flame = flameIconUrl(state.streak);
    if (flame) {
      parts.push(
        el(
          'span',
          { class: 'rk-flame', title: `Streak ${state.streak}` },
          el('img', { src: flame, alt: '', width: '36', height: '36' }),
          el('b', { text: String(state.streak) }),
        ),
      );
    }
    const todayText = `Idag ${state.dagligt.ratt}/${DAILY_GOAL}`;
    parts.push(
      el('span', {
        class: 'rk-today',
        text: todayText,
        title: state.dagligt.mal_klart ? 'Dagens mål är klart' : 'Dagens mål',
      }),
    );
    for (const id of [state.aktiv_hatt, state.aktiv_mantel]) {
      if (!id) continue;
      const item = cosmeticById(id);
      if (!item) continue;
      const icon = el('img', { width: '28', height: '28', alt: '' });
      bindCosmeticImg(icon, id, item.emoji, item.namn);
      parts.push(el('span', { class: 'rk-wear' }, icon, el('span', { text: item.namn })));
    }
    this.root.replaceChildren(...parts);
    const wear = [state.aktiv_hatt, state.aktiv_mantel].filter(Boolean).length;
    this.root.setAttribute(
      'aria-label',
      `Stjärnor ${state.stjarnor}. Streak ${state.streak}. ${todayText}.${wear ? ' Kläder valda.' : ''}`,
    );
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
  }
}
