import type { LearnQuestion, SpeakLang } from './types';

/** Håller kvar yttret så att webbläsaren inte slänger det innan det lästs upp. */
const held: SpeechSynthesisUtterance[] = [];

function speechApi(): { synth: SpeechSynthesis; Utter: typeof SpeechSynthesisUtterance } | null {
  if (typeof window === 'undefined') return null;
  const synth = window.speechSynthesis;
  const Utter = window.SpeechSynthesisUtterance;
  if (typeof synth?.speak !== 'function' || typeof Utter !== 'function') return null;
  return { synth, Utter };
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

/** Läser upp texten. Tyst no-op om API:t saknas eller texten är tom. */
export function speak(text: string, lang: SpeakLang): void {
  const api = speechApi();
  if (!api) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    api.synth.cancel();
    const utterance = new api.Utter(trimmed);
    utterance.lang = lang;
    utterance.rate = 0.9;
    held[0] = utterance;
    api.synth.speak(utterance);
  } catch {
    /* API:t finns men gick inte att använda. */
  }
}

/** Vad som ska läsas för en fråga. Rättstavning läser det rätta ordet. */
export function questionUtterance(q: LearnQuestion): { text: string; lang: SpeakLang } {
  if (q.rule === 'rattstavning') {
    const word = q.answer.trim();
    const text = q.speakPrompt ? `${q.prompt} ${word}`.trim() : word;
    return { text, lang: 'sv-SE' };
  }
  const lang = q.speakLang ?? 'sv-SE';
  const main = (q.speakText ?? q.prompt).trim();
  const text = q.speakPrompt && q.speakText && q.prompt.trim() !== main ? `${q.prompt} ${main}`.trim() : main;
  return { text, lang };
}
