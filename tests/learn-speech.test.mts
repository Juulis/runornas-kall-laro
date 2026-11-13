/**
 * Engelskt tal och Lyssna: språkdelning, röstval och tysta felvägar.
 * Kör: npx tsx tests/learn-speech.test.mts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bankCount, ensureBank } from '../src/learn/bank';
import { generateQuestions } from '../src/learn/questions';
import { canSpeak, cancel, pickSpeakVoice, questionUtterance, questionUtterances, speak, speakSequence } from '../src/learn/speech';
import type { LearnQuestion } from '../src/learn/types';
import { resetVoiceManifestForTests, setVoiceManifestForTests } from '../src/learn/voiceClips';
import { LearnOverlay } from '../src/ui/LearnOverlay';

// Det här testet kollar talsyntesen. Färdiga filer ska inte ta över.
setVoiceManifestForTests(null);

await ensureBank('engelska');
await ensureBank('horforstaelse');

function sample(over: Partial<LearnQuestion>): LearnQuestion {
  return {
    id: 't',
    prompt: 'Fråga?',
    choices: ['a', 'b', 'c', 'd'],
    correctIndex: 0,
    answer: 'a',
    subject: 'engelska',
    grade: 'ak1',
    rule: 'glosa',
    ...over,
  };
}

assert.equal(
  pickSpeakVoice(
    [
      { lang: 'en-GB', name: 'Daniel', localService: true, default: true },
      { lang: 'en-US', name: 'Sam', localService: false },
    ],
    'en-US',
  )?.name,
  'Sam',
);
assert.equal(
  pickSpeakVoice(
    [
      { lang: 'sv-SE', name: 'Alva', localService: true, default: true },
      { lang: 'en-GB', name: 'Daniel', localService: true },
    ],
    'en-US',
  )?.name,
  'Daniel',
);
assert.equal(pickSpeakVoice([{ lang: 'sv-SE', name: 'Alva', localService: true, default: true }], 'en-US'), null);
assert.equal(pickSpeakVoice([{ lang: 'sv-SE', name: 'Alva', localService: true, default: true }], 'sv-SE')?.name, 'Alva');
assert.equal(
  pickSpeakVoice(
    [
      { lang: 'en-US', name: 'Sam', localService: true },
      { lang: 'en-GB', name: 'Daniel', localService: true },
    ],
    'en-GB',
  )?.name,
  'Daniel',
);

const gloss = sample({
  rule: 'oversattning',
  prompt: 'Vad betyder det här ordet?',
  speakText: 'dog',
  speakLang: 'en-US',
  speakPrompt: true,
  answer: 'hund',
  grade: 'forskola',
});
const glossParts = questionUtterances(gloss);
assert.deepEqual(glossParts, [
  { text: 'Vad betyder det här ordet?', lang: 'sv-SE' },
  { text: 'dog', lang: 'en-US' },
]);
assert.equal(questionUtterance(gloss).lang, 'sv-SE');
assert.equal(questionUtterance(gloss).text, gloss.prompt);
assert.equal(
  glossParts.some((part) => part.text === 'hund'),
  false,
);

const quoted = questionUtterances(
  sample({
    rule: 'oversattning',
    prompt: "Vad betyder 'dog'?",
    answer: 'hund',
  }),
);
assert.deepEqual(quoted, [
  { text: 'Vad betyder', lang: 'sv-SE' },
  { text: 'dog', lang: 'en-US' },
]);

const curly = questionUtterances(
  sample({
    rule: 'oversattning',
    prompt: 'Vad betyder \u201cdog\u201d i meningen?',
    answer: 'hund',
  }),
);
assert.equal(curly[0]?.lang, 'sv-SE');
assert.match(curly[0]?.text ?? '', /Vad betyder/);
assert.equal(curly[1]?.text, 'dog');
assert.equal(curly[1]?.lang, 'en-US');
assert.match(curly.at(-1)?.text ?? '', /meningen/);

const hiddenAnswer = questionUtterances(
  sample({
    rule: 'glosa',
    prompt: "Vad heter röd? 'red'",
    answer: 'red',
  }),
);
assert.deepEqual(hiddenAnswer, [{ text: 'Vad heter röd', lang: 'sv-SE' }]);

const glosaHand = questionUtterances(
  sample({
    rule: 'glosa',
    prompt: 'Vad heter röd på engelska?',
    answer: 'red',
    choices: ['red', 'blue', 'green', 'yellow'],
  }),
);
assert.deepEqual(glosaHand, [{ text: 'Vad heter röd på engelska?', lang: 'sv-SE' }]);

const spelling = sample({
  rule: 'stavning',
  prompt: 'Vilket engelskt ord är rätt stavat?',
  answer: 'cat',
  speakText: 'cat',
  speakLang: 'en-US',
});
assert.deepEqual(questionUtterances(spelling), [{ text: spelling.prompt, lang: 'sv-SE' }]);
const swedishSpelling = sample({
  subject: 'svenska',
  rule: 'rattstavning',
  prompt: 'Vilket ord är rätt stavat?',
  answer: 'hund',
  speakText: 'hund',
});
assert.deepEqual(questionUtterances(swedishSpelling), [{ text: swedishSpelling.prompt, lang: 'sv-SE' }]);

const ordklass = questionUtterances(
  sample({
    subject: 'svenska',
    rule: 'ord',
    prompt: 'Vilken ordklass är ordet «springer»?',
    answer: 'verb',
  }),
);
assert.deepEqual(ordklass, [{ text: 'Vilken ordklass är ordet «springer»?', lang: 'sv-SE' }]);

const listenEn = sample({
  subject: 'horforstaelse',
  rule: 'varfor',
  grade: 'ak7_9',
  prompt: 'Why do they record at the same time?',
  passage: 'They record at the same time.',
  speakText: 'They record at the same time. Why do they record at the same time?',
  speakLang: 'en-US',
  speakPrompt: false,
  answer: 'Clouds',
});
assert.deepEqual(questionUtterances(listenEn), [{ text: listenEn.speakText, lang: 'en-US' }]);
const listenGb = questionUtterances({ ...listenEn, speakLang: 'en-GB' });
assert.equal(listenGb.length, 1);
assert.equal(listenGb[0]?.lang, 'en-GB');
assert.equal(listenGb[0]?.text, listenEn.speakText);

const listenSv = questionUtterances(
  sample({
    subject: 'horforstaelse',
    rule: 'vem',
    prompt: 'Vem läser?',
    passage: 'Noor läser av termometern.',
    speakText: 'Noor läser av termometern. Vem läser?',
    speakLang: 'sv-SE',
    speakPrompt: false,
    answer: 'Noor',
  }),
);
assert.deepEqual(listenSv, [{ text: 'Noor läser av termometern. Vem läser?', lang: 'sv-SE' }]);

assert.deepEqual(
  questionUtterances(
    sample({
      subject: 'matte',
      grade: 'forskola',
      rule: 'forskola-plus',
      prompt: '2 + 3 = ?',
      speakText: 'två plus tre',
      speakLang: 'sv-SE',
      answer: '5',
    }),
  ),
  [{ text: 'två plus tre', lang: 'sv-SE' }],
);

const pre = generateQuestions({ count: 1, grade: 'forskola', subject: 'engelska', seed: 1, idPrefix: 'pre' })[0];
assert.ok(pre);
assert.equal(pre.rule, 'oversattning');
assert.equal(pre.speakPrompt, true);
const preParts = questionUtterances(pre);
assert.equal(preParts.length, 2);
assert.equal(preParts[0]?.text, pre.prompt);
assert.equal(preParts[0]?.lang, 'sv-SE');
assert.equal(preParts[1]?.text, pre.speakText);
assert.equal(preParts[1]?.lang, 'en-US');

const ak1n = bankCount('engelska', 'ak1');
const ak1 = generateQuestions({ count: ak1n, grade: 'ak1', subject: 'engelska', seed: 3, idPrefix: 'en' });
const glosa = ak1.find((q) => q.rule === 'glosa');
const stav = ak1.find((q) => q.rule === 'stavning');
assert.ok(glosa);
assert.ok(stav);
const glosaParts = questionUtterances(glosa);
assert.equal(glosaParts.length, 1);
assert.equal(glosaParts[0]?.text, glosa.prompt);
assert.equal(glosaParts[0]?.lang, 'sv-SE');
assert.equal(
  glosaParts.some((part) => part.text === glosa.answer),
  false,
);
const stavParts = questionUtterances(stav);
assert.deepEqual(stavParts, [{ text: stav.prompt, lang: 'sv-SE' }]);
assert.notEqual(stavParts[0]?.text, stav.answer);

const horN = bankCount('horforstaelse', 'ak7_9');
const horQs = generateQuestions({ count: horN, grade: 'ak7_9', subject: 'horforstaelse', seed: 1, idPrefix: 'hf' });
const bugQ = horQs.find((q) => q.id.includes('hf-en-ak7_9-002'));
const horSv = horQs.find((q) => q.speakLang === 'sv-SE');
assert.ok(bugQ?.speakText);
assert.ok(horSv?.speakText);
assert.match(bugQ.speakText, /Why do they record at the same time\?/);
assert.ok(bugQ.speakText.length > 200);
assert.deepEqual(questionUtterances(bugQ), [{ text: bugQ.speakText, lang: 'en-US' }]);
assert.deepEqual(questionUtterances(horSv), [{ text: horSv.speakText, lang: 'sv-SE' }]);

function installDom(): void {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  const g = globalThis as unknown as Record<string, unknown>;
  const win = dom.window as unknown as Record<string, unknown>;
  for (const k of ['window', 'document', 'HTMLElement', 'HTMLButtonElement', 'Node', 'Event']) g[k] = win[k];
}

installDom();

interface FakeVoice {
  lang: string;
  name: string;
  localService?: boolean;
  default?: boolean;
}

class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  voice: FakeVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((ev: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

interface Said {
  text: string;
  lang: string;
  voice: string;
}

const said: Said[] = [];
const made: FakeUtterance[] = [];
let voices: FakeVoice[] = [
  { lang: 'sv-SE', name: 'Alva', localService: true, default: true },
  { lang: 'en-US', name: 'Sam', localService: true, default: false },
];
let cancels = 0;
let setPendingOnSpeak = false;

const synth = {
  speaking: false,
  pending: false,
  paused: false,
  onvoiceschanged: null as ((this: typeof synth, ev: Event) => void) | null,
  speak(u: FakeUtterance) {
    made.push(u);
    said.push({ text: u.text, lang: u.lang, voice: u.voice?.name ?? '' });
    if (setPendingOnSpeak) synth.pending = true;
  },
  cancel() {
    cancels += 1;
    synth.speaking = false;
    synth.pending = false;
  },
  pause() {},
  resume() {},
  getVoices() {
    return voices;
  },
  addEventListener() {},
  removeEventListener() {},
};

const w = window as unknown as Record<string, unknown>;
w.speechSynthesis = synth;
w.SpeechSynthesisUtterance = FakeUtterance;
assert.equal(canSpeak(), true);

function fireVoices(): void {
  synth.onvoiceschanged?.call(synth, new Event('voiceschanged'));
}

/** Spelar färdigt sista yttret, och de som onend sedan startar. */
function drain(): void {
  const done = new Set<FakeUtterance>();
  let guard = 0;
  while (guard < 40) {
    guard += 1;
    const last = made[made.length - 1];
    if (!last || done.has(last)) break;
    done.add(last);
    const before = said.length;
    last.onend?.();
    if (said.length === before) break;
  }
}

function resetSpeech(): void {
  cancel();
  said.length = 0;
  made.length = 0;
  synth.speaking = false;
  synth.pending = false;
  setPendingOnSpeak = false;
}

resetSpeech();
const duoCancels = cancels;
speakSequence(preParts);
assert.equal(said.length, 1, 'engelska ordet ska inte köas i samma speak som svenskan');
assert.equal(said[0]?.lang, 'sv-SE');
assert.equal(said[0]?.voice, 'Alva');
assert.equal(said[0]?.text, pre.prompt);
assert.ok((said[0]?.text ?? '').trim().length > 0);
assert.equal(cancels, duoCancels, 'segmenten ska inte avbryta varandra');
made[0]?.onend?.();
assert.equal(said.length, 2, 'engelska ordet startar i onend');
assert.equal(said[1]?.lang, 'en-US');
assert.equal(said[1]?.voice, 'Sam');
assert.equal(said[1]?.text, pre.speakText);
assert.ok((said[1]?.text ?? '').trim().length > 0);
assert.notEqual(said[1]?.voice, 'Alva');
assert.equal(cancels, duoCancels, 'nästa segment ska inte avbryta det förra');

resetSpeech();
speakSequence(questionUtterances(spelling));
assert.equal(said.length, 1);
assert.equal(said[0]?.text, spelling.prompt);
assert.equal(said[0]?.lang, 'sv-SE');
assert.notEqual(said[0]?.text, 'cat');
assert.equal(
  said.some((row) => row.text === 'cat'),
  false,
);

resetSpeech();
voices = [{ lang: 'sv-SE', name: 'Alva', localService: true, default: true }];
speak('Why do they record at the same time?', 'en-US');
assert.equal(said.length, 1);
assert.equal(said[0]?.lang, 'en-US');
assert.equal(said[0]?.voice, '');
assert.notEqual(said[0]?.voice, 'Alva');
assert.equal(made[0]?.voice, null);
assert.ok((said[0]?.text ?? '').trim().length > 0);

resetSpeech();
voices = [
  { lang: 'sv-SE', name: 'Alva', localService: true, default: true },
  { lang: 'en-US', name: 'Sam', localService: true },
];
speak('Colour', 'en-GB');
assert.equal(said[0]?.lang, 'en-GB');
assert.equal(said[0]?.voice, 'Sam');

const bugText = bugQ.speakText;
resetSpeech();
voices = [];
speak(bugText, 'en-US');
assert.equal(said.length, 1);
assert.equal(said[0]?.lang, 'en-US');
assert.equal(said[0]?.voice, '');
assert.ok((said[0]?.text ?? '').length > 0);
assert.ok((said[0]?.text.length ?? 0) <= 140, 'lång engelsk text delas innan Chrome klipper den');
assert.ok(bugText.startsWith(said[0]?.text ?? ''));
const dropped = made[0];
assert.ok(dropped);
assert.equal(dropped.lang, 'en-US');
assert.equal(dropped.voice, null);
const cancelsAtLate = cancels;
voices = [{ lang: 'en-US', name: 'Sam', localService: true, default: false }];
fireVoices();
assert.equal(cancels, cancelsAtLate, 'voiceschanged får inte avbryta');
assert.equal(dropped.voice, null, 'voice efter speak tystar Chrome');
assert.ok(said.some((row) => row.voice === 'Sam' && row.lang === 'en-US' && row.text === dropped.text));
drain();
const withSam = said.filter((row) => row.voice === 'Sam');
assert.equal(withSam.map((row) => row.text).join(' '), bugText);
assert.ok(withSam.every((row) => row.lang === 'en-US' && row.voice !== 'Alva'));
assert.ok(withSam.every((row) => row.text.length <= 140));

resetSpeech();
voices = [];
setPendingOnSpeak = true;
speak(bugText, 'en-US');
assert.equal(synth.pending, true);
assert.equal(said.length, 1);
assert.equal(said[0]?.lang, 'en-US');
const queued = made[0];
assert.ok(queued);
voices = [{ lang: 'en-US', name: 'Sam', localService: true }];
const cancelsWhileQueued = cancels;
fireVoices();
assert.equal(cancels, cancelsWhileQueued, 'en köad uppläsning ska inte nollas');
assert.equal(queued.voice, null);
assert.equal(made.length, 1);
assert.equal(queued.lang, 'en-US');
assert.ok(queued.text.length > 0);
setPendingOnSpeak = false;
synth.pending = false;
said.length = 0;
made.length = 0;
speak(bugText, 'en-US');
assert.equal(said[0]?.lang, 'en-US');
assert.equal(said[0]?.voice, 'Sam');
assert.ok(bugText.startsWith(said[0]?.text ?? ''));
assert.ok((said[0]?.text ?? '').trim().length > 0);
drain();
assert.equal(said.map((row) => row.text).join(' '), bugText);
assert.ok(said.every((row) => row.lang === 'en-US' && row.voice === 'Sam'));

resetSpeech();
voices = [{ lang: 'sv-SE', name: 'Alva', localService: true, default: true }];
const overlay = new LearnOverlay({ grade: 'ak7_9', subject: 'horforstaelse', readAloud: false });
try {
  overlay.showQuestion(bugQ, 0, 3);
  assert.equal(said.length, 0, 'Lyssna läser inte förrän man trycker');
  const listen = overlay.root.querySelector('.rk-q-listen');
  const speaker = overlay.root.querySelector('.rk-q-speak');
  assert.ok(listen instanceof HTMLButtonElement);
  assert.ok(speaker instanceof HTMLButtonElement);
  assert.equal(speaker.hidden, true);
  assert.equal(listen.hidden, false);
  assert.equal(listen.disabled, false);
  assert.equal(listen.textContent, 'Lyssna');
  const quietCancels = cancels;
  listen.click();
  assert.equal(listen.textContent, 'Lyssna igen');
  assert.equal(cancels, quietCancels, 'Lyssna ska inte avbryta när motorn är ledig');
  assert.ok(said.length >= 1);
  assert.equal(said[0]?.lang, 'en-US');
  assert.equal(said[0]?.voice, '');
  assert.notEqual(said[0]?.voice, 'Alva');
  assert.ok((said[0]?.text ?? '').trim().length > 0);
  assert.ok(bugText.startsWith(said[0]?.text ?? ''));
  drain();
  assert.equal(said.map((row) => row.text).join(' '), bugText);
  assert.ok(said.every((row) => row.lang === 'en-US' && row.voice === '' && row.voice !== 'Alva'));

  said.length = 0;
  made.length = 0;
  voices = [];
  overlay.showQuestion(bugQ, 0, 3);
  assert.equal(said.length, 0);
  assert.equal(listen.textContent, 'Lyssna');
  const lateCancels = cancels;
  listen.click();
  assert.equal(listen.textContent, 'Lyssna igen');
  assert.equal(cancels, lateCancels);
  assert.equal(said[0]?.lang, 'en-US');
  assert.ok(bugText.startsWith(said[0]?.text ?? ''));
  assert.ok((said[0]?.text ?? '').trim().length > 0);
  const first = made[0];
  assert.ok(first);
  assert.equal(first.voice, null);
  voices = [{ lang: 'en-US', name: 'Sam', localService: true }];
  fireVoices();
  assert.equal(cancels, lateCancels, 'sen röst får inte tysta Lyssna');
  assert.equal(first.voice, null);
  assert.ok(said.some((row) => row.lang === 'en-US' && row.voice === 'Sam' && row.text.length > 0 && bugText.startsWith(row.text)));
  const beforeAgain = said.length;
  listen.click();
  assert.ok(said.length > beforeAgain, 'Lyssna igen ska tala igen');
  assert.ok(bugText.startsWith(said.at(-1)?.text ?? ''));
  assert.equal(said.at(-1)?.lang, 'en-US');
  assert.equal(said.at(-1)?.voice, 'Sam');
  assert.equal(listen.textContent, 'Lyssna igen');
  assert.equal(cancels, lateCancels);
  drain();
  const again = said.slice(beforeAgain).filter((row) => row.voice === 'Sam');
  assert.equal(again.map((row) => row.text).join(' '), bugText);

  const choice = overlay.root.querySelector('.rk-q-choices button');
  assert.ok(choice instanceof HTMLButtonElement);
  const beforeChoice = said.length;
  choice.click();
  assert.equal(said.length, beforeChoice, 'val ska vara tyst');
  const beforeWrong = said.length;
  const cancelsAtWrong = cancels;
  overlay.showWrong(bugQ, (bugQ.correctIndex + 1) % 4);
  assert.equal(said.length, beforeWrong, 'fel svar ska vara tyst');
  assert.equal(cancels, cancelsAtWrong, 'quizzen är kvar, talet ska inte nollas');

  synth.speaking = true;
  const beforeBusy = said.length;
  const cancelsBusy = cancels;
  listen.click();
  assert.equal(cancels, cancelsBusy + 1, 'pågående tal byts vid Lyssna igen');
  assert.ok(said.length > beforeBusy);
  assert.ok(bugText.startsWith(said.at(-1)?.text ?? ''));
  assert.equal(said.at(-1)?.lang, 'en-US');
  assert.ok((said.at(-1)?.text ?? '').trim().length > 0);
  synth.speaking = false;
} finally {
  overlay.dispose();
}

resetSpeech();
voices = [{ lang: 'sv-SE', name: 'Alva', localService: true, default: true }];
speakSequence([
  { text: 'Vad betyder det här ordet?', lang: 'sv-SE' },
  { text: 'dog', lang: 'en-US' },
]);
assert.equal(said.length, 1);
assert.equal(said[0]?.lang, 'sv-SE');
assert.equal(said[0]?.voice, 'Alva');
made[0]?.onstart?.();
synth.speaking = true;
voices = [
  { lang: 'sv-SE', name: 'Alva', localService: true, default: true },
  { lang: 'en-US', name: 'Sam', localService: true },
];
const duringSv = cancels;
fireVoices();
assert.equal(cancels, duringSv, 'påbörjad svensk del ska inte nollas');
assert.equal(said.length, 1, 'engelska ordet väntar tills svenskan är klar');
assert.equal(made[0]?.voice?.name, 'Alva');
synth.speaking = false;
made[0]?.onend?.();
assert.equal(said[1]?.text, 'dog');
assert.equal(said[1]?.lang, 'en-US');
assert.equal(said[1]?.voice, 'Sam');
assert.notEqual(said[1]?.voice, 'Alva');

resetSpeech();
voices = [{ lang: 'sv-SE', name: 'Alva', localService: true, default: true }];
speakSequence([
  { text: 'Vad betyder det här ordet?', lang: 'sv-SE' },
  { text: 'dog', lang: 'en-US' },
]);
made[0]?.onend?.();
assert.equal(said[1]?.text, 'dog');
assert.equal(said[1]?.lang, 'en-US');
assert.equal(said[1]?.voice, '');
const english = made[1];
assert.ok(english);
assert.equal(english.voice, null);
voices = [
  { lang: 'sv-SE', name: 'Alva', localService: true, default: true },
  { lang: 'en-US', name: 'Sam', localService: true },
];
const afterSv = cancels;
fireVoices();
assert.equal(cancels, afterSv);
assert.equal(english.voice, null, 'voice skrivs inte på yttret som redan speak:ats');
assert.equal(said.at(-1)?.text, 'dog');
assert.equal(said.at(-1)?.lang, 'en-US');
assert.equal(said.at(-1)?.voice, 'Sam');
assert.notEqual(said.at(-1)?.voice, 'Alva');

resetSpeech();
voices = [{ lang: 'sv-SE', name: 'Alva', localService: true, default: true }];
speak('dog', 'en-US');
assert.equal(said.length, 1);
assert.equal(said[0]?.lang, 'en-US');
assert.equal(said[0]?.voice, '');
assert.equal(made[0]?.voice, null);
const unavailableCancels = cancels;
made[0]?.onerror?.({ error: 'language-unavailable' });
assert.equal(cancels, unavailableCancels, 'omförsök ska inte cancel:a bort talet');
assert.equal(said.length, 2);
assert.equal(said[1]?.text, 'dog');
assert.equal(said[1]?.lang, 'en-US');
assert.equal(said[1]?.voice, '');
assert.equal(made[1]?.voice, null);
assert.notEqual(said[1]?.voice, 'Alva');
made[1]?.onerror?.({ error: 'synthesis-failed' });
assert.equal(said.length, 2, 'bara ett omförsök per segment');
assert.equal(cancels, unavailableCancels);

resetSpeech();
voices = [];
speak('park', 'en-US');
made[0]?.onstart?.();
synth.speaking = true;
voices = [
  { lang: 'sv-SE', name: 'Alva', localService: true, default: true },
  { lang: 'en-US', name: 'Sam', localService: true },
];
const startedCancels = cancels;
fireVoices();
assert.equal(cancels, startedCancels);
assert.equal(made.length, 1, 'påbörjat yttre byts inte ut');
assert.equal(made[0]?.voice, null);
synth.speaking = false;
made[0]?.onerror?.({ error: 'synthesis-failed' });
assert.equal(said.length, 2);
assert.equal(said[1]?.text, 'park');
assert.equal(said[1]?.lang, 'en-US');
assert.equal(said[1]?.voice, 'Sam');
assert.notEqual(said[1]?.voice, 'Alva');
assert.equal(made[0]?.voice, null);

resetSpeech();
voices = [{ lang: 'sv-SE', name: 'Alva', localService: true, default: true }];
speak('colour', 'en-GB');
made[0]?.onerror?.({ error: 'voice-unavailable' });
assert.equal(said[1]?.text, 'colour');
assert.equal(said[1]?.lang, 'en-GB');
assert.equal(said[1]?.voice, '');
assert.equal(made[1]?.voice, null);

resetVoiceManifestForTests();
console.log('learn speech ok');
