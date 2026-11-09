const CSS = `
.rk-reward-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:80;width:min(440px,calc(100vw - 24px));pointer-events:none}
.rk-reward-toast p{margin:0;background:#f2c46b;color:#2a241c;border:3px solid #c7a35a;border-radius:16px;padding:14px 16px;text-align:center;font:800 22px/1.3 Nunito,Cinzel,sans-serif;box-shadow:0 8px 24px rgba(42,36,28,.28)}
.rk-reward-toast p.quiet{font-size:15px;font-weight:700;background:#fffdf8}
.rk-reward-toast p.is-hidden{display:none}
@media (prefers-reduced-motion:reduce){.rk-reward-toast p{transition:none}}
`;

interface ToastItem {
  text: string;
  quiet: boolean;
}

function unref(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref();
}

/** Kort firande. En rad i taget så de inte täcker frågan. */
export class RewardToast {
  private readonly style: HTMLStyleElement;
  private readonly host: HTMLDivElement;
  private readonly line: HTMLParagraphElement;
  private readonly queue: ToastItem[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private showing = false;

  constructor(parent: HTMLElement = document.body) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);
    this.host = document.createElement('div');
    this.host.className = 'rk-reward-toast';
    this.host.setAttribute('aria-live', 'polite');
    this.line = document.createElement('p');
    this.line.className = 'is-hidden';
    this.host.append(this.line);
    parent.append(this.host);
  }

  push(text: string, quiet = false): void {
    const clean = text.trim();
    if (!clean) return;
    this.queue.push({ text: clean, quiet });
    this.pump();
  }

  pushAll(texts: readonly string[]): void {
    for (const text of texts) this.push(text);
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue.length = 0;
    this.host.remove();
    this.style.remove();
  }

  private pump(): void {
    if (this.showing || this.queue.length === 0) return;
    const item = this.queue.shift();
    if (!item) return;
    this.showing = true;
    this.line.textContent = item.text;
    this.line.classList.toggle('quiet', item.quiet);
    this.line.classList.remove('is-hidden');
    this.timer = setTimeout(
      () => {
        this.line.classList.add('is-hidden');
        this.line.textContent = '';
        this.showing = false;
        this.timer = null;
        this.pump();
      },
      item.quiet ? 2200 : 2800,
    );
    unref(this.timer);
  }
}
