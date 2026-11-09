import { setLoadingProgress } from './loadingScreen';

const FAIL_TEXT = 'Kunde inte ladda. Försök igen.';

interface ChunkUi {
  setProgress(value: number): void;
  done(): void;
  fail(retry: () => void): void;
}

/**
 * Visar verklig progress för en dynamisk import.
 * Loadingskärmen används om den finns kvar, annars en lätt text. Fel visas med retry.
 * Löftet blir klart först när försöket lyckas.
 */
let chunkChain: Promise<void> = Promise.resolve();

export function trackChunkLoad(label: string, work: (onProgress: (ratio: number) => void) => Promise<void>): Promise<void> {
  const job = chunkChain.then(() => runChunkLoad(label, work));
  chunkChain = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

function runChunkLoad(label: string, work: (onProgress: (ratio: number) => void) => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const attempt = (): void => {
      const ui = openChunkUi(label);
      work((ratio) => ui.setProgress(ratio))
        .then(() => {
          ui.done();
          resolve();
        })
        .catch((err: unknown) => {
          console.error(err);
          ui.fail(() => attempt());
        });
    };
    attempt();
  });
}

function openChunkUi(label: string): ChunkUi {
  const loading = document.getElementById('rk-loading');
  if (loading instanceof HTMLElement && loading.isConnected) return loadingUi(loading, label);
  return overlayUi(label);
}

function loadingUi(el: HTMLElement, label: string): ChunkUi {
  const hint = el.querySelector('[data-i18n="loading.hint"]');
  const previous = hint?.textContent ?? '';
  if (hint) hint.textContent = label;
  let moved: ChunkUi | null = null;
  const live = (): ChunkUi => {
    if (el.isConnected) return moved ? moved : fallback;
    moved ??= overlayUi(label);
    return moved;
  };
  const fallback: ChunkUi = {
    setProgress(value) {
      if (!el.isConnected) {
        live().setProgress(value);
        return;
      }
      setLoadingProgress(el, value);
    },
    done() {
      if (!el.isConnected) {
        moved?.done();
        return;
      }
      if (hint && hint.textContent === label) hint.textContent = previous;
      el.querySelector('[data-rk-chunk-err]')?.remove();
    },
    fail(retry) {
      if (!el.isConnected) {
        live().fail(retry);
        return;
      }
      mountError(el.querySelector('.rk-frame') ?? el, retry);
    },
  };
  return fallback;
}

let overlayRoot: HTMLDivElement | null = null;
let overlayTimer: ReturnType<typeof setTimeout> | undefined;

function overlayUi(label: string): ChunkUi {
  let shown = overlayRoot !== null && overlayRoot.isConnected;
  let progress = 0;
  let settled = false;
  const paint = (text: string, ratio: number | null, retry: (() => void) | null): void => {
    const root = ensureOverlay();
    root.replaceChildren();
    const msg = document.createElement('p');
    msg.style.margin = '0';
    msg.textContent = text;
    root.append(msg);
    if (ratio !== null && !retry) {
      const pct = document.createElement('p');
      pct.style.margin = '6px 0 0';
      pct.textContent = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)} %`;
      root.append(pct);
    }
    if (retry) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Försök igen';
      Object.assign(btn.style, {
        marginTop: '10px',
        font: '18px Cinzel, serif',
        padding: '8px 14px',
        borderRadius: '10px',
        border: '2px solid #e0b060',
        background: '#3a2e18',
        color: '#fff8e8',
        cursor: 'pointer',
      });
      btn.addEventListener('click', retry);
      root.append(btn);
    }
  };
  const reveal = (): void => {
    if (settled || shown) return;
    shown = true;
    paint(label, progress, null);
  };
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(reveal, 120);
  return {
    setProgress(value) {
      progress = value;
      if (shown && !settled) paint(label, value, null);
    },
    done() {
      settled = true;
      clearTimeout(overlayTimer);
      overlayRoot?.remove();
      overlayRoot = null;
    },
    fail(retry) {
      settled = true;
      clearTimeout(overlayTimer);
      shown = true;
      paint(FAIL_TEXT, null, retry);
    },
  };
}

function ensureOverlay(): HTMLDivElement {
  if (overlayRoot?.isConnected) return overlayRoot;
  const root = document.createElement('div');
  root.id = 'rk-chunk-load';
  root.setAttribute('role', 'status');
  Object.assign(root.style, {
    position: 'fixed',
    left: '50%',
    top: '18px',
    transform: 'translateX(-50%)',
    zIndex: '80',
    maxWidth: 'min(440px, calc(100vw - 24px))',
    padding: '14px 18px',
    borderRadius: '14px',
    border: '3px solid #c7a35a',
    background: '#1c1612',
    color: '#efe7d2',
    font: '18px Cinzel, serif',
    textAlign: 'center',
    boxShadow: '0 10px 28px #000',
  });
  document.body.append(root);
  overlayRoot = root;
  return root;
}

function mountError(host: Element, retry: () => void): void {
  host.querySelector('[data-rk-chunk-err]')?.remove();
  const box = document.createElement('div');
  box.dataset.rkChunkErr = '1';
  const msg = document.createElement('p');
  msg.textContent = FAIL_TEXT;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Försök igen';
  btn.addEventListener('click', () => {
    box.remove();
    retry();
  });
  box.append(msg, btn);
  host.append(box);
}
