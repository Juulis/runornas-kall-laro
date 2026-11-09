/**
 * Läsförståelse: bank, blandat, fallback till åk 3 och passage i overlay.
 * Kör: npx tsx tests/learn-lasforstaelse.test.mts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import lasforstaelse from '../src/data/fragor_lasforstaelse.json';
import { bankCount, bankSubjectsFor, ensureBank, preloadLearnBanks } from '../src/learn/bank';
import { generateQuestions } from '../src/learn/questions';
import { questionUtterance } from '../src/learn/speech';
import { isValidQuestion, type GradeId, type LearnQuestion } from '../src/learn/types';
import { LearnOverlay } from '../src/ui/LearnOverlay';
import { buildLearnFields } from '../src/ui/learnDom';

interface LasRow {
  id: string;
  niva: string;
  typ: string;
  text: string;
  fraga: string;
  ratt: string;
  fel: string[];
  las_upp?: boolean;
}

const rows = (lasforstaelse as { fragor: LasRow[] }).fragor;
const byId = new Map(rows.map((row) => [row.id, row]));

assert.deepEqual(bankSubjectsFor('lasforstaelse'), ['lasforstaelse']);
assert.deepEqual(bankSubjectsFor('blandat'), ['svenska', 'engelska', 'lasforstaelse']);
assert.deepEqual(bankSubjectsFor('matte'), []);

await ensureBank('lasforstaelse');
await ensureBank('svenska');
await ensureBank('engelska');
await preloadLearnBanks({ subject: 'blandat' });

function rowOf(q: LearnQuestion): LasRow {
  const id = q.id.split(':')[2] ?? '';
  const row = byId.get(id);
  assert.ok(row, id);
  return row;
}

function assertLas(q: LearnQuestion, grade: GradeId): LasRow {
  assert.equal(isValidQuestion(q), true, q.id);
  assert.equal(q.subject, 'lasforstaelse');
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
  assert.equal(q.speakLang, 'sv-SE');
  assert.equal(q.speakPrompt, false);
  const spoken = `${row.text.trim()} ${row.fraga.trim()}`;
  assert.equal(q.speakText, spoken);
  const uttered = questionUtterance(q);
  assert.equal(uttered.lang, 'sv-SE');
  assert.equal(uttered.text, spoken);
  assert.ok(uttered.text.startsWith(row.text.trim()));
  assert.ok(uttered.text.endsWith(row.fraga.trim()));
  for (const choice of q.choices) {
    if (choice === q.answer) continue;
    assert.ok(row.fel.includes(choice), `${q.id} ${choice}`);
  }
  return row;
}

for (const grade of ['forskola', 'ak1', 'ak2', 'ak3'] as const) {
  assert.equal(bankCount('lasforstaelse', grade), 32, grade);
  const qs = generateQuestions({ count: 32, grade, subject: 'lasforstaelse', seed: 11, idPrefix: 'lf' });
  assert.equal(qs.length, 32);
  const ids = new Set<string>();
  for (const q of qs) {
    const row = assertLas(q, grade);
    assert.equal(row.niva, grade);
    if (grade === 'forskola') assert.equal(row.las_upp, true);
    ids.add(row.id);
  }
  assert.equal(ids.size, 32, `${grade} ska ge varje bankrad en gång`);
}

const mixed = new Set<string>();
for (let seed = 0; seed < 40; seed++) {
  const qs = generateQuestions({ count: 8, grade: 'ak1', subject: 'blandat', seed, idPrefix: 'mix' });
  for (const q of qs) {
    assert.equal(q.grade, 'ak1');
    assert.equal(isValidQuestion(q), true, q.id);
    mixed.add(q.subject);
  }
}
assert.ok(mixed.has('lasforstaelse'), 'blandat på åk 1 ska kunna ge läsförståelse');
assert.ok(mixed.has('matte'));
assert.ok(mixed.has('svenska'));
assert.ok(mixed.has('engelska'));

for (const grade of ['ak4_6', 'ak7_9', 'gymnasiet', 'vuxen'] as const) {
  assert.equal(bankCount('lasforstaelse', grade), 0, grade);
  const qs = generateQuestions({ count: 4, grade, subject: 'lasforstaelse', seed: 5, idPrefix: 'hi' });
  assert.equal(qs.length, 4);
  for (const q of qs) {
    const row = assertLas(q, grade);
    assert.equal(row.niva, 'ak3', `${grade} ska falla tillbaka på åk 3`);
  }
  const blandat = generateQuestions({ count: 12, grade, subject: 'blandat', seed: 8, idPrefix: 'sen' });
  for (const q of blandat) {
    assert.equal(q.grade, grade);
    assert.notEqual(q.subject, 'lasforstaelse');
  }
}

function installDom(): void {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  const g = globalThis as unknown as Record<string, unknown>;
  const win = dom.window as unknown as Record<string, unknown>;
  for (const k of ['window', 'document', 'HTMLElement', 'Node', 'Event']) g[k] = win[k];
}

installDom();

const fields = buildLearnFields({ grade: 'ak1', subject: 'lasforstaelse', readAloud: false }, () => undefined);
const subjectSel = fields.querySelectorAll('select')[1];
assert.ok(subjectSel);
assert.match(subjectSel.textContent ?? '', /Läsförståelse/);
assert.equal((subjectSel as HTMLSelectElement).value, 'lasforstaelse');

const withPassage = generateQuestions({ count: 1, grade: 'ak1', subject: 'lasforstaelse', seed: 2, idPrefix: 'ov' })[0];
const withoutPassage = generateQuestions({ count: 1, grade: 'ak1', subject: 'matte', seed: 2, idPrefix: 'ov' })[0];
assert.ok(withPassage?.passage);
assert.equal(withoutPassage?.passage, undefined);

const overlay = new LearnOverlay({ grade: 'ak1', subject: 'lasforstaelse', readAloud: false });
try {
  const style = [...document.head.querySelectorAll('style')].map((node) => node.textContent ?? '').join('\n');
  assert.match(style, /\.rk-q-passage\{font-size:clamp\(20px,3vw,28px\);color:#e8dcc0;line-height:1\.35;/);
  assert.match(style, /\.rk-q-card\.forskola \.rk-q-passage\{font-size:clamp\(26px,4vw,40px\)\}/);

  overlay.showQuestion(withPassage, 0, 1);
  const passageEl = overlay.root.querySelector('.rk-q-passage');
  const head = overlay.root.querySelector('.rk-q-head');
  assert.ok(passageEl instanceof HTMLElement);
  assert.ok(head);
  assert.ok((passageEl.compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  assert.equal(passageEl.hidden, false);
  assert.equal(passageEl.textContent, withPassage.passage);
  assert.equal(overlay.root.querySelector('.rk-q-prompt')?.textContent, withPassage.prompt);

  overlay.showQuestion(withoutPassage, 1, 2);
  assert.equal(passageEl.hidden, true);
  assert.equal(passageEl.textContent, '');

  overlay.showQuestion(withPassage, 0, 2);
  assert.equal(passageEl.hidden, false);
  assert.equal(passageEl.textContent, withPassage.passage);
} finally {
  overlay.dispose();
}

console.log('learn lasforstaelse ok', { bank: bankCount('lasforstaelse', 'ak1'), mixed: [...mixed].sort() });
