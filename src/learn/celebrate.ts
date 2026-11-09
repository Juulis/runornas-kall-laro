import { burstConfetti } from '../ui/Confetti';

/** Ord som visas stort när svaret är rätt. Roterar så det inte blir samma varje gång. */
export const CELEBRATE_PHRASES = ['Rätt!', 'Snyggt!', 'Bra!'] as const;

/** Hur länge hjälten studsar. Striden fortsätter under tiden. */
export const HERO_BOUNCE_S = 0.9;

/** Skärm- eller världspunkt dit stjärnor kan flyga (kopplas på av stjärnräknaren). */
export interface StarFlyInfo {
  x: number;
  y: number;
  starsHint?: number;
}

export type StarFlyHandler = (info: StarFlyInfo) => void;

export interface CelebrateOptions extends StarFlyInfo {
  /** null hoppar över DOM. Saknas: document.body när den finns. */
  parent?: HTMLElement | null;
}

/** 0..1 genom studsen. Skala runt 1 och lyft i pixlar uppåt. */
export function heroBounceFrame(t: number): { scale: number; lift: number } {
  const p = Math.min(1, Math.max(0, t));
  if (p === 0 || p === 1) return { scale: 1, lift: 0 };
  const wave = Math.sin(p * Math.PI);
  const hop = Math.abs(Math.sin(p * Math.PI * 2));
  return { scale: 1 + 0.18 * wave, lift: 28 * hop * (1 - p * 0.35) };
}

let phraseI = 0;
let starFlyHandler: StarFlyHandler | null = null;
let audioCtx: AudioContext | null = null;
let bannerStyle: HTMLStyleElement | null = null;

const BANNER_CSS = `
.rk-celebrate{position:fixed;left:50%;top:38%;z-index:40;pointer-events:none;font:900 clamp(64px,12vw,120px) Cinzel,serif;color:#fff8e8;text-shadow:0 6px 0 #146b32,0 0 24px #7dff9a;animation:rk-celebrate-pop 1.05s ease-out forwards}
@keyframes rk-celebrate-pop{0%{transform:translate(-50%,-50%) scale(.4) rotate(-8deg);opacity:0}18%{transform:translate(-50%,-50%) scale(1.18) rotate(4deg);opacity:1}42%{transform:translate(-50%,-50%) scale(1) rotate(-2deg);opacity:1}100%{transform:translate(-50%,-50%) scale(1.05) rotate(0deg);opacity:0}}
@media (prefers-reduced-motion: reduce){.rk-celebrate{animation:none;opacity:1;transform:translate(-50%,-50%)}}
`;

/** Koppla på flygande stjärnor. null stänger av. Standard är att inget händer. */
export function setStarFlyHandler(handler: StarFlyHandler | null): void {
  starFlyHandler = handler;
}

export function nextCelebratePhrase(): string {
  const phrase = CELEBRATE_PHRASES[phraseI % CELEBRATE_PHRASES.length] ?? 'Rätt!';
  phraseI += 1;
  return phrase;
}

function audioContextCtor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Kort glad treklang. Tyst om AudioContext saknas eller inte går att använda. */
export function playHappyChime(): void {
  const Ctor = audioContextCtor();
  if (!Ctor) return;
  let ctx: AudioContext;
  try {
    if (!audioCtx || audioCtx.state === 'closed') audioCtx = new Ctor();
    ctx = audioCtx;
  } catch {
    audioCtx = null;
    return;
  }
  try {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const now = ctx.currentTime || 0;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const master = ctx.createGain();
    master.gain.value = 0.2;
    master.connect(ctx.destination);
    for (let i = 0; i < notes.length; i++) {
      const freq = notes[i] ?? 523.25;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      const t0 = now + i * 0.07;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(1, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t0);
      osc.stop(t0 + 0.22);
    }
  } catch {
    /* ingen ljudmiljö */
  }
}

function defaultParent(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.body;
}

function ensureBannerStyle(): void {
  if (typeof document === 'undefined') return;
  if (bannerStyle?.isConnected) return;
  const style = document.createElement('style');
  style.dataset.rkCelebrate = '1';
  style.textContent = BANNER_CSS;
  document.head.append(style);
  bannerStyle = style;
}

function showCelebrateBanner(parent: HTMLElement | null, phrase: string): void {
  if (typeof document === 'undefined' || !parent) return;
  ensureBannerStyle();
  const banner = document.createElement('div');
  banner.className = 'rk-celebrate';
  banner.setAttribute('role', 'status');
  banner.textContent = phrase;
  parent.append(banner);
  globalThis.setTimeout(() => banner.remove(), 1100);
}

/**
 * Firar ett rätt svar: konfetti, glad signal, stor text och stjärnkrok.
 * Striden ska starta av anroparen. Kroken är en no-op tills den sätts.
 */
export function celebrateCorrect(opts: CelebrateOptions): string {
  const phrase = nextCelebratePhrase();
  playHappyChime();
  const parent = opts.parent === undefined ? defaultParent() : opts.parent;
  try {
    burstConfetti(parent, opts.x, opts.y);
    showCelebrateBanner(parent, phrase);
  } catch {
    /* DOM saknas eller är trasigt */
  }
  const info: StarFlyInfo = { x: opts.x, y: opts.y };
  if (opts.starsHint !== undefined) info.starsHint = opts.starsHint;
  starFlyHandler?.(info);
  return phrase;
}
