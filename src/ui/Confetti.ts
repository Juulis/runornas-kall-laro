const COLORS = ['#ffe14a', '#7dff9a', '#7ec8ff', '#ff8ad4', '#fff4c2', '#ffb15a'] as const;

const CSS = `
.rk-confetti{position:fixed;width:0;height:0;z-index:36;pointer-events:none}
.rk-confetti span{position:absolute;left:0;top:0;width:14px;height:14px;border-radius:4px;animation:rk-confetti-pop 1s ease-out forwards}
.rk-confetti span.rk-star{width:auto;height:auto;background:transparent;font-size:26px;line-height:1}
@keyframes rk-confetti-pop{0%{transform:translate(0,0) scale(1);opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(.35) rotate(200deg);opacity:0}}
@media (prefers-reduced-motion: reduce){.rk-confetti span{animation:none;opacity:1}}
`;

let styleEl: HTMLStyleElement | null = null;

function ensureStyle(): void {
  if (typeof document === 'undefined') return;
  if (styleEl?.isConnected) return;
  const style = document.createElement('style');
  style.dataset.rkConfetti = '1';
  style.textContent = CSS;
  document.head.append(style);
  styleEl = style;
}

/** Kort konfettibukett kring en skärmpunkt. Gör inget utan DOM. */
export function burstConfetti(parent: HTMLElement | null, x: number, y: number): void {
  if (typeof document === 'undefined' || !parent) return;
  ensureStyle();
  const layer = document.createElement('div');
  layer.className = 'rk-confetti';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.left = `${x}px`;
  layer.style.top = `${y}px`;
  for (let i = 0; i < 24; i++) {
    const bit = document.createElement('span');
    const angle = (i / 24) * Math.PI * 2;
    const dist = 64 + (i % 5) * 26;
    bit.style.setProperty('--dx', `${Math.round(Math.cos(angle) * dist)}px`);
    bit.style.setProperty('--dy', `${Math.round(Math.sin(angle) * dist - 36)}px`);
    const color = COLORS[i % COLORS.length] ?? '#ffe14a';
    if (i % 3 === 0) {
      bit.classList.add('rk-star');
      bit.textContent = i % 2 === 0 ? '★' : '✦';
      bit.style.color = color;
    } else {
      bit.style.background = color;
    }
    bit.style.animationDelay = `${(i % 4) * 0.02}s`;
    layer.append(bit);
  }
  parent.append(layer);
  globalThis.setTimeout(() => layer.remove(), 1200);
}
