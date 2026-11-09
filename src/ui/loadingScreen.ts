import { LocaleManager } from '../i18n/LocaleManager';
import { isLocale, type Key } from '../i18n/types';
import { LocalStorageSaveBackend } from '../save/backend/LocalStorageSaveBackend';
import { clamp01 } from '../render/loadProgress';

/** Syns i HTML innan ordboken hunnit laddas. */
export const LOADING_HINT_FALLBACK = 'Världen vaknar';
export const LOADING_ARIA_FALLBACK = 'Laddar';

/** Matchar `transition: opacity .45s` i public/assets/ui/loading/loading.css. */
export const LOADING_FADE_MS = 450;

/** Bilder som .rk-has-art behöver. Saknas en tas klassen bort (Cinzel + CSS-list). */
export const LOADING_ART_FILES = [
  'titel.webp',
  'runa.webp',
  'runsten.webp',
  'stenram.webp',
  'progress_track.webp',
  'progress_fill.webp',
] as const;

type LoadingKey = 'loading.hint' | 'loading.aria';

export function loadingPublicBase(baseUrl?: string): string {
  const raw = baseUrl ?? viteBaseUrl();
  if (!raw) return '/runornas-kall-laro/';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

function viteBaseUrl(): string {
  try {
    const base = import.meta.env?.BASE_URL;
    if (typeof base === 'string' && base.length > 0) return base;
  } catch {
    /* Node-test utan Vite-env. */
  }
  return '/runornas-kall-laro/';
}

/** Absolut eller sid-relativ URL till en fil i public/assets/ui/loading/. */
export function loadingAssetUrl(file: string, baseUrl?: string): string {
  return `${loadingPublicBase(baseUrl)}assets/ui/loading/${file}`;
}

/**
 * Katalog där loadingskärmens bilder ligger, läst från den markup Vite redan skrivit.
 * Fungerar med BASE_URL (`/runornas-kall-laro/` på Pages) utan att hårdkoda sökvägen i JS.
 */
export function loadingArtDirectory(doc: Document, baseUrl?: string): string {
  const img = doc.querySelector<HTMLImageElement>('#rk-loading img.rk-title-img');
  const fromImg = directoryOfAsset(img?.getAttribute('src'));
  if (fromImg) return fromImg;
  const link = [...doc.querySelectorAll('link')].find((el) => (el.getAttribute('href') ?? '').includes('assets/ui/loading/loading.css'));
  const fromCss = directoryOfAsset(link?.getAttribute('href'));
  if (fromCss) return fromCss;
  return loadingAssetUrl('', baseUrl);
}

function directoryOfAsset(url: string | null | undefined): string | null {
  if (!url || !url.includes('assets/ui/loading/')) return null;
  const cut = url.lastIndexOf('/') + 1;
  return url.slice(0, cut);
}

export function setLoadingProgress(el: HTMLElement, value: number): void {
  const clamped = clamp01(value);
  el.style.setProperty('--rk-p', String(clamped));
  const pct = String(Math.round(clamped * 100));
  el.setAttribute('aria-valuenow', pct);
  const label = el.querySelector('[data-rk-pct]');
  if (label) label.textContent = pct;
}

function translated(value: string, key: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === key) return fallback;
  return trimmed;
}

export function applyLoadingLocale(doc: Document, t: (key: LoadingKey) => string): void {
  const root = doc.getElementById('rk-loading');
  if (!root) return;
  const hint = root.querySelector('[data-i18n="loading.hint"]');
  if (hint) hint.textContent = translated(t('loading.hint'), 'loading.hint', LOADING_HINT_FALLBACK);
  root.setAttribute('aria-label', translated(t('loading.aria'), 'loading.aria', LOADING_ARIA_FALLBACK));
}

export function bindLoadingArtFallback(
  root: HTMLElement,
  urlFor: (file: string) => string = loadingAssetUrl,
  createProbe: () => HTMLImageElement = () => new Image(),
): void {
  const drop = (): void => {
    root.classList.remove('rk-has-art');
  };
  const title = root.querySelector<HTMLImageElement>('img.rk-title-img');
  if (title) {
    title.addEventListener('error', drop);
    if (title.complete && title.naturalWidth === 0) drop();
  }
  for (const file of LOADING_ART_FILES) {
    const probe = createProbe();
    probe.addEventListener('error', drop);
    probe.src = urlFor(file);
  }
}

/** Första målning: bevaka om bilderna faktiskt går att ladda. */
export function bootLoadingScreen(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (!doc) return;
  const root = doc.getElementById('rk-loading');
  if (!(root instanceof HTMLElement)) return;
  const hint = root.querySelector('[data-i18n="loading.hint"]');
  if (hint && !hint.textContent?.trim()) hint.textContent = LOADING_HINT_FALLBACK;
  bindLoadingArtFallback(root, (file) => `${loadingArtDirectory(doc)}${file}`);
}

function readSavedLocale(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(LocalStorageSaveBackend.SETTING_PREFIX + LocaleManager.STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Sätter hint/aria innan de tunga texturerna laddas, om ett språk redan är sparat.
 * Skriver inte inställningen (LocaleManager har ingen backend ännu).
 */
export async function primeLoadingLocale(
  i18n: LocaleManager,
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): Promise<void> {
  const saved = readSavedLocale();
  if (saved && saved !== 'sv' && isLocale(saved)) {
    try {
      await i18n.setLocale(saved);
    } catch (e) {
      console.warn('[loading] språk', e);
    }
  }
  if (doc) applyLoadingLocale(doc, (key) => i18n.t(key as Key));
}

/**
 * Lägg på rk-done och ta bort overlayen när opacitetstransitionen är klar.
 * Timeout om transitionend inte kommer (t.ex. reducerad rörelse).
 */
export function dismissLoadingOverlay(el: HTMLElement, fadeMs: number = LOADING_FADE_MS): void {
  if (el.dataset.rkDismissing === '1') return;
  el.dataset.rkDismissing = '1';
  setLoadingProgress(el, 1);
  el.classList.add('rk-done');
  let gone = false;
  const remove = (): void => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    el.removeEventListener('transitionend', onEnd);
    el.remove();
  };
  const onEnd = (ev: Event): void => {
    if (ev.target !== el) return;
    const name = (ev as TransitionEvent).propertyName;
    if (name && name !== 'opacity') return;
    remove();
  };
  el.addEventListener('transitionend', onEnd);
  const timer = setTimeout(remove, fadeMs + 50);
}

/**
 * Menyn är målad (dubbel rAF) eller kommer inte att visas.
 * I båda fallen: rk-done, sedan bort från DOM efter fade.
 */
export function dismissLoadingWhenMenuReady(menuPainted: boolean, doc: Document = document): void {
  const el = doc.getElementById('rk-loading');
  if (!(el instanceof HTMLElement)) return;
  if (!menuPainted) {
    dismissLoadingOverlay(el);
    return;
  }
  const raf = globalThis.requestAnimationFrame;
  if (typeof raf !== 'function') {
    dismissLoadingOverlay(el);
    return;
  }
  raf(() => {
    raf(() => dismissLoadingOverlay(el));
  });
}
