import type { LearnQuestion, SpeakLang } from './types';
import { hasVoiceClips, lookupVoiceClip, voiceClipUrl } from './voiceClips';

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
/**
 * Chrome klipper eller tystar ett yttre runt 200 tecken (särskilt nätverksröster)
 * och kan lägga av efter ungefär 15 sekunder. Hörförståelse som hf-en-ak7_9-002
 * är längre än så. Det gäller bara talsyntesen. En färdig fil spelas hel.
 */
const MAX_UTTERANCE_CHARS = 140;

/** Håller kvar yttrena så att webbläsaren inte slänger dem innan de lästs upp. */
const held: SpeechSynthesisUtterance[] = [];
/** Håller kvar ljudet så att skräpsamlaren inte tar filen innan den spelats klart. */
const heldAudio: HTMLAudioElement[] = [];
const voiceBound = new WeakSet<object>();

/** Generation så att en sen voiceschanged inte rör ett nyare klick. */
let playId = 0;
/** Sant medan speakSequence bygger yttret, så en synkron voiceschanged inte byter kön. */
let settling = false;
/** Sant inne i applyLateVoices, så speak inte startar om samma byte. */
let applying = false;
/** Yttret som hör till segmentet vi just nu vill ha uppläst. */
let active: SpeechSynthesisUtterance | null = null;
let activePart: SpeakPart | null = null;
/** Sant när just det här yttret fått onstart. Redan påbörjade yttre rörs inte. */
let activeStarted = false;
/** Ett stycke i kön: hel mp3, eller ett yttre när filen saknas. */
type SpeechItem = { kind: 'clip'; part: SpeakPart; file: string } | { kind: 'tts'; part: SpeakPart };

/** Segment som ännu inte startats. Nästa byggs i onend eller audio.onended. */
let rest: SpeechItem[] = [];
/** Ljudfilen som spelas just nu. cancel pausar den och glömmer den. */
let activeAudio: HTMLAudioElement | null = null;
/** Ett omförsök per segment, så language-unavailable inte loopar. */
let segmentTries = 0;

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

/**
 * Chrome tystar ett yttre om voice sätts efter synth.speak().
 * Engelska röster kommer ofta senare än svenska. Har det här segmentet inte
 * börjat höras, och motorn inte redan köat det, bygger vi ett nytt yttre med
 * rösten. Det gamla lämnas orört. En redan påbörjad svensk del blockerar
 * inte det, för det engelska segmentet finns då ännu inte som yttre.
 */
function applyLateVoices(synth: SpeechSynthesis): void {
  if (settling || applying) return;
  if (!active || !activePart || activeStarted) return;
  if (active.voice) return;
  if (synth.speaking || synth.pending) return;
  if (!pickSpeakVoice(currentVoices(synth), activePart.lang)) return;
  const Utter = speechApi()?.Utter;
  if (!Utter) return;
  applying = true;
  try {
    const next = buildUtterance(Utter, synth, activePart, playId);
    active = next;
    activeStarted = false;
    held.push(next);
    try {
      synth.speak(next);
      if (synth.paused) synth.resume();
    } catch {
      /* API:t finns men gick inte att använda. */
    }
  } finally {
    applying = false;
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

/** Sant när talsyntes finns, eller när färdiga röstfiler kan spelas. */
export function canSpeak(): boolean {
  return speechApi() !== null || hasVoiceClips();
}

function silenceAudio(audio: HTMLAudioElement): void {
  audio.onended = null;
  audio.onerror = null;
  try {
    audio.pause();
    audio.src = '';
  } catch {
    /* spelaren ville inte stanna */
  }
}

/** Stoppar pågående fil och släpper referenserna. */
function stopHeldAudio(): void {
  const current = activeAudio;
  activeAudio = null;
  const list = heldAudio.splice(0);
  if (current && !list.includes(current)) list.push(current);
  for (const audio of list) silenceAudio(audio);
}

/** Avbryter pågående uppläsning, både fil och talsyntes. */
export function cancel(): void {
  playId += 1;
  active = null;
  activePart = null;
  activeStarted = false;
  segmentTries = 0;
  rest = [];
  held.length = 0;
  stopHeldAudio();
  try {
    speechApi()?.synth.cancel();
  } catch {
    /* API:t finns men gick inte att använda. */
  }
}

function isRetryable(error: string): boolean {
  return error === 'language-unavailable' || error === 'voice-unavailable' || error === 'synthesis-failed';
}

/** Delar en lång text vid meningar så att Chrome inte klipper den. */
function chunkTexts(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= MAX_UTTERANCE_CHARS) return [trimmed];
  const clean = trimmed.replace(/\s+/g, ' ');
  if (clean.length <= MAX_UTTERANCE_CHARS) return [clean];
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let buf = '';
  const flush = (): void => {
    if (!buf) return;
    chunks.push(buf);
    buf = '';
  };
  for (const sentence of sentences) {
    const pieces = sentence.length > MAX_UTTERANCE_CHARS ? splitLong(sentence) : [sentence];
    for (const piece of pieces) {
      if (!piece) continue;
      if (!buf) {
        buf = piece;
        continue;
      }
      const joined = `${buf} ${piece}`;
      if (joined.length <= MAX_UTTERANCE_CHARS) buf = joined;
      else {
        flush();
        buf = piece;
      }
    }
  }
  flush();
  return chunks;
}

function splitLong(text: string): string[] {
  const out: string[] = [];
  let left = text.trim();
  while (left.length > MAX_UTTERANCE_CHARS) {
    let cut = left.lastIndexOf(' ', MAX_UTTERANCE_CHARS);
    if (cut < 40) cut = MAX_UTTERANCE_CHARS;
    const piece = left.slice(0, cut).trim();
    if (piece) out.push(piece);
    left = left.slice(cut).trim();
  }
  if (left) out.push(left);
  return out;
}

/** Färdig fil för hela stycket. Saknas filen delas texten som för talsyntesen. */
function queueFromParts(parts: readonly SpeakPart[]): SpeechItem[] {
  const out: SpeechItem[] = [];
  for (const part of parts) {
    const text = part.text.trim();
    if (!text) continue;
    const clip = lookupVoiceClip(part.lang, text);
    if (clip) {
      out.push({ kind: 'clip', part: { text, lang: part.lang }, file: clip.file });
      continue;
    }
    for (const chunk of chunkTexts(text)) out.push({ kind: 'tts', part: { text: chunk, lang: part.lang } });
  }
  return out;
}

function createClipAudio(file: string): HTMLAudioElement | null {
  if (typeof Audio !== 'function') return null;
  try {
    // Laddas först när stycket ska spelas, inte alla filer i förväg.
    return new Audio(voiceClipUrl(file));
  } catch {
    return null;
  }
}

/** Filen gick inte att spela. Samma stycke läses med talsyntes, i samma omgång. */
function fallbackToSpeech(part: SpeakPart, synth: SpeechSynthesis | null, id: number): SpeechSynthesisUtterance | null {
  if (id !== playId) return null;
  const chunks: SpeechItem[] = chunkTexts(part.text).map((text) => ({ kind: 'tts', part: { text, lang: part.lang } }));
  rest = [...chunks, ...rest];
  return speakCurrent(synth ?? speechApi()?.synth ?? null, id);
}

function utter(synth: SpeechSynthesis, part: SpeakPart, id: number): SpeechSynthesisUtterance | null {
  const api = speechApi();
  if (!api || id !== playId) return null;
  const utterance = buildUtterance(api.Utter, synth, part, id);
  active = utterance;
  activePart = part;
  activeStarted = false;
  held.push(utterance);
  try {
    synth.speak(utterance);
    if (synth.paused) synth.resume();
  } catch {
    /* API:t finns men gick inte att använda. */
  }
  return utterance;
}

/**
 * Spelar en mp3 för hela stycket. play() anropas direkt, utan att vänta på nätet.
 * Misslyckas det läses samma stycke med talsyntes.
 */
function playClip(part: SpeakPart, file: string, synth: SpeechSynthesis | null, id: number): SpeechSynthesisUtterance | null {
  if (id !== playId) return null;
  const audio = createClipAudio(file);
  if (!audio) return fallbackToSpeech(part, synth, id);
  activeAudio = audio;
  heldAudio.push(audio);
  active = null;
  activePart = null;
  activeStarted = false;
  let done = false;
  const fail = (): SpeechSynthesisUtterance | null => {
    if (done || id !== playId || activeAudio !== audio) return null;
    done = true;
    audio.onended = null;
    audio.onerror = null;
    try {
      audio.pause();
      audio.src = '';
    } catch {
      /* redan stoppad */
    }
    if (activeAudio === audio) activeAudio = null;
    return fallbackToSpeech(part, synth, id);
  };
  audio.onended = () => {
    if (done || id !== playId || activeAudio !== audio) return;
    done = true;
    if (activeAudio === audio) activeAudio = null;
    speakCurrent(speechApi()?.synth ?? synth, id);
  };
  audio.onerror = () => {
    fail();
  };
  try {
    const pending = audio.play();
    if (pending && typeof pending.catch === 'function') {
      pending.catch(() => {
        fail();
      });
    }
  } catch {
    return fail();
  }
  return null;
}

/** Tar nästa segment. En fil spelas hel. Talsyntes är ett yttre i taget. */
function speakCurrent(synth: SpeechSynthesis | null, id: number): SpeechSynthesisUtterance | null {
  if (id !== playId) return null;
  while (rest.length > 0) {
    const item = rest.shift();
    if (!item) break;
    segmentTries = 0;
    if (item.kind === 'clip') return playClip(item.part, item.file, synth, id);
    const engine = synth ?? speechApi()?.synth ?? null;
    if (!engine) continue;
    return utter(engine, item.part, id);
  }
  active = null;
  activePart = null;
  activeStarted = false;
  segmentTries = 0;
  return null;
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
    if (id !== playId || active !== utterance) return;
    activeStarted = true;
  };
  utterance.onend = () => {
    if (id !== playId || active !== utterance) return;
    // Nästa segment byggs här, med röstlistan som finns nu. Ingen gemensam kö.
    try {
      if (synth.paused) synth.resume();
    } catch {
      /* motorn ville inte återuppta */
    }
    speakCurrent(synth, id);
    const next = active;
    // Chrome släpper ibland speak som görs i onend utan att sätta speaking.
    // Om inget hann börja, tala samma yttre igen. Redan påbörjade rörs inte.
    setTimeout(() => {
      if (id !== playId || !next || active !== next || activeStarted) return;
      if (synth.speaking || synth.pending) return;
      try {
        synth.speak(next);
        if (synth.paused) synth.resume();
      } catch {
        /* API:t finns men gick inte att använda. */
      }
    }, 50);
  };
  utterance.onerror = (ev: SpeechSynthesisErrorEvent) => {
    if (id !== playId || active !== utterance) return;
    if (!isRetryable(ev.error)) return;
    const failed = activePart;
    if (!failed) return;
    if (segmentTries >= 1) {
      speakCurrent(synth, id);
      return;
    }
    segmentTries += 1;
    // Nytt yttre, samma lang. Aldrig en svensk röst på engelsk text.
    utter(synth, failed, id);
  };
  return utterance;
}

/**
 * Färdiga röstfiler spelas först, ett stycke per fil. Nästa segment startar
 * i audio.onended. Saknas filen, eller om uppspelningen misslyckas, läses
 * just det stycket med talsyntes. Blandade frågor (fil och talsyntes) går
 * i följd, ett segment i taget.
 *
 * Engelska hördes inte efter #41. Två saker i koden gjorde den tyst på Chrome:
 * Hela kön speak:ades på en gång, och vid språkbyte (svensk prompt, sedan
 * engelskt ord) släpper Chrome ofta det andra yttret. Samtidigt satte den
 * svenska delen started så fort den började, och applyLateVoices avbröt då
 * (`started` eller `speaking`). Den engelska rösten kommer senare än den
 * svenska, så det engelska yttret låg kvar utan röst. Chrome svarar
 * language-unavailable och ger inget ljud, och felet byggde inget nytt yttre.
 * Därför talas ett segment i taget. Nästa byggs i onend med aktuella röster.
 * Voice sätts bara före speak. Saknas engelsk röst talas texten ändå med
 * lang en-US eller en-GB, aldrig med en svensk röst. Samma fel försöker om
 * en gång. Långa texter delas bara i talsyntesen, för Chrome klipper runt
 * 200 tecken. En färdig fil delas inte.
 * Första speak eller play sker i samma klick. Chrome slänger speak i samma
 * tur som cancel, så vid pågående tal talar vi direkt och försöker igen
 * strax efter.
 */
export function speakSequence(parts: readonly SpeakPart[]): void {
  const queued = queueFromParts(parts);
  if (!queued.length) return;
  const api = speechApi();
  const clipPossible = queued.some((item) => item.kind === 'clip') && typeof Audio === 'function';
  if (!api && !clipPossible) return;

  stopHeldAudio();
  playId += 1;
  const id = playId;
  active = null;
  activePart = null;
  activeStarted = false;
  segmentTries = 0;
  rest = queued;

  if (!api) {
    speakCurrent(null, id);
    return;
  }

  const { synth } = api;
  settling = true;
  try {
    ensureVoices(synth);
    if (synth.paused) synth.resume();
    const busy = !!(synth.speaking || synth.pending);
    if (busy) synth.cancel();
    held.length = 0;
    const utterance = speakCurrent(synth, id);
    if (!busy || !utterance) return;
    const retry = (): void => {
      if (id !== playId || !utterance || active !== utterance) return;
      if (synth.speaking || synth.pending) return;
      try {
        synth.speak(utterance);
        if (synth.paused) synth.resume();
      } catch {
        /* API:t finns men gick inte att använda. */
      }
    };
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
 * Hörförståelse och läsförståelse är ett stycke på textens språk.
 * Lång text delas bara om talsyntesen läser. En färdig fil spelas hel.
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
