/**
 * Hörförståelse: bank, språk, dold text och Lyssna-knappen.
 * Kör: npx tsx tests/learn-horforstaelse.test.mts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { Monster } from '../src/entities/Monster';
import horforstaelse from '../src/data/fragor_horforstaelse.json';
import { bankCount, bankSubjectsFor, ensureBank } from '../src/learn/bank';
import { LISTEN_REVEAL_S, LearnEncounter } from '../src/learn/LearnEncounter';
import { generateQuestions, questionsForEncounter } from '../src/learn/questions';
import { canSpeak, questionUtterance, questionUtterances } from '../src/learn/speech';
import { GRADES, isValidQuestion, type GradeId, type LearnQuestion } from '../src/learn/types';
import { resetVoiceManifestForTests, setVoiceManifestForTests } from '../src/learn/voiceClips';
import { LearnOverlay } from '../src/ui/LearnOverlay';
import { buildLearnFields } from '../src/ui/learnDom';
import type { CombatSystem } from '../src/systems/CombatSystem';
import type { MonsterAI } from '../src/systems/MonsterAI';
import type { World } from '../src/systems/World';

// Det här testet kollar talsyntesen. Färdiga filer ska inte ta över.
setVoiceManifestForTests(null);

interface HorRow {
  id: string;
  niva: string;
  sprak: string;
  typ: string;
  text: string;
  fraga: string;
  ratt: string;
  fel: string[];
}

const file = horforstaelse as { amne: string; fragor: HorRow[] };
const rows = file.fragor;
const byId = new Map(rows.map((row) => [row.id, row]));
const GRADES_ALL = GRADES.map((g) => g.id);
const TYPES = ['vem', 'vad', 'var', 'varfor', 'ord', 'ordning', 'slutsats'] as const;
const SENTENCE_LIMIT: Record<GradeId, readonly [number, number]> = {
  forskola: [1, 1],
  ak1: [1, 2],
  ak2: [2, 3],
  ak3: [3, 4],
  ak4_6: [2, 5],
  ak7_9: [2, 5],
  gymnasiet: [2, 6],
  vuxen: [2, 6],
};

assert.equal(file.amne, 'horforstaelse');
assert.equal(rows.length, 192);
assert.deepEqual(bankSubjectsFor('horforstaelse'), ['horforstaelse']);
assert.ok(bankSubjectsFor('blandat').includes('horforstaelse'));

const ids = new Set<string>();
const texts = new Set<string>();
for (const row of rows) {
  assert.equal(ids.has(row.id), false, row.id);
  ids.add(row.id);
  assert.equal(texts.has(row.text), false, row.id);
  texts.add(row.text);
  assert.ok(row.text.trim().length > 0, row.id);
  assert.ok(row.fraga.trim().length > 0, row.id);
  assert.ok(row.typ.length > 0, row.id);
  assert.ok((TYPES as readonly string[]).includes(row.typ), row.id);
  assert.ok(row.sprak === 'sv' || row.sprak === 'en', row.id);
  assert.equal(row.fel.length, 3, row.id);
  assert.equal(new Set(row.fel).size, 3, row.id);
  assert.equal(row.fel.includes(row.ratt), false, row.id);
  assert.match(row.id, new RegExp(`^hf-${row.sprak}-${row.niva}-\\d{3}$`));
  const sentences = row.text
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const limit = SENTENCE_LIMIT[row.niva as GradeId];
  assert.ok(limit, row.niva);
  assert.ok(sentences.length >= limit[0] && sentences.length <= limit[1], `${row.id} ${sentences.length}`);
  if (row.niva === 'forskola') {
    const words = row.text.split(/\s+/).filter(Boolean);
    assert.ok(words.length >= 4 && words.length <= 8, `${row.id} ${words.length}`);
  }
}

for (const grade of GRADES_ALL) {
  for (const sprak of ['sv', 'en'] as const) {
    const cell = rows.filter((row) => row.niva === grade && row.sprak === sprak);
    assert.ok(cell.length >= 12, `${grade} ${sprak}`);
    const perTyp = new Map<string, number>();
    for (const row of cell) perTyp.set(row.typ, (perTyp.get(row.typ) ?? 0) + 1);
    for (const [typ, n] of perTyp) assert.ok(n <= 2, `${grade} ${sprak} ${typ} ${n}`);
  }
  const levelTypes = new Set(rows.filter((row) => row.niva === grade).map((row) => row.typ));
  assert.equal(levelTypes.size, TYPES.length, grade);
}

await ensureBank('horforstaelse');
await ensureBank('lasforstaelse');
await ensureBank('svenska');
await ensureBank('engelska');

function rowOf(q: LearnQuestion): HorRow {
  const id = q.id.split(':')[2] ?? '';
  const row = byId.get(id);
  assert.ok(row, id);
  return row;
}

function assertHor(q: LearnQuestion, grade: GradeId): HorRow {
  assert.equal(isValidQuestion(q), true, q.id);
  assert.equal(q.subject, 'horforstaelse');
  assert.equal(q.grade, grade);
  assert.equal(q.choices.length, 4);
  assert.equal(new Set(q.choices).size, 4);
  const row = rowOf(q);
  assert.equal(q.rule, row.typ);
  assert.equal(q.prompt, row.fraga);
  assert.equal(q.passage, row.text.trim());
  assert.ok(q.passage && q.passage.length > 0);
  assert.equal(q.answer, row.ratt);
  assert.equal(q.choices[q.correctIndex], q.answer);
  assert.equal(q.choices.filter((choice) => choice === q.answer).length, 1);
  assert.equal(q.speakPrompt, false);
  assert.equal(q.hidePassageUntilAnswered, true);
  const spoken = `${row.text.trim()} ${row.fraga.trim()}`;
  assert.equal(q.speakText, spoken);
  assert.equal(q.speakLang, row.sprak === 'en' ? 'en-US' : 'sv-SE');
  const uttered = questionUtterance(q);
  assert.equal(uttered.text, spoken);
  assert.equal(uttered.lang, q.speakLang);
  const parts = questionUtterances(q);
  assert.equal(parts.length, 1, q.id);
  assert.equal(parts[0]?.text, spoken);
  assert.equal(parts[0]?.lang, q.speakLang);
  for (const choice of q.choices) {
    if (choice === q.answer) continue;
    assert.ok(row.fel.includes(choice), `${q.id} ${choice}`);
  }
  return row;
}

for (const grade of GRADES_ALL) {
  const fromFile = rows.filter((row) => row.niva === grade).length;
  assert.ok(bankCount('horforstaelse', grade) >= 12, grade);
  assert.equal(bankCount('horforstaelse', grade), fromFile, grade);
  const qs = generateQuestions({ count: fromFile, grade, subject: 'horforstaelse', seed: 4, idPrefix: 'hf' });
  assert.equal(qs.length, fromFile);
  const seen = new Set<string>();
  const langs = new Set<string>();
  for (const q of qs) {
    const row = assertHor(q, grade);
    assert.equal(row.niva, grade);
    seen.add(row.id);
    langs.add(row.sprak);
  }
  assert.equal(seen.size, fromFile, grade);
  assert.ok(langs.has('sv') && langs.has('en'), grade);
}

const enQ = generateQuestions({ count: 12, grade: 'ak1', subject: 'horforstaelse', seed: 4, idPrefix: 'en' }).find(
  (q) => q.speakLang === 'en-US',
);
const svQ = generateQuestions({ count: 12, grade: 'ak1', subject: 'horforstaelse', seed: 4, idPrefix: 'sv' }).find(
  (q) => q.speakLang === 'sv-SE',
);
assert.ok(enQ);
assert.ok(svQ);
assert.equal(questionUtterance(enQ).lang, 'en-US');
assert.equal(questionUtterance(enQ).text, enQ.speakText);
assert.equal(questionUtterances(enQ).length, 1);
assert.equal(questionUtterance(svQ).lang, 'sv-SE');
assert.equal(questionUtterance(svQ).text, svQ.speakText);
assert.equal(questionUtterances(svQ).length, 1);

let sawHorAk1 = false;
let sawLasAk1 = false;
for (let seed = 0; seed < 40; seed++) {
  const qs = generateQuestions({ count: 8, grade: 'ak1', subject: 'blandat', seed, idPrefix: 'mix' });
  for (const q of qs) {
    assert.equal(q.grade, 'ak1');
    assert.equal(isValidQuestion(q), true, q.id);
    if (q.subject === 'horforstaelse') sawHorAk1 = true;
    if (q.subject === 'lasforstaelse') sawLasAk1 = true;
  }
}
assert.equal(sawHorAk1, true, 'blandat på åk 1 ska kunna ge hörförståelse');
assert.equal(sawLasAk1, true, 'blandat på åk 1 ska fortfarande kunna ge läsförståelse');

let sawHorVuxen = false;
for (let seed = 0; seed < 40; seed++) {
  const qs = generateQuestions({ count: 8, grade: 'vuxen', subject: 'blandat', seed, idPrefix: 'vux' });
  for (const q of qs) {
    assert.equal(q.grade, 'vuxen');
    assert.notEqual(q.subject, 'lasforstaelse');
    if (q.subject === 'horforstaelse') {
      sawHorVuxen = true;
      assert.equal(rowOf(q).niva, 'vuxen');
    }
  }
}
assert.equal(sawHorVuxen, true, 'blandat på vuxen ska kunna ge hörförståelse');

function installDom(): void {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  const g = globalThis as unknown as Record<string, unknown>;
  const win = dom.window as unknown as Record<string, unknown>;
  for (const k of ['window', 'document', 'HTMLElement', 'HTMLButtonElement', 'Node', 'Event']) g[k] = win[k];
}

installDom();

const fields = buildLearnFields({ grade: 'ak1', subject: 'horforstaelse', readAloud: false }, () => undefined);
const subjectSel = fields.querySelectorAll('select')[1];
assert.ok(subjectSel);
assert.match(subjectSel.textContent ?? '', /Hörförståelse/);
assert.equal((subjectSel as HTMLSelectElement).value, 'horforstaelse');

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
let cancels = 0;
const fakeSynth = {
  speak(u: FakeUtterance) {
    spoken.push({ text: u.text, lang: u.lang, voice: u.voice?.name ?? '' });
  },
  cancel() {
    cancels += 1;
  },
  pause() {},
  resume() {},
  getVoices() {
    return [
      { lang: 'sv-SE', name: 'Alva', localService: true, default: true },
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

const overlay = new LearnOverlay({ grade: 'ak1', subject: 'horforstaelse', readAloud: false });
try {
  const style = [...document.head.querySelectorAll('style')].map((node) => node.textContent ?? '').join('\n');
  assert.match(style, /\.rk-q-listen\{[^}]*min-height:56px/);
  assert.match(style, /\.rk-q-card\.forskola \.rk-q-listen\{[^}]*min-height:88px/);

  spoken.length = 0;
  overlay.showQuestion(enQ, 0, 2);
  assert.equal(spoken.length, 0, 'texten läses inte upp automatiskt');
  const passageEl = overlay.root.querySelector('.rk-q-passage');
  const hint = overlay.root.querySelector('.rk-q-listen-hint');
  const listen = overlay.root.querySelector('.rk-q-listen');
  const speaker = overlay.root.querySelector('.rk-q-speak');
  assert.ok(passageEl instanceof HTMLElement);
  assert.ok(hint instanceof HTMLElement);
  assert.ok(listen instanceof HTMLButtonElement);
  assert.ok(speaker instanceof HTMLButtonElement);
  assert.notEqual(hint, passageEl);
  assert.equal(passageEl.hidden, true);
  assert.equal(passageEl.textContent, '');
  assert.equal(hint.hidden, false);
  assert.equal(hint.textContent, 'Lyssna på texten och svara på frågan.');
  assert.equal(listen.hidden, false);
  assert.equal(listen.disabled, false);
  assert.equal(listen.textContent, 'Lyssna');
  assert.equal(speaker.hidden, true);
  assert.equal(overlay.root.querySelector('.rk-q-prompt')?.textContent, enQ.prompt);
  assert.equal(overlay.root.querySelector('.rk-q-eng')?.textContent ?? '', '');

  const cancelsBefore = cancels;
  listen.click();
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0]?.text, enQ.speakText);
  assert.ok((spoken[0]?.text ?? '').trim().length > 0);
  assert.equal(spoken[0]?.lang, 'en-US');
  assert.equal(spoken[0]?.voice, 'Sam');
  assert.equal(cancels, cancelsBefore, 'Lyssna ska inte avbryta yttret');
  assert.equal(listen.textContent, 'Lyssna igen');
  listen.click();
  assert.equal(spoken.length, 2);
  assert.equal(spoken[1]?.text, enQ.speakText);
  assert.ok((spoken[1]?.text ?? '').trim().length > 0);
  assert.equal(spoken[1]?.lang, 'en-US');
  assert.equal(spoken[1]?.voice, 'Sam');
  assert.equal(cancels, cancelsBefore, 'Lyssna igen ska inte nolla talet när motorn är ledig');

  overlay.revealPassage();
  assert.equal(passageEl.hidden, false);
  assert.equal(passageEl.textContent, enQ.passage);
  assert.equal(passageEl.lang, 'en');
  assert.equal(hint.hidden, true);

  spoken.length = 0;
  overlay.showQuestion(svQ, 1, 2);
  assert.equal(spoken.length, 0);
  assert.equal(passageEl.hidden, true);
  assert.equal(passageEl.textContent, '');
  assert.equal(hint.hidden, false);
  assert.equal(listen.textContent, 'Lyssna');
  listen.click();
  assert.equal(spoken[0]?.lang, 'sv-SE');
  assert.equal(spoken[0]?.text, svQ.speakText);
  assert.ok((spoken[0]?.text ?? '').trim().length > 0);
  assert.equal(spoken[0]?.voice, 'Alva');
  assert.equal(listen.textContent, 'Lyssna igen');
  const beforeChoice = spoken.length;
  const horChoice = overlay.root.querySelector('.rk-q-choices button');
  assert.ok(horChoice instanceof HTMLButtonElement);
  horChoice.dispatchEvent(new Event('pointerenter'));
  horChoice.dispatchEvent(new Event('pointerdown'));
  horChoice.dispatchEvent(new Event('focus'));
  horChoice.click();
  assert.equal(horChoice.classList.contains('selected'), true);
  assert.equal(spoken.length, beforeChoice, 'val i hörförståelse är tyst');

  const beforeWrong = spoken.length;
  const cancelsAtWrong = cancels;
  overlay.showWrong(svQ, (svQ.correctIndex + 1) % 4);
  assert.equal(spoken.length, beforeWrong, 'fel svar läses inte upp');
  assert.equal(cancels, cancelsAtWrong, 'fel svar får inte nolla talet medan quizzen syns');
  assert.equal(passageEl.hidden, false);
  assert.equal(passageEl.textContent, svQ.passage);
  assert.equal(passageEl.lang, 'sv');
  assert.equal(hint.hidden, true);
  assert.match(overlay.root.querySelector('.rk-q-feedback')?.textContent ?? '', /Rätt svar var:/);
  listen.click();
  assert.equal(spoken.length, beforeWrong + 1, 'Lyssna igen läser fortfarande');
  assert.equal(spoken[spoken.length - 1]?.text, svQ.speakText);
  assert.ok((spoken[spoken.length - 1]?.text ?? '').trim().length > 0);
  assert.equal(spoken[spoken.length - 1]?.lang, 'sv-SE');
  assert.equal(spoken[spoken.length - 1]?.voice, 'Alva');
  assert.equal(listen.textContent, 'Lyssna igen');

  overlay.showQuestion(enQ, 0, 1);
  assert.equal(passageEl.textContent, '');
  overlay.showCorrect(enQ);
  assert.equal(passageEl.hidden, false);
  assert.equal(passageEl.textContent, enQ.passage);
  assert.equal(passageEl.lang, 'en');
  assert.equal(hint.hidden, true);
  const buttons = overlay.root.querySelectorAll('.rk-q-choices button');
  assert.equal(buttons[enQ.correctIndex]?.classList.contains('correct'), true);
} finally {
  overlay.dispose();
}

assert.ok(LISTEN_REVEAL_S >= 1.2 && LISTEN_REVEAL_S <= 1.6);

function makeEnc(subject: 'horforstaelse' | 'matte'): LearnEncounter {
  const monster = {
    id: 'varg',
    boss: true,
    elite: null,
    dead: 0,
    active: true,
    atk: 0,
    facing: 0,
    moving: false,
    pos: { x: 0, y: 1 },
    def: { attack_range: 1.6, name: 'Varg' },
    view: { position: { x: 0 }, height2: 40, sprite: { alpha: 1 }, play() {} },
  } as unknown as Monster;
  const hero = {
    pos: { x: 0, y: 0 },
    moveTarget: null as { x: number; y: number } | null,
    stats: { reach: 2.2, maxHp: 100, dmgMin: 4, dmgMax: 8 },
    s: { playing: true, hp: 100, facing: 0 },
    view: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, sprite: { tint: 0xffffff }, play() {}, applyTint() {} },
    clearAttack() {},
  };
  const world = {
    hero,
    monsters: [monster],
    rng: { next: () => 0.2 },
    fb: { flash() {}, float() {} },
  };
  return new LearnEncounter(
    () => world as unknown as World,
    {
      kill() {},
      ring() {
        return {};
      },
    } as unknown as CombatSystem,
    { paused: false } as MonsterAI,
    { grade: 'ak1', subject, readAloud: false },
    () => false,
    () => undefined,
  );
}

function quizHidden(enc: LearnEncounter): boolean {
  return enc.overlaySettings.root.querySelector('#rk-learn-quiz')?.classList.contains('hidden') ?? true;
}

const horBoss = questionsForEncounter({ kind: 'boss', monsterId: 'varg', grade: 'ak1', subject: 'horforstaelse', seed: 0 });
const rightEnc = makeEnc('horforstaelse');
try {
  rightEnc.tick(0);
  assert.equal(quizHidden(rightEnc), false);
  assert.equal(rightEnc.overlaySettings.root.querySelector('.rk-q-passage')?.textContent, '');
  const q = horBoss[0];
  assert.ok(q);
  rightEnc.answer(q.correctIndex);
  assert.equal(quizHidden(rightEnc), false, 'rätt svar döljer inte hörförståelsen direkt');
  assert.equal(rightEnc.overlaySettings.root.querySelector('.rk-q-passage')?.textContent, q.passage);
  assert.equal(rightEnc.isQuestion(), false);
  assert.equal(rightEnc.busy(), true);
  rightEnc.tick(LISTEN_REVEAL_S - 0.05);
  assert.equal(quizHidden(rightEnc), false);
  rightEnc.tick(0.1);
  assert.equal(quizHidden(rightEnc), true, 'striden börjar efter att texten visats');
} finally {
  rightEnc.dispose();
}

const wrongEnc = makeEnc('horforstaelse');
try {
  wrongEnc.tick(0);
  const q = horBoss[0];
  assert.ok(q);
  wrongEnc.answer((q.correctIndex + 1) % 4);
  assert.equal(quizHidden(wrongEnc), false);
  assert.equal(wrongEnc.overlaySettings.root.querySelector('.rk-q-passage')?.textContent, q.passage);
  assert.equal(wrongEnc.overlaySettings.root.querySelector('.rk-q-listen-hint')?.hidden, true);
} finally {
  wrongEnc.dispose();
}

const matteEnc = makeEnc('matte');
try {
  const matteBoss = questionsForEncounter({ kind: 'boss', monsterId: 'varg', grade: 'ak1', subject: 'matte', seed: 0 });
  matteEnc.tick(0);
  const q = matteBoss[0];
  assert.ok(q);
  matteEnc.answer(q.correctIndex);
  assert.equal(quizHidden(matteEnc), true, 'andra ämnen går direkt till strid');
} finally {
  matteEnc.dispose();
}

delete w.speechSynthesis;
assert.equal(canSpeak(), false);
const quiet = new LearnOverlay({ grade: 'ak1', subject: 'horforstaelse', readAloud: true });
try {
  quiet.showQuestion(svQ, 0, 1);
  const passageEl = quiet.root.querySelector('.rk-q-passage');
  const note = quiet.root.querySelector('.rk-q-listen-note');
  const listen = quiet.root.querySelector('.rk-q-listen');
  assert.ok(passageEl instanceof HTMLElement);
  assert.ok(note instanceof HTMLElement);
  assert.ok(listen instanceof HTMLButtonElement);
  assert.equal(passageEl.hidden, false);
  assert.equal(passageEl.textContent, svQ.passage);
  assert.equal(note.hidden, false);
  assert.match(note.textContent ?? '', /kan inte läsa upp ljud/);
  assert.equal(listen.hidden || listen.disabled, true);
  assert.equal(quiet.root.querySelector('.rk-q-listen-hint')?.hidden, true);
} finally {
  quiet.dispose();
}

resetVoiceManifestForTests();
console.log('learn horforstaelse ok', { bank: bankCount('horforstaelse', 'ak1'), rows: rows.length });
