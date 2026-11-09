/**
 * Förskola: enkel matte, stavning, engelsk→svenska och uppläsning.
 * Kör: npx tsx tests/learn-forskola.test.mts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import engelska from '../src/data/fragor_engelska.json';
import svenska from '../src/data/fragor_svenska.json';
import { MemoryStore } from '../src/core/storage';
import { bankCount, ensureBank } from '../src/learn/bank';
import { generateQuestions } from '../src/learn/questions';
import { parseLearnSettings, readLearnSettings, writeLearnSettings } from '../src/learn/settings';
import { answerSpeech, canSpeak, choiceSpeech, pickSpeakVoice, questionUtterance, speak } from '../src/learn/speech';
import { isValidQuestion, type LearnQuestion } from '../src/learn/types';
import { LearnOverlay } from '../src/ui/LearnOverlay';
import { buildLearnFields } from '../src/ui/learnDom';

await ensureBank('svenska');
await ensureBank('engelska');

const EMOJI = /(?:\p{Extended_Pictographic}\uFE0F?|\p{Emoji_Presentation}|[0-9#*]\uFE0F?\u20E3)/u;

interface BankRow {
  id: string;
  niva: string;
  typ: string;
  fraga: string;
  ratt: string;
  eng?: string;
  emoji?: string;
  fel: unknown;
}

const svRows = (svenska as { fragor: BankRow[] }).fragor.filter((r) => r.niva === 'forskola');
const svIds = new Set(svRows.map((r) => r.id));
assert.equal(svIds.size, svRows.length, 'svenska förskola ska ha unika id');
assert.ok(svRows.length >= 40, `svenska förskola ${svRows.length}`);
assert.ok(bankCount('svenska', 'forskola') >= 40);
const stavning = svRows.filter((r) => r.typ === 'rattstavning');
assert.ok(stavning.length >= 40, `rättstavning ${stavning.length}`);
for (const row of svRows) assert.match(row.id, /^sv-forskola-\d{3}$/);
for (const row of stavning) assert.equal(row.fraga, 'Vilket ord är rätt stavat?');

const enRows = (engelska as { fragor: BankRow[] }).fragor.filter((r) => r.niva === 'forskola');
assert.ok(enRows.length >= 40, `engelska förskola ${enRows.length}`);
assert.equal(bankCount('engelska', 'forskola'), enRows.length, 'alla engelska förskolerader ska gå att läsa');
for (const row of enRows) {
  assert.match(row.id, /^en-forskola-\d{3}$/);
  assert.equal(row.typ, 'oversattning');
  assert.equal(typeof row.eng, 'string');
  assert.match(row.eng ?? '', /^[a-z]+$/);
  assert.match(row.ratt, /^[a-zåäö]+$/i);
  assert.equal(typeof row.emoji, 'string');
  assert.match(row.emoji ?? '', EMOJI);
}

const math = generateQuestions({ count: 40, grade: 'forskola', subject: 'matte', seed: 20261109, idPrefix: 'fm' });
const rules = new Set<string>();
for (const q of math) {
  assert.equal(isValidQuestion(q), true, q.id);
  assert.ok(q.rule === 'forskola-plus' || q.rule === 'forskola-minus', q.rule);
  rules.add(q.rule);
  const a = q.meta?.a;
  const b = q.meta?.b;
  const res = q.meta?.result;
  assert.ok(a !== undefined && b !== undefined && res !== undefined);
  assert.ok(a >= 0 && a <= 9 && b >= 0 && b <= 9, `${a} ${b}`);
  assert.ok(res >= 0);
  if (q.rule === 'forskola-plus') {
    assert.ok(a + b <= 10);
    assert.equal(res, a + b);
  } else {
    assert.ok(b <= a);
    assert.equal(res, a - b);
  }
  assert.equal(new Set(q.choices).size, 4);
  assert.equal(q.choices.filter((c) => c === q.answer).length, 1);
  for (const c of q.choices) {
    const n = Number(c);
    assert.equal(Number.isInteger(n), true, c);
    assert.ok(n >= 0 && n <= 10, c);
  }
  assert.equal(q.speakLang, 'sv-SE');
}
assert.equal(rules.size, 2, 'både plus och minus ska förekomma');

const enQs = generateQuestions({
  count: bankCount('engelska', 'forskola'),
  grade: 'forskola',
  subject: 'engelska',
  seed: 3,
  idPrefix: 'en',
});
const seen = new Set<string>();
for (const q of enQs) {
  assert.equal(isValidQuestion(q), true, q.id);
  assert.equal(q.subject, 'engelska');
  assert.equal(q.speakLang, 'en-US');
  assert.match(q.speakText ?? '', /^[a-z]+$/);
  assert.match(q.answer, /^[a-zåäö]+$/i);
  seen.add(`${q.answer}|${q.speakText}`);
  const shown = q.choices[q.correctIndex] ?? '';
  assert.ok(shown.endsWith(` ${q.answer}`), shown);
  for (const c of q.choices) {
    assert.match(c, EMOJI, c);
    assert.match(c, / [a-zåäö]+$/i, c);
  }
}
assert.equal(seen.size, enQs.length, 'varje glosa ska komma med');

const oldEn = generateQuestions({ count: 4, grade: 'ak1', subject: 'engelska', seed: 4, idPrefix: 'old' });
for (const q of oldEn) {
  assert.equal(isValidQuestion(q), true, q.id);
  assert.equal(q.choices[q.correctIndex], q.answer);
  assert.equal(q.speakText, undefined);
  assert.equal(q.choiceEmojis, undefined);
}

assert.equal(parseLearnSettings({ grade: 'forskola', subject: 'svenska' })?.readAloud, true);
assert.equal(parseLearnSettings({ grade: 'ak1', subject: 'matte' })?.readAloud, false);
assert.equal(parseLearnSettings({ grade: 'forskola', subject: 'matte', readAloud: false })?.readAloud, false);
const store = new MemoryStore();
writeLearnSettings(store, { grade: 'forskola', subject: 'svenska' });
assert.equal(readLearnSettings(store).readAloud, true);
writeLearnSettings(store, { grade: 'ak3', subject: 'matte', readAloud: true });
assert.equal(readLearnSettings(store).readAloud, true);
writeLearnSettings(store, { grade: 'forskola', subject: 'matte', readAloud: false });
assert.deepEqual(readLearnSettings(store), { grade: 'forskola', subject: 'matte', readAloud: false });

function installDom(): void {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  const g = globalThis as unknown as Record<string, unknown>;
  const win = dom.window as unknown as Record<string, unknown>;
  for (const k of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'Node', 'Event', 'PointerEvent']) {
    g[k] = win[k];
  }
}

installDom();

let saved: LearnSettingsSnap | null = null;
interface LearnSettingsSnap {
  grade: string;
  readAloud?: boolean;
}
const fields = buildLearnFields({ grade: 'ak1', subject: 'matte', readAloud: false }, (s) => {
  saved = s;
});
assert.match(fields.textContent ?? '', /Läs upp frågor/);
const box = fields.querySelector('input[type="checkbox"]');
assert.ok(box instanceof HTMLInputElement);
assert.equal(box.checked, false);
const gradeSel = fields.querySelector('select');
assert.ok(gradeSel);
gradeSel.value = 'forskola';
gradeSel.dispatchEvent(new Event('change'));
assert.equal(saved?.grade, 'forskola');
assert.equal(saved?.readAloud, true);
assert.equal(box.checked, true);

class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  voice: { name?: string } | null = null;
  constructor(text: string) {
    this.text = text;
  }
}
const spoken: { text: string; lang: string; voice: string }[] = [];
const fakeSynth = {
  speak(u: FakeUtterance) {
    spoken.push({ text: u.text, lang: u.lang, voice: u.voice?.name ?? '' });
  },
  cancel() {},
  pause() {},
  resume() {},
  getVoices() {
    return [
      { lang: 'sv-SE', name: 'Alva', localService: true, default: true },
      { lang: 'en-GB', name: 'Daniel', localService: true, default: false },
      { lang: 'en-US', name: 'Sam', localService: true, default: false },
    ];
  },
  speaking: false,
  pending: false,
  paused: false,
  onvoiceschanged: null,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return true;
  },
};
const w = window as unknown as Record<string, unknown>;
w.speechSynthesis = fakeSynth;
w.SpeechSynthesisUtterance = FakeUtterance;
assert.equal(canSpeak(), true);

function lastSpoken(): { text: string; lang: string; voice: string } {
  const row = spoken[spoken.length - 1];
  assert.ok(row, 'ingen uppläsning');
  return row;
}

assert.equal(pickSpeakVoice(fakeSynth.getVoices(), 'en-US')?.name, 'Sam');
assert.equal(pickSpeakVoice(fakeSynth.getVoices(), 'sv-SE')?.name, 'Alva');
assert.equal(pickSpeakVoice([{ lang: 'en-AU', name: 'Aussie', localService: true }], 'en-US')?.name, 'Aussie');
assert.equal(pickSpeakVoice([], 'en-US'), null);

const svQ = generateQuestions({ count: 12, grade: 'forskola', subject: 'svenska', seed: 11, idPrefix: 'sv' }).find(
  (q) => q.rule === 'rattstavning',
);
assert.ok(svQ, 'en rättstavning ska gå att dra');
const enQ = enQs[0];
assert.ok(enQ);
const mathQ = math[0];
assert.ok(mathQ);

assert.equal(questionUtterance(svQ).text, svQ.prompt);
assert.notEqual(questionUtterance(svQ).text, svQ.answer);
assert.equal(questionUtterance(svQ).lang, 'sv-SE');
assert.equal(choiceSpeech(svQ, svQ.correctIndex), null);
assert.equal(answerSpeech(svQ), null, 'rättstavning ska inte läsa svaret');
assert.notEqual(enQ.answer, enQ.speakText);
const enAnswer = answerSpeech(enQ);
assert.ok(enAnswer);
assert.equal(enAnswer.text, enQ.answer);
assert.equal(enAnswer.lang, 'sv-SE');
const mathAnswer = answerSpeech(mathQ);
assert.ok(mathAnswer);
assert.equal(mathAnswer.text, mathQ.answer);
assert.equal(mathAnswer.lang, 'sv-SE');
assert.equal(questionUtterance(enQ).text, enQ.speakText);
assert.equal(questionUtterance(enQ).lang, 'en-US');
const enSaid = choiceSpeech(enQ, 0);
assert.ok(enSaid);
assert.equal(enSaid.lang, 'sv-SE');
assert.equal(EMOJI.test(enSaid.text), false);
assert.equal(choiceSpeech(mathQ, 0)?.text, mathQ.choices[0]);

const forskola = new LearnOverlay({ grade: 'forskola', subject: 'svenska' });
let answered: number | null = null;
forskola.onAnswer = (i) => {
  answered = i;
};
try {
  spoken.length = 0;
  forskola.showQuestion(svQ, 0, 1);
  assert.equal(lastSpoken().lang, 'sv-SE');
  assert.equal(lastSpoken().text, svQ.prompt);
  assert.equal(lastSpoken().voice, 'Alva');
  assert.notEqual(lastSpoken().text, svQ.answer);
  assert.ok(forskola.root.querySelector('.rk-q-card')?.classList.contains('forskola'));
  const speaker = forskola.root.querySelector('.rk-q-speak');
  assert.ok(speaker instanceof HTMLButtonElement);
  assert.equal(speaker.getAttribute('aria-label'), 'Läs upp');
  assert.equal(speaker.hidden, false);
  const svara = forskola.root.querySelector('.rk-q-submit');
  assert.ok(svara instanceof HTMLButtonElement);
  assert.equal(svara.textContent, 'SVARA');
  assert.equal(svara.disabled, true);
  const before = spoken.length;
  speaker.click();
  assert.equal(spoken.length, before + 1);
  assert.equal(lastSpoken().lang, 'sv-SE');
  assert.equal(lastSpoken().text, svQ.prompt);
  assert.notEqual(lastSpoken().text, svQ.answer);

  const spellChoice = forskola.root.querySelector('.rk-q-choices button');
  assert.ok(spellChoice instanceof HTMLButtonElement);
  spoken.length = 0;
  const hover = new Event('pointerenter');
  Object.defineProperty(hover, 'pointerType', { value: 'mouse' });
  spellChoice.dispatchEvent(hover);
  spellChoice.dispatchEvent(new Event('pointerdown'));
  assert.equal(spoken.length, 0, 'hover och långtryck ska inte läsa');
  spellChoice.click();
  assert.equal(answered, null, 'klick väljer, det svarar inte');
  assert.equal(spoken.length, 0, 'rättstavning ska inte läsa alternativet');
  assert.equal(spellChoice.classList.contains('selected'), true);
  assert.equal(svara.disabled, false);
  svara.click();
  assert.equal(answered, 0);

  spoken.length = 0;
  answered = null;
  forskola.showQuestion(enQ, 0, 1);
  assert.equal(svara.disabled, true, 'ny fråga rensar valet');
  assert.equal(forskola.root.querySelector('.rk-q-choices button.selected'), null);
  assert.equal(lastSpoken().lang, 'en-US');
  assert.equal(lastSpoken().text, enQ.speakText);
  assert.equal(lastSpoken().voice, 'Sam');
  assert.equal(forskola.root.querySelector('.rk-q-eng')?.textContent, enQ.speakText);
  const choice = forskola.root.querySelector('.rk-q-choices button');
  assert.ok(choice instanceof HTMLButtonElement);
  spoken.length = 0;
  choice.dispatchEvent(hover);
  assert.equal(spoken.length, 0, 'hover ska inte läsa valet');
  choice.click();
  assert.equal(answered, null);
  assert.equal(choice.classList.contains('selected'), true);
  assert.equal(lastSpoken().lang, 'sv-SE');
  assert.equal(EMOJI.test(lastSpoken().text), false);
  assert.equal(svara.disabled, false);
  svara.click();
  assert.equal(answered, 0);
  assert.equal(svara.disabled, true);

  spoken.length = 0;
  forskola.setSettings({ grade: 'forskola', subject: 'matte', readAloud: true });
  forskola.showQuestion(mathQ, 0, 1);
  assert.equal(lastSpoken().lang, 'sv-SE');
  assert.equal(lastSpoken().text, mathQ.speakText);
  assert.equal(svara.disabled, true);
  const mathChoice = forskola.root.querySelectorAll('.rk-q-choices button')[1];
  assert.ok(mathChoice instanceof HTMLButtonElement);
  spoken.length = 0;
  mathChoice.click();
  assert.equal(lastSpoken().text, mathQ.choices[1]);
  spoken.length = 0;
  forskola.showWrong(mathQ, 1);
  assert.equal(svara.disabled, true);
  assert.equal(forskola.root.querySelector('.rk-q-feedback')?.textContent, `Rätt svar var: ${mathQ.answer}`);
  assert.equal(forskola.root.querySelector('.rk-q-choices')?.classList.contains('hidden'), false, 'valen ska synas');
  const mathButtons = [...forskola.root.querySelectorAll('.rk-q-choices button')];
  assert.equal(mathButtons[mathQ.correctIndex]?.classList.contains('correct'), true);
  if (mathQ.correctIndex !== 1) assert.equal(mathButtons[1]?.classList.contains('wrong'), true);
  assert.equal(lastSpoken().text, mathQ.answer);
  assert.equal(lastSpoken().lang, 'sv-SE');
  assert.match(document.head.textContent ?? '', /\.rk-q-choices button\.correct/);

  spoken.length = 0;
  forskola.showQuestion(svQ, 0, 1);
  spoken.length = 0;
  const spellWrong = svQ.correctIndex === 0 ? 1 : 0;
  forskola.showWrong(svQ, spellWrong);
  assert.equal(spoken.length, 0, 'rättstavning ska inte läsa det rätta ordet');
  const spellButtons = [...forskola.root.querySelectorAll('.rk-q-choices button')];
  assert.equal(spellButtons[svQ.correctIndex]?.classList.contains('correct'), true);
  assert.equal(spellButtons[spellWrong]?.classList.contains('wrong'), true);
  assert.equal(forskola.root.querySelector('.rk-q-choices')?.classList.contains('hidden'), false);
  assert.equal(forskola.root.querySelector('.rk-q-feedback')?.textContent, `Rätt svar var: ${svQ.answer}`);

  spoken.length = 0;
  forskola.showQuestion(enQ, 0, 1);
  spoken.length = 0;
  forskola.showWrong(enQ, enQ.correctIndex === 0 ? 1 : 0);
  assert.equal(lastSpoken().text, enQ.answer);
  assert.equal(lastSpoken().lang, 'sv-SE');
  assert.equal(EMOJI.test(lastSpoken().text), false);
} finally {
  forskola.dispose();
}

const quiet = new LearnOverlay({ grade: 'forskola', subject: 'engelska', readAloud: false });
try {
  spoken.length = 0;
  quiet.showQuestion(enQ, 0, 1);
  assert.equal(spoken.length, 0, 'avstängd uppläsning ska inte läsa själv');
  const speaker = quiet.root.querySelector('.rk-q-speak');
  assert.ok(speaker instanceof HTMLButtonElement);
  assert.equal(speaker.hidden, false, 'förskolan har alltid högtalarknappen');
  speaker.click();
  assert.equal(lastSpoken().lang, 'en-US');
  assert.equal(lastSpoken().text, enQ.speakText);
} finally {
  quiet.dispose();
}

const ak1q = generateQuestions({ count: 1, grade: 'ak1', subject: 'matte', seed: 1, idPrefix: 'ak' })[0] as LearnQuestion;
const ak1 = new LearnOverlay({ grade: 'ak1', subject: 'matte', readAloud: false });
try {
  spoken.length = 0;
  ak1.showQuestion(ak1q, 0, 1);
  assert.equal(spoken.length, 0);
  assert.equal(ak1.root.querySelector('.rk-q-card')?.classList.contains('forskola'), false);
  const speaker = ak1.root.querySelector('.rk-q-speak');
  assert.ok(speaker instanceof HTMLButtonElement);
  assert.equal(speaker.hidden, true);
  ak1.setSettings({ grade: 'ak1', subject: 'matte', readAloud: true });
  ak1.showQuestion(ak1q, 1, 2);
  assert.equal(lastSpoken().lang, 'sv-SE');
  assert.equal(lastSpoken().text, ak1q.prompt);
  assert.equal((ak1.root.querySelector('.rk-q-speak') as HTMLButtonElement).hidden, false);
} finally {
  ak1.dispose();
}

fakeSynth.speaking = true;
let cancelled = 0;
const prevCancel = fakeSynth.cancel.bind(fakeSynth);
fakeSynth.cancel = () => {
  cancelled += 1;
  fakeSynth.speaking = false;
  fakeSynth.pending = false;
};
spoken.length = 0;
speak('cat', 'en-US');
assert.equal(cancelled, 1, 'pågående tal avbryts');
assert.equal(spoken.length, 1, 'nytt tal ska ändå starta i samma klick');
assert.equal(lastSpoken().text, 'cat');
assert.equal(lastSpoken().lang, 'en-US');
assert.equal(lastSpoken().voice, 'Sam');
fakeSynth.cancel = prevCancel;
fakeSynth.speaking = false;
fakeSynth.pending = false;

const beforeQuiet = spoken.length;
delete w.speechSynthesis;
assert.equal(canSpeak(), false);
speak('hej', 'sv-SE');
assert.equal(spoken.length, beforeQuiet);

console.log('learn forskola ok', { sv: svRows.length, stavning: stavning.length, en: enRows.length });
