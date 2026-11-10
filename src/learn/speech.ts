import type { LearnQuestion, SpeakLang } from './types';

/** Röst som räcker för att välja språk. Web Speech-röster uppfyller det. */
export interface SpeakVoice {
  lang: string;
  name?: string;
  localService?: boolean;
  default?: boolean;
}

/** Ett stycke som ska läsas med en röst. */
export interface SpeakPart {
  text: string;
  lang: SpeakLang;
}

const SPEAK_RATE = 0.9;

/** Håller kvar yttrena så att webbläsaren inte slänger dem innan de lästs upp. */
const held: SpeechSynthesisUtterance[] = [];
const voiceBound = new WeakSet<object>();

/** Generation så att en sen voiceschanged inte rör ett nyare klick. */
let playId = 0;
/** Sant medan speakSequence bygger yttret, så en synkron voiceschanged inte byter kön. */
let settling = false;
/** Något yttre i den här omgången har börjat höras. */
let started = false;
/** Antal yttre som ännu inte fått onend. */
let pendingStart = 0;
/** Ett omförsök med sen röst per klick, så vi inte läser om i en loop. */
let voiceRetried = false;

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
 * En svensk röst väljs aldrig för en-US. Saknas en passande röst blir det null,
 * och yttrets lang får styra.
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

function currentVoices(synth: SpeechSynthesis): SpeechSynthesisVoice[] {
  try {
    return synth.getVoices();
  } catch {
    return [];
  }
}

function asSpeakLang(lang: string): SpeakLang {
  if (lang === 'en-US' || lang === 'en-GB' || lang === 'sv-SE') return lang;
  return 'sv-SE';
}

/**
 * Chrome tystar ett yttre om voice sätts efter synth.speak(), till exempel
 * i voiceschanged. Engelska röster kommer ofta senare än svenska, så Lyssna
 * på en engelsk text hann starta utan röst och dog när rösten sedan skrevs på.
 * Därför sätts voice bara före speak. Kommer rösten senare och inget hunnit
 * börja spela talar vi om. Ett yttre som redan ligger i kön lämnas orört.
 */
function applyLateVoices(synth: SpeechSynthesis): void {
  if (settling || voiceRetried || started) return;
  if (pendingStart <= 0 || held.length === 0) return;
  if (synth.speaking || synth.pending) return;
  const voices = currentVoices(synth);
  if (!held.some((u) => !u.voice && pickSpeakVoice(voices, u.lang))) return;
  const Utter = speechApi()?.Utter;
  if (!Utter) return;
  const parts: SpeakPart[] = [];
  for (const u of held) {
    const text = u.text.trim();
    if (!text) continue;
    parts.push({ text, lang: asSpeakLang(u.lang) });
  }
  if (!parts.length) return;
  voiceRetried = true;
  playId += 1;
  const id = playId;
  const next = parts.map((part) => buildUtterance(Utter, synth, part, id));
  held.length = 0;
  for (const u of next) held.push(u);
  pendingStart = next.length;
  started = false;
  try {
    for (const u of next) synth.speak(u);
    if (synth.paused) synth.resume();
  } catch {
    /* API:t finns men gick inte att använda. */
  }
}

function ensureVoices(synth: SpeechSynthesis): void {
  if (voiceBound.has(synth)) {
    currentVoices(synth);
    return;
  }
  voiceBound.add(synth);
  const apply = (): void => {
    applyLateVoices(synth);
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
  currentVoices(synth);
}

/** Ber webbläsaren ladda röster tidigt. Talar inte. */
export function warmSpeakVoices(): void {
  const api = speechApi();
  if (!api) return;
  ensureVoices(api.synth);
}

/** Sant när Web Speech API finns. */
export function canSpeak(): boolean {
  return speechApi() !== null;
}

/** Avbryter pågående uppläsning. Gör inget om API:t saknas. */
export function cancel(): void {
  playId += 1;
  started = false;
  voiceRetried = false;
  pendingStart = 0;
  held.length = 0;
  try {
    speechApi()?.synth.cancel();
  } catch {
    /* API:t finns men gick inte att använda. */
  }
}

function buildUtterance(
  Utter: typeof SpeechSynthesisUtterance,
  synth: SpeechSynthesis,
  part: SpeakPart,
  id: number,
): SpeechSynthesisUtterance {
  const utterance = new Utter(part.text);
  utterance.lang = part.lang;
  utterance.rate = SPEAK_RATE;
  const voice = pickSpeakVoice(currentVoices(synth), part.lang);
  // Bara före speak. Att sätta voice senare tystar Chrome.
  if (voice) utterance.voice = voice;
  utterance.onstart = () => {
    if (id !== playId) return;
    started = true;
  };
  utterance.onend = () => {
    if (id !== playId) return;
    pendingStart = Math.max(0, pendingStart - 1);
    // Chrome kan pausa kön mellan två yttre. Återuppta, utan att avbryta nästa.
    try {
      if (synth.paused) synth.resume();
    } catch {
      /* motorn ville inte återuppta */
    }
  };
  utterance.onerror = (ev: SpeechSynthesisErrorEvent) => {
    if (id !== playId) return;
    pendingStart = Math.max(0, pendingStart - 1);
    if (ev.error === 'voice-unavailable' || ev.error === 'language-unavailable' || ev.error === 'synthesis-failed') {
      voiceRetried = false;
    }
  };
  return utterance;
}

function retrySequence(synth: SpeechSynthesis, utterances: readonly SpeechSynthesisUtterance[], id: number): void {
  if (id !== playId) return;
  if (held[0] !== utterances[0]) return;
  if (synth.speaking || synth.pending) return;
  try {
    for (const u of utterances) synth.speak(u);
    if (synth.paused) synth.resume();
  } catch {
    /* API:t finns men gick inte att använda. */
  }
}

/**
 * Läser segmenten i ordning i samma klick (gesten får inte tappas).
 * Inget cancel mellan segmenten, för det skulle klippa nästa.
 * Chrome slänger speak i samma tur som cancel, så vid pågående tal
 * talar vi ändå direkt och försöker igen strax efter.
 */
export function speakSequence(parts: readonly SpeakPart[]): void {
  const api = speechApi();
  if (!api) return;
  const cleaned: SpeakPart[] = [];
  for (const part of parts) {
    const text = part.text.trim();
    if (!text) continue;
    cleaned.push({ text, lang: part.lang });
  }
  if (!cleaned.length) return;
  const { synth, Utter } = api;
  settling = true;
  try {
    ensureVoices(synth);
    playId += 1;
    const id = playId;
    voiceRetried = false;
    started = false;
    const utterances = cleaned.map((part) => buildUtterance(Utter, synth, part, id));
    held.length = 0;
    for (const u of utterances) held.push(u);
    pendingStart = utterances.length;
    if (synth.paused) synth.resume();
    const busy = !!(synth.speaking || synth.pending);
    if (busy) synth.cancel();
    for (const u of utterances) synth.speak(u);
    if (synth.paused) synth.resume();
    if (!busy) return;
    const retry = (): void => retrySequence(synth, utterances, id);
    queueMicrotask(retry);
    setTimeout(retry, 40);
  } catch {
    /* API:t finns men gick inte att använda. */
  } finally {
    settling = false;
  }
}

/** Läser upp en text. Blandade språk ska gå via speakSequence. */
export function speak(text: string, lang: SpeakLang): void {
  speakSequence([{ text, lang }]);
}

function sameText(a: string, b: string): boolean {
  return a.localeCompare(b, 'sv', { sensitivity: 'accent' }) === 0;
}

function swedishChunk(raw: string): string {
  return raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
}

/**
 * Sista utväg när det engelska ordet bara finns som citat i en svensk mening,
 * till exempel Vad betyder 'dog'?. Facit i citattecken läses inte upp.
 */
function splitEmbeddedEnglish(prompt: string, answer: string): SpeakPart[] | null {
  if (!/['"\u2018\u2019\u201c\u201d][A-Za-z]/.test(prompt)) return null;
  const re = /['"\u2018\u2019\u201c\u201d]([A-Za-z]+(?:[- ][A-Za-z]+)*)['"\u2018\u2019\u201c\u201d]/g;
  const parts: SpeakPart[] = [];
  let last = 0;
  let found = false;
  for (const match of prompt.matchAll(re)) {
    const index = match.index ?? 0;
    const before = swedishChunk(prompt.slice(last, index));
    if (before) parts.push({ text: before, lang: 'sv-SE' });
    const word = match[1]?.trim() ?? '';
    const words = word.split(/[\s-]+/).filter(Boolean);
    if (word && words.length <= 4) {
      found = true;
      // Citat som är facit hoppas över, så svaret inte läses upp.
      if (!sameText(word, answer)) parts.push({ text: word, lang: 'en-US' });
    }
    last = index + match[0].length;
  }
  if (!found) return null;
  const after = swedishChunk(prompt.slice(last));
  if (after) parts.push({ text: after, lang: 'sv-SE' });
  return parts.length ? parts : null;
}

function isSpelling(rule: string): boolean {
  return rule === 'rattstavning' || rule === 'stavning';
}

/**
 * Segment som ska läsas för en fråga. Stavning läser bara prompten, aldrig ordet.
 * Översättning med eng/speakText delas: svensk prompt, sedan det engelska ordet.
 * Hörförståelse är ett enda yttre på textens språk.
 */
export function questionUtterances(q: LearnQuestion): SpeakPart[] {
  const prompt = q.prompt.trim();
  if (isSpelling(q.rule)) return prompt ? [{ text: prompt, lang: 'sv-SE' }] : [];

  if (q.subject === 'horforstaelse' || q.subject === 'lasforstaelse' || q.passage) {
    const text = (q.speakText ?? prompt).trim();
    return text ? [{ text, lang: q.speakLang ?? 'sv-SE' }] : [];
  }

  const gloss = (q.speakText ?? '').trim();
  const splitGloss = !!gloss && !!prompt && gloss !== prompt && (q.speakPrompt === true || q.rule === 'oversattning');
  if (splitGloss) {
    if (q.speakLang === 'sv-SE') return [{ text: `${prompt} ${gloss}`.trim(), lang: 'sv-SE' }];
    const wordLang: SpeakLang = q.speakLang === 'en-GB' ? 'en-GB' : 'en-US';
    return [
      { text: prompt, lang: 'sv-SE' },
      { text: gloss, lang: wordLang },
    ];
  }

  if (!gloss) {
    const embedded = splitEmbeddedEnglish(prompt, q.answer);
    if (embedded) return embedded;
    return prompt ? [{ text: prompt, lang: 'sv-SE' }] : [];
  }

  return [{ text: gloss, lang: q.speakLang ?? 'sv-SE' }];
}

/** Första segmentet. Blandade frågor läses med questionUtterances, inte här. */
export function questionUtterance(q: LearnQuestion): SpeakPart {
  const first = questionUtterances(q)[0];
  if (first) return first;
  return { text: q.prompt.trim(), lang: 'sv-SE' };
}
