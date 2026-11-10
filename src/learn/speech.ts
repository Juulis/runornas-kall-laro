import type { LearnQuestion, SpeakLang } from './types';

/** Röst som räcker för att välja språk. Web Speech-röster uppfyller det. */
export interface SpeakVoice {
  lang: string;
  name?: string;
  localService?: boolean;
  default?: boolean;
}

/** Håller kvar yttret så att webbläsaren inte slänger det innan det lästs upp. */
const held: SpeechSynthesisUtterance[] = [];
const voiceBound = new WeakSet<object>();

function speechApi(): { synth: SpeechSynthesis; Utter: typeof SpeechSynthesisUtterance } | null {
  if (typeof window === 'undefined') return null;
  const synth = window.speechSynthesis;
  const Utter = window.SpeechSynthesisUtterance;
  if (typeof synth?.speak !== 'function' || typeof Utter !== 'function') return null;
  return { synth, Utter };
}

function normLang(lang: string): string {
  return lang.trim().toLowerCase().replace(/_/g, '-');
}

function voiceRank(v: SpeakVoice): number {
  return (v.localService ? 2 : 0) + (v.default ? 1 : 0);
}

/**
 * Väljer en röst för språket. Exakt träff vinner över språkstam (en-US före en-GB).
 * Saknas en passande röst blir det null, och yttrets lang får styra.
 */
export function pickSpeakVoice<T extends SpeakVoice>(voices: readonly T[], lang: string): T | null {
  const want = normLang(lang);
  const prefix = want.slice(0, 2);
  let exact: T | null = null;
  let exactRank = -1;
  let loose: T | null = null;
  let looseRank = -1;
  for (const v of voices) {
    const code = normLang(v.lang);
    const score = voiceRank(v);
    if (code === want) {
      if (score >= exactRank) {
        exact = v;
        exactRank = score;
      }
    } else if (prefix && code.slice(0, 2) === prefix && score >= looseRank) {
      loose = v;
      looseRank = score;
    }
  }
  return exact ?? loose;
}

function ensureVoices(synth: SpeechSynthesis): void {
  try {
    synth.getVoices();
  } catch {
    return;
  }
  if (voiceBound.has(synth)) return;
  voiceBound.add(synth);
  const apply = (): void => {
    const current = held[0];
    if (!current || current.voice) return;
    const voice = pickSpeakVoice(synth.getVoices(), current.lang);
    if (voice) current.voice = voice;
  };
  try {
    synth.addEventListener('voiceschanged', apply);
  } catch {
    /* äldre motorer saknar addEventListener */
  }
  const prev = synth.onvoiceschanged;
  synth.onvoiceschanged = (ev: Event) => {
    apply();
    if (typeof prev === 'function') prev.call(synth, ev);
  };
}

/** Sant när Web Speech API finns. */
export function canSpeak(): boolean {
  return speechApi() !== null;
}

/** Avbryter pågående uppläsning. Gör inget om API:t saknas. */
export function cancel(): void {
  held.length = 0;
  try {
    speechApi()?.synth.cancel();
  } catch {
    /* API:t finns men gick inte att använda. */
  }
}

function retrySpeak(synth: SpeechSynthesis, utterance: SpeechSynthesisUtterance): void {
  if (held[0] !== utterance) return;
  if (synth.speaking || synth.pending) return;
  try {
    synth.speak(utterance);
    if (synth.paused) synth.resume();
  } catch {
    /* API:t finns men gick inte att använda. */
  }
}

/**
 * Läser upp texten i samma anrop (klickgesten får inte tappas).
 * Chrome slänger ett speak som kommer i samma tur som cancel, så vi talar
 * direkt och lägger bara ett nytt försök när något redan talade.
 */
export function speak(text: string, lang: SpeakLang): void {
  const api = speechApi();
  if (!api) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    const { synth } = api;
    ensureVoices(synth);
    const utterance = new api.Utter(trimmed);
    utterance.lang = lang;
    utterance.rate = 0.9;
    const voice = pickSpeakVoice(synth.getVoices(), lang);
    if (voice) utterance.voice = voice;
    held[0] = utterance;
    if (synth.paused) synth.resume();
    const busy = !!(synth.speaking || synth.pending);
    if (busy) synth.cancel();
    synth.speak(utterance);
    if (synth.paused) synth.resume();
    if (!busy) return;
    queueMicrotask(() => retrySpeak(synth, utterance));
    setTimeout(() => retrySpeak(synth, utterance), 40);
  } catch {
    /* API:t finns men gick inte att använda. */
  }
}

/** Vad som ska läsas för en fråga. Rättstavning läser bara prompten, aldrig ordet. */
export function questionUtterance(q: LearnQuestion): { text: string; lang: SpeakLang } {
  if (q.rule === 'rattstavning') return { text: q.prompt.trim(), lang: 'sv-SE' };
  const lang = q.speakLang ?? 'sv-SE';
  const main = (q.speakText ?? q.prompt).trim();
  const text = q.speakPrompt && q.speakText && q.prompt.trim() !== main ? `${q.prompt} ${main}`.trim() : main;
  return { text, lang };
}
