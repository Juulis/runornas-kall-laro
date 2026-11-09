/**
 * Kladdruta vid svåra mattefrågor.
 * Kör: npx tsx tests/learn-scratchpad.test.mts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Rng } from '../src/core/Rng';
import { HARD_MATH_RULES, isHardMathRule, isHardQuestion } from '../src/learn/hardQuestion';
import { nextMathQuestion } from '../src/learn/mathQuestions';
import type { GradeId, LearnQuestion, QuestionSubject } from '../src/learn/types';
import { Scratchpad } from '../src/ui/Scratchpad';
import { LearnOverlay } from '../src/ui/LearnOverlay';

function installDom(): void {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  const g = globalThis as unknown as Record<string, unknown>;
  const win = dom.window as unknown as Record<string, unknown>;
  for (const k of [
    'window',
    'document',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLButtonElement',
    'HTMLCanvasElement',
    'HTMLTextAreaElement',
    'HTMLDivElement',
    'Node',
    'Event',
  ]) {
    g[k] = win[k];
  }
  // jsdom saknar canvas och skriver ett fel varje gång getContext anropas.
  dom.window.HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext'];
}

installDom();

function question(over: Partial<LearnQuestion> = {}): LearnQuestion {
  return {
    id: 'q',
    prompt: 'Vad är x?',
    choices: ['1', '2', '3', '4'],
    correctIndex: 0,
    answer: '1',
    subject: 'matte',
    grade: 'ak7_9',
    rule: 'ak79-ekvation',
    ...over,
  };
}

for (const rule of HARD_MATH_RULES) {
  assert.equal(isHardMathRule(rule), true, rule);
  assert.equal(isHardQuestion(question({ rule, needsScratchpad: undefined })), true, rule);
  assert.equal(isHardQuestion(question({ rule, needsScratchpad: false })), true, `${rule} faller tillbaka på regeln`);
}

for (const rule of ['ak79-negativ', 'gym-huvudrakning', 'ak1-plus', 'forskola-plus', 'ak46-procent', 'ak2-tabell']) {
  assert.equal(isHardMathRule(rule), false, rule);
  assert.equal(isHardQuestion(question({ rule, grade: 'ak1' })), false, rule);
}

assert.equal(isHardQuestion(question({ rule: 'ak1-plus', grade: 'ak1', needsScratchpad: true })), true);
assert.equal(isHardQuestion(question({ subject: 'svenska', rule: 'ak79-ekvation', needsScratchpad: true })), false);
assert.equal(isHardQuestion(question({ subject: 'engelska', rule: 'gym-procent', grade: 'gymnasiet' })), false);
assert.equal(isHardQuestion(question({ subject: 'engelska', needsScratchpad: true, rule: 'gym-andragrads' })), false);

function tally(grade: GradeId, seed: number, count: number): { hard: Set<string>; easy: Set<string> } {
  const rng = new Rng(seed);
  const hard = new Set<string>();
  const easy = new Set<string>();
  for (let i = 0; i < count; i++) {
    const q = nextMathQuestion(rng, grade, i, 'k');
    if (isHardMathRule(q.rule)) {
      assert.equal(q.needsScratchpad, true, `${grade} ${q.rule}`);
      assert.equal(isHardQuestion(q), true, q.id);
      hard.add(q.rule);
    } else {
      assert.equal(q.needsScratchpad, undefined, `${grade} ${q.rule}`);
      assert.equal(isHardQuestion(q), false, q.id);
      easy.add(q.rule);
    }
  }
  return { hard, easy };
}

const ak79 = tally('ak7_9', 20261109, 48);
assert.deepEqual([...ak79.hard].sort(), ['ak79-ekvation', 'ak79-potens']);
assert.ok(ak79.easy.has('ak79-negativ'));

const gym = tally('gymnasiet', 20261109, 48);
assert.deepEqual([...gym.hard].sort(), ['gym-andragrads', 'gym-procent']);
assert.ok(gym.easy.has('gym-huvudrakning'));

const vuxen = tally('vuxen', 11, 48);
assert.ok(vuxen.hard.has('gym-andragrads'));
assert.ok(vuxen.hard.has('gym-procent'));
assert.ok(vuxen.easy.has('gym-huvudrakning'));

for (const grade of ['forskola', 'ak1', 'ak2', 'ak3', 'ak4_6'] as const) {
  const bag = tally(grade, 7, 24);
  assert.equal(bag.hard.size, 0, grade);
  assert.ok(bag.easy.size > 0, grade);
}

interface Ink {
  op: string;
  width: number;
}

function mockInk(canvas: HTMLCanvasElement): { strokes: Ink[]; clears: number } {
  const strokes: Ink[] = [];
  let clears = 0;
  const ctx = {
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    strokeStyle: '',
    lineCap: '',
    lineJoin: '',
    setTransform() {},
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      strokes.push({ op: this.globalCompositeOperation, width: this.lineWidth });
    },
    clearRect() {
      clears += 1;
    },
    drawImage() {},
  };
  canvas.getContext = ((kind: string) => (kind === '2d' ? ctx : null)) as HTMLCanvasElement['getContext'];
  return {
    strokes,
    get clears() {
      return clears;
    },
  };
}

function pointer(type: string, x: number, y: number, pointerId = 1): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    clientX: x,
    clientY: y,
    offsetX: x,
    offsetY: y,
    pointerId,
    pointerType: 'pen',
    button: 0,
    buttons: 1,
  })) {
    Object.defineProperty(ev, key, { value });
  }
  return ev;
}

const pad = new Scratchpad();
document.body.append(pad.root);
try {
  assert.equal(pad.root.hidden, true);
  assert.equal(pad.root.getAttribute('role'), 'region');
  assert.equal(pad.root.querySelector('.rk-scratch-title')?.textContent, 'Räkna här');
  pad.setVisible(true);
  assert.equal(pad.root.hidden, false);

  const canvas = pad.root.querySelector('canvas');
  assert.ok(canvas instanceof HTMLCanvasElement);
  assert.equal(canvas.style.touchAction, 'none');
  const note = pad.root.querySelector('textarea');
  assert.ok(note instanceof HTMLTextAreaElement);
  const textBtn = [...pad.root.querySelectorAll('button')].find((b) => b.textContent === 'Text');
  const drawBtn = [...pad.root.querySelectorAll('button')].find((b) => b.textContent === 'Rita');
  const sudda = [...pad.root.querySelectorAll('button')].find((b) => b.textContent === 'Sudda');
  const pen = [...pad.root.querySelectorAll('button')].find((b) => b.textContent === 'Penna');
  const eraser = [...pad.root.querySelectorAll('button')].find((b) => b.textContent === 'Sudd');
  assert.ok(textBtn instanceof HTMLButtonElement && drawBtn instanceof HTMLButtonElement);
  assert.ok(sudda instanceof HTMLButtonElement && pen instanceof HTMLButtonElement && eraser instanceof HTMLButtonElement);
  assert.equal(sudda.type, 'button');
  assert.equal(drawBtn.getAttribute('aria-pressed'), 'true');

  textBtn.click();
  const textPane = pad.root.querySelectorAll('.rk-scratch-pane')[1];
  const drawPane = pad.root.querySelectorAll('.rk-scratch-pane')[0];
  assert.ok(textPane instanceof HTMLElement && drawPane instanceof HTMLElement);
  assert.equal(textPane.hidden, false);
  assert.equal(drawPane.hidden, true);
  note.value = 'x + 4';
  assert.equal(pen.parentElement?.hidden, true, 'pennan hör till ritläget');
  sudda.click();
  assert.equal(note.value, '');
  assert.equal(textPane.hidden, false, 'Sudda behåller textläge');

  pad.clear();
  assert.equal(drawPane.hidden, false);
  assert.equal(textPane.hidden, true);
  assert.equal(pen.getAttribute('aria-pressed'), 'true');

  const ink = mockInk(canvas);
  let captured = -1;
  let released = 0;
  canvas.setPointerCapture = (id: number) => {
    captured = id;
  };
  canvas.releasePointerCapture = () => {
    released += 1;
  };
  canvas.hasPointerCapture = () => captured >= 0;
  const down = pointer('pointerdown', 4, 8);
  canvas.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(captured, 1);
  canvas.dispatchEvent(pointer('pointermove', 20, 24));
  canvas.dispatchEvent(pointer('pointerup', 20, 24));
  assert.equal(released, 1);
  assert.equal(ink.strokes.length, 2);
  assert.equal(ink.strokes[0]?.op, 'source-over');
  assert.equal(ink.strokes[0]?.width, 4);

  eraser.click();
  canvas.dispatchEvent(pointer('pointerdown', 2, 2, 3));
  assert.equal(ink.strokes.at(-1)?.op, 'destination-out');
  assert.equal(ink.strokes.at(-1)?.width, 22);
  canvas.dispatchEvent(pointer('pointercancel', 2, 2, 3));

  note.value = 'kvar';
  pad.clear();
  assert.equal(note.value, '');
  assert.ok(ink.clears >= 1);
  pad.setVisible(false);
  assert.equal(pad.root.hidden, true);
} finally {
  pad.dispose();
}

function scratchOf(root: ParentNode): HTMLElement {
  const el = root.querySelector('.rk-scratch');
  assert.ok(el instanceof HTMLElement);
  return el;
}

let answered = -1;
const overlay = new LearnOverlay({ grade: 'ak7_9', subject: 'matte', readAloud: false });
overlay.onAnswer = (index) => {
  answered = index;
};
try {
  const css = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
  assert.match(css, /touch-action:\s*none/);
  assert.match(css, /\.rk-q-layout/);
  assert.match(css, /max-width:\s*1000px/);
  assert.match(css, /flex-direction:\s*column/);
  assert.match(css, /rk-with-scratch/);

  const layout = overlay.root.querySelector('.rk-q-layout');
  const card = overlay.root.querySelector('.rk-q-card');
  const scratch = scratchOf(overlay.root);
  assert.ok(layout instanceof HTMLElement && card instanceof HTMLElement);
  assert.equal(layout.contains(card), true);
  assert.equal(layout.contains(scratch), true);
  assert.equal(card.contains(scratch), false);
  const choices = overlay.root.querySelector('.rk-q-choices');
  assert.ok(choices instanceof HTMLElement);
  assert.equal(scratch.contains(choices), false);

  overlay.showQuestion(question({ rule: 'ak1-plus', grade: 'ak1' }), 0, 1);
  assert.equal(scratch.hidden, true);
  assert.equal(overlay.root.querySelector('#rk-learn-quiz')?.classList.contains('rk-with-scratch'), false);

  const subjects: QuestionSubject[] = ['svenska', 'engelska'];
  for (const subject of subjects) {
    overlay.showQuestion(question({ subject, rule: 'gym-procent', needsScratchpad: true }), 0, 1);
    assert.equal(scratch.hidden, true, subject);
  }

  overlay.showQuestion(question({ rule: 'ak79-ekvation' }), 0, 2);
  assert.equal(scratch.hidden, false);
  assert.equal(overlay.root.querySelector('#rk-learn-quiz')?.classList.contains('rk-with-scratch'), true);
  const note = scratch.querySelector('textarea');
  assert.ok(note instanceof HTMLTextAreaElement);
  note.value = '3 · 3 = 9';
  const choice = choices.querySelector('button');
  assert.ok(choice instanceof HTMLButtonElement);
  assert.equal(choice.disabled, false);
  scratch.querySelector('button')?.dispatchEvent(new Event('click'));
  assert.equal(answered, -1, 'kladdknappar ska inte räknas som svar');
  choice.click();
  assert.equal(answered, 0);
  assert.equal(choice.disabled, true);

  overlay.showQuestion(question({ rule: 'gym-andragrads', grade: 'gymnasiet' }), 1, 2);
  assert.equal(note.value, '', 'nästa svåra fråga rensar anteckningen');
  assert.equal(scratch.hidden, false);
  assert.equal(scratch.querySelector('.rk-scratch-pane')?.hasAttribute('hidden') ?? false, false);

  overlay.showQuestion(question({ rule: 'gym-huvudrakning', grade: 'gymnasiet' }), 0, 1);
  assert.equal(scratch.hidden, true);

  overlay.showQuestion(question({ rule: 'ak79-potens', needsScratchpad: true }), 0, 1);
  assert.equal(scratch.hidden, false);
  note.value = '2⁵';
  overlay.showWrong('32');
  assert.equal(scratch.hidden, false);
  assert.equal(choices.classList.contains('hidden'), true);
  assert.match(overlay.root.querySelector('.rk-q-feedback')?.textContent ?? '', /Rätt svar var: 32/);
  assert.equal(note.value, '2⁵', 'fel svar ska inte sudda kladdet');

  overlay.showQuestion(question({ rule: 'ak1-plus', grade: 'ak1', needsScratchpad: true }), 0, 1);
  assert.equal(scratch.hidden, false, 'flaggan räcker för att visa rutan');
  assert.equal(note.value, '', 'ny fråga rensar även när bara flaggan är satt');
} finally {
  overlay.dispose();
}

console.log('learn scratchpad ok');
