import { assetUrl } from '../core/assets';
import { STICKER_MOTIF, streakFlameKind, type CosmeticId, type StickerId } from '../learn/rewards';

export function starIconUrl(earned: boolean): string {
  return assetUrl(`ui/beloningar/${earned ? 'stjarna_64' : 'stjarna_tom_64'}.png`);
}

export function flameIconUrl(streak: number): string | null {
  const kind = streakFlameKind(streak);
  if (!kind) return null;
  return assetUrl(`ui/beloningar/streak_flamma_${kind}_64.png`);
}

/** Generisk låst-ram som sista bildfallback. */
export function lockedFrameUrl(): string {
  return assetUrl('ui/klistermarken/klistermarke_last_ram_64.png');
}

/**
 * Primär sökväg: spec-id från belöningar.md / Grafiker.
 * Filer: public/assets/ui/klistermarken/{id}.png (+ _last, _64).
 */
export function stickerIdUrl(id: StickerId, unlocked: boolean): string {
  const last = unlocked ? '' : '_last';
  return assetUrl(`ui/klistermarken/${id}${last}.png`);
}

/** Äldre motivalias (klistermarke_rav osv) som fallback. */
export function stickerMotifUrl(id: StickerId, unlocked: boolean): string {
  const motif = STICKER_MOTIF[id];
  const last = unlocked ? '' : '_last';
  return assetUrl(`ui/klistermarken/klistermarke_${motif}${last}.png`);
}

/** Primär URL: spec-id. */
export function stickerUrl(id: StickerId, unlocked: boolean): string {
  return stickerIdUrl(id, unlocked);
}

/** Menyikon för kosmetika (64 px). */
export function cosmeticIconUrl(id: CosmeticId): string {
  return assetUrl(`ui/kosmetika/${id}_64.png`);
}

/** Emoji-fallback om bild saknas helt. */
export const STICKER_EMOJI: Record<StickerId, string> = {
  forsta_ratt: '⭐',
  streak_5: '🔥',
  streak_10: '💫',
  streak_20: '🏆',
  matte_ak1: '🔢',
  svenska_ak1: '📝',
  engelska_ak1: '🔤',
  las_ak1: '📖',
  forskola_stjarna: '🌟',
  champion_3: '⚔️',
  boss_1: '🐉',
  blandat_50: '🎲',
  dag_7: '📅',
  las_ak3: '📚',
  alla_amnen: '🧠',
};

/**
 * Kedja: spec-id → motivalias → låst-ram (om låst) → emoji.
 * Primärt används alltid de 15 riktiga filerna; resten är säkerhetsnät.
 */
export function bindStickerImg(img: HTMLImageElement, id: StickerId, unlocked: boolean): void {
  img.alt = unlocked ? id : `${id}, låst`;
  img.dataset.phase = 'id';
  img.src = stickerIdUrl(id, unlocked);
  img.onerror = () => {
    const phase = img.dataset.phase ?? 'id';
    if (phase === 'id') {
      img.dataset.phase = 'motif';
      img.src = stickerMotifUrl(id, unlocked);
      return;
    }
    if (phase === 'motif' && !unlocked) {
      img.dataset.phase = 'frame';
      img.src = lockedFrameUrl();
      return;
    }
    img.onerror = null;
    const span = document.createElement('span');
    span.className = 'rk-sticker-emoji';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = STICKER_EMOJI[id];
    img.replaceWith(span);
  };
}

/** Visa kosmetikikon; faller tillbaka till emoji vid saknad fil. */
export function bindCosmeticImg(img: HTMLImageElement, id: CosmeticId, emoji: string, namn: string): void {
  img.alt = namn;
  img.src = cosmeticIconUrl(id);
  img.onerror = () => {
    img.onerror = null;
    const span = document.createElement('span');
    span.className = 'emoji';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = emoji;
    img.replaceWith(span);
  };
}
