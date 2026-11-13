/**
 * Färdiga röstfiler: täckning, uppspelning och återgång till talsyntes.
 * Kör: npx tsx tests/learn-voice-clips.test.mts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ensureBank } from '../src/learn/bank';
import { canSpeak, cancel, questionUtterances, speakSequence } from '../src/learn/speech';
import type { LearnQuestion } from '../src/learn/types';
import { lookupVoiceClip, resetVoiceManifestForTests, setVoiceManifestForTests, voiceClipUrl } from '../src/learn/voiceClips';
import { collectBankSpeakParts, learnQuestionFromBankRow } from '../src/learn/voiceTexts';
import { LearnOverlay } from '../src/ui/LearnOverlay';

const hor = await ensureBank('horforstaelse');
await ensureBank('svenska');
await ensureBank('engelska');
await ensureBank('lasforstaelse');

assert.equal(hor.length, 192, 'hörförståelse ska ha 192 rader');
const englishRows = hor.filter((row) => row.sprak === 'en');
assert.equal(englishRows.length, 96, 'hälften av hörförståelsen är engelsk');

for (const row of hor) {
  const q = learnQuestionFromBankRow('horforstaelse', row);
  assert.ok(q, row.id);
  const parts = questionUtterances(q);
  assert.ok(parts.length > 0, row.id);
  for (const part of parts) {
    const clip = lookupVoiceClip(part.lang, part.text);
    assert.ok(clip, `${row.id} saknar fil för ${part.lang}`);
    if (row.sprak === 'en') assert.equal(clip.lang, 'en-US', row.id);
  }
}

const bankParts = await collectBankSpeakParts();
assert.ok(bankParts.length > 0);
for (const part of bankParts) {
  assert.ok(lookupVoiceClip(part.lang, part.text), `${part.lang} ${part.text.slice(0, 48)}`);
}

const listenRow = hor.find((row) => row.id === 'hf-en-ak7_9-002');
assert.ok(listenRow);
const listenQ = learnQuestionFromBankRow('horforstaelse', listenRow);
assert.ok(listenQ);
const spokenText = `${listenRow.text.trim()} ${listenRow.fraga.trim()}`.trim();
assert.equal(listenQ.speakText, spokenText);
assert.equal(listenQ.speakLang, 'en-US');
assert.equal(listenQ.speakPrompt, false);
assert.equal(listenQ.hidePassageUntilAnswered, true);
assert.ok(spokenText.length > 140, 'den långa engelska texten ska inte delas när filen finns');
assert.deepEqual(questionUtterances(listenQ), [{ text: spokenText, lang: 'en-US' }]);
const listenClip = lookupVoiceClip('en-US', spokenText);
assert.ok(listenClip);
assert.equal(listenClip.lang, 'en-US');

const enBank = await ensureBank('engelska');
let duo: LearnQuestion | null = null;
for (const row of enBank) {
  const q = learnQuestionFromBankRow('engelska', row);
  if (!q) continue;
  const parts = questionUtterances(q);
  const first = parts[0];
  const second = parts[1];
  if (!first || !second || parts.length !== 2) continue;
  if (first.lang !== 'sv-SE' || second.lang !== 'en-US') continue;
  if (!lookupVoiceClip(first.lang, first.text) || !lookupVoiceClip(second.lang, second.text)) continue;
  duo = q;
  break;
}
assert.ok(duo, 'en glosa med svensk prompt och engelskt ord ska finnas som filer');
const duoParts = questionUtterances(duo);
const shortText = 'Vilket ord är rätt stavat?';
const shortClip = lookupVoiceClip('sv-SE', shortText);
assert.ok(shortClip);
assert.ok(shortText.length <= 140);

function installDom(): void {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  const g = globalThis as unknown as Record<string, unknown>;
  const win = dom.window as unknown as Record<string, unknown>;
  for (const k of ['window', 'document', 'HTMLElement', 'HTMLButtonElement', 'Node', 'Event']) g[k] = win[k];
}

installDom();

type PlayMode = 'ok' | 'reject' | 'throw';
let playMode: PlayMode = 'ok';

class FakeAudio {
  src: string;
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(src?: string) {
    this.src = src ?? '';
    made.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    played.push(this);
    if (playMode === 'throw') throw new Error('play');
    if (playMode === 'reject') return Promise.reject(new Error('play'));
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
    paused.push(this);
  }
}

class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  voice: { name?: string } | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((ev: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
    utterances.push(this);
  }
}

const made: FakeAudio[] = [];
const played: FakeAudio[] = [];
const paused: FakeAudio[] = [];
const utterances: FakeUtterance[] = [];
const said: { text: string; lang: string }[] = [];
let cancels = 0;

const synth = {
  speaking: false,
  pending: false,
  paused: false,
  onvoiceschanged: null as ((this: typeof synth, ev: Event) => void) | null,
  speak(u: FakeUtterance) {
    said.push({ text: u.text, lang: u.lang });
  },
  cancel() {
    cancels += 1;
    synth.speaking = false;
    synth.pending = false;
  },
  pause() {},
  resume() {},
  getVoices() {
    return [
      { lang: 'sv-SE', name: 'Alva', localService: true, default: true },
      { lang: 'en-US', name: 'Sam', localService: true, default: false },
    ];
  },
  addEventListener() {},
  removeEventListener() {},
};

const w = window as unknown as Record<string, unknown>;
const g = globalThis as unknown as Record<string, unknown>;
w.Audio = FakeAudio;
g.Audio = FakeAudio;
w.speechSynthesis = synth;
w.SpeechSynthesisUtterance = FakeUtterance;

function resetPlay(): void {
  cancel();
  made.length = 0;
  played.length = 0;
  paused.length = 0;
  utterances.length = 0;
  said.length = 0;
  playMode = 'ok';
  synth.speaking = false;
  synth.pending = false;
}

function drainSpeech(): void {
  const done = new Set<FakeUtterance>();
  let guard = 0;
  while (guard < 40) {
    guard += 1;
    const last = utterances[utterances.length - 1];
    if (!last || done.has(last)) break;
    done.add(last);
    const before = said.length;
    last.onend?.();
    if (said.length === before) break;
  }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function endsWithClip(src: string, file: string): boolean {
  return src.endsWith(`/assets/voice/${file}`);
}

try {
  resetPlay();
  const beforeListen = cancels;
  speakSequence(questionUtterances(listenQ));
  assert.equal(cancels, beforeListen, 'ledig spelare ska inte avbryta talsyntesen');
  assert.equal(made.length, 1, 'hela stycket är en fil');
  assert.equal(played.length, 1, 'play ska anropas i samma klick');
  assert.equal(said.length, 0, 'filen ska inte gå via talsyntes');
  assert.equal(made[0]?.src, voiceClipUrl(listenClip.file));
  assert.equal(endsWithClip(made[0]?.src ?? '', listenClip.file), true);
  assert.equal(utterances.length, 0);

  resetPlay();
  const overlay = new LearnOverlay({ grade: listenQ.grade, subject: 'horforstaelse', readAloud: false });
  try {
    overlay.showQuestion(listenQ, 0, 1);
    assert.equal(made.length, 0, 'frågan läses inte upp av sig själv');
    assert.equal(said.length, 0);
    const passage = overlay.root.querySelector('.rk-q-passage');
    const listen = overlay.root.querySelector('.rk-q-listen');
    const speaker = overlay.root.querySelector('.rk-q-speak');
    assert.ok(passage instanceof HTMLElement);
    assert.ok(listen instanceof HTMLButtonElement);
    assert.ok(speaker instanceof HTMLButtonElement);
    assert.equal(passage.hidden, true);
    assert.equal(passage.textContent, '');
    assert.equal(listen.hidden, false);
    assert.equal(listen.textContent, 'Lyssna');
    assert.equal(speaker.hidden, true);
    assert.equal(canSpeak(), true);

    const quietCancels = cancels;
    listen.click();
    assert.equal(listen.textContent, 'Lyssna igen');
    assert.equal(cancels, quietCancels);
    assert.equal(made.length, 1);
    assert.equal(played.length, 1);
    assert.equal(said.length, 0);
    assert.equal(endsWithClip(made[0]?.src ?? '', listenClip.file), true);
    assert.equal(made[0]?.src, voiceClipUrl(listenClip.file));

    const first = made[0];
    assert.ok(first);
    listen.click();
    assert.equal(first.paused, true, 'Lyssna igen stoppar den förra filen');
    assert.equal(first.src, '');
    assert.equal(made.length, 2);
    assert.equal(played.length, 2);
    assert.equal(endsWithClip(made[1]?.src ?? '', listenClip.file), true);
    assert.equal(said.length, 0);

    const choice = overlay.root.querySelector('.rk-q-choices button');
    assert.ok(choice instanceof HTMLButtonElement);
    const beforeChoice = made.length;
    const beforeSaid = said.length;
    const beforePaused = paused.length;
    choice.dispatchEvent(new Event('pointerenter'));
    choice.click();
    overlay.showWrong(listenQ, (listenQ.correctIndex + 1) % 4);
    assert.equal(made.length, beforeChoice, 'val och fel svar startar inget ljud');
    assert.equal(said.length, beforeSaid, 'val och fel svar läses inte upp');
    assert.equal(paused.length, beforePaused, 'fel svar får inte stoppa ljudet');
    for (const part of questionUtterances(listenQ)) {
      assert.notEqual(part.text, listenQ.answer);
      assert.equal(
        listenQ.choices.some((alt) => alt === part.text),
        false,
      );
    }
  } finally {
    overlay.dispose();
  }

  resetPlay();
  speakSequence(questionUtterances(listenQ));
  const live = made[0];
  assert.ok(live);
  const ended = live.onended;
  assert.equal(typeof ended, 'function');
  cancel();
  assert.equal(live.paused, true);
  assert.ok(paused.includes(live));
  assert.equal(live.src, '');
  const afterCancel = made.length;
  ended?.();
  assert.equal(made.length, afterCancel, 'avbrutet ljud startar inte nästa del');
  assert.equal(said.length, 0);
  assert.equal(played.length, 1);

  resetPlay();
  const duoFirst = duoParts[0];
  const duoSecond = duoParts[1];
  assert.ok(duoFirst && duoSecond);
  const firstClip = lookupVoiceClip(duoFirst.lang, duoFirst.text);
  const secondClip = lookupVoiceClip(duoSecond.lang, duoSecond.text);
  assert.ok(firstClip && secondClip);
  speakSequence(duoParts);
  assert.equal(made.length, 1, 'bara första filen startar');
  assert.equal(played.length, 1);
  assert.equal(said.length, 0);
  assert.equal(endsWithClip(made[0]?.src ?? '', firstClip.file), true);
  made[0]?.onended?.();
  assert.equal(made.length, 2, 'nästa fil startar när den förra är klar');
  assert.equal(played.length, 2);
  assert.equal(endsWithClip(made[1]?.src ?? '', secondClip.file), true);
  assert.equal(said.length, 0);

  resetPlay();
  const missing = 'Den här meningen finns inte som ljudfil.';
  assert.equal(lookupVoiceClip('en-US', missing), null);
  speakSequence([duoFirst, { text: missing, lang: 'en-US' }]);
  assert.equal(made.length, 1);
  assert.equal(said.length, 0);
  made[0]?.onended?.();
  assert.equal(said.length, 1, 'saknad del faller tillbaka på talsyntes');
  assert.equal(said[0]?.text, missing);
  assert.equal(said[0]?.lang, 'en-US');
  assert.equal(made.length, 1);

  resetPlay();
  speakSequence([{ text: missing, lang: 'sv-SE' }]);
  assert.equal(made.length, 0);
  assert.equal(said.length, 1);
  assert.equal(said[0]?.text, missing);
  assert.equal(said[0]?.lang, 'sv-SE');

  resetPlay();
  playMode = 'throw';
  speakSequence([{ text: shortText, lang: 'sv-SE' }]);
  assert.equal(played.length, 1);
  assert.equal(said.length, 1, 'play som kastar ska läsas med talsyntes');
  assert.equal(said[0]?.text, shortText);
  assert.equal(said[0]?.lang, 'sv-SE');
  assert.equal(utterances.length, 1);

  resetPlay();
  playMode = 'reject';
  speakSequence([{ text: shortText, lang: 'sv-SE' }]);
  assert.equal(played.length, 1);
  assert.equal(said.length, 0, 'avslaget play ska inte hinna tala i samma varv');
  await tick();
  assert.equal(said.length, 1);
  assert.equal(said[0]?.text, shortText);
  assert.equal(said[0]?.lang, 'sv-SE');
  assert.ok(paused.includes(made[0] as FakeAudio));

  resetPlay();
  speakSequence([{ text: shortText, lang: 'sv-SE' }]);
  const broken = made[0];
  assert.ok(broken);
  const onerror = broken.onerror;
  assert.equal(typeof onerror, 'function');
  onerror?.();
  onerror?.();
  assert.equal(said.length, 1, 'onerror faller tillbaka en gång');
  assert.equal(said[0]?.text, shortText);
  assert.equal(said[0]?.lang, 'sv-SE');
  assert.equal(played.length, 1);

  resetPlay();
  setVoiceManifestForTests(null);
  try {
    assert.equal(lookupVoiceClip('en-US', spokenText), null);
    speakSequence(questionUtterances(listenQ));
    assert.equal(made.length, 0, 'utan manifest används ingen fil');
    assert.ok(said.length >= 1);
    assert.equal(said[0]?.lang, 'en-US');
    assert.ok((said[0]?.text.length ?? 0) <= 140);
    assert.ok(spokenText.startsWith(said[0]?.text ?? ''));
    drainSpeech();
    assert.equal(said.map((row) => row.text).join(' '), spokenText);
    assert.ok(said.every((row) => row.lang === 'en-US' && row.text.length <= 140));
  } finally {
    resetVoiceManifestForTests();
  }

  resetPlay();
  const savedSynth = w.speechSynthesis;
  const savedUtter = w.SpeechSynthesisUtterance;
  delete w.speechSynthesis;
  delete w.SpeechSynthesisUtterance;
  try {
    assert.equal(canSpeak(), true, 'Lyssna ska finnas när röstfiler finns');
    const quiet = new LearnOverlay({ grade: listenQ.grade, subject: 'horforstaelse', readAloud: false });
    try {
      quiet.showQuestion(listenQ, 0, 1);
      const listen = quiet.root.querySelector('.rk-q-listen');
      const note = quiet.root.querySelector('.rk-q-listen-note');
      const passage = quiet.root.querySelector('.rk-q-passage');
      assert.ok(listen instanceof HTMLButtonElement);
      assert.ok(note instanceof HTMLElement);
      assert.ok(passage instanceof HTMLElement);
      assert.equal(listen.hidden, false);
      assert.equal(listen.disabled, false);
      assert.equal(note.hidden, true);
      assert.equal(passage.hidden, true);
      listen.click();
      assert.equal(made.length, 1);
      assert.equal(played.length, 1);
      assert.equal(endsWithClip(made[0]?.src ?? '', listenClip.file), true);
      assert.equal(said.length, 0);
    } finally {
      quiet.dispose();
    }
  } finally {
    w.speechSynthesis = savedSynth;
    w.SpeechSynthesisUtterance = savedUtter;
  }

  resetPlay();
  setVoiceManifestForTests({ version: 1, format: 'mp3', voices: {}, clips: [] });
  delete w.speechSynthesis;
  try {
    assert.equal(canSpeak(), false);
  } finally {
    w.speechSynthesis = savedSynth;
    w.SpeechSynthesisUtterance = savedUtter;
    resetVoiceManifestForTests();
  }
} finally {
  resetVoiceManifestForTests();
}

console.log('learn voice clips ok');
