import { el } from '../menu/dom';
import { readAloudOf } from '../learn/settings';
import { GRADES, SUBJECTS, isGradeId, isSubjectId, type LearnSettings } from '../learn/types';

/** Nivå- och ämnesväljare. Etiketterna är svenska även om spelet är på engelska. */
export function buildLearnFields(current: LearnSettings, onChange: (s: LearnSettings) => void): HTMLDivElement {
  const gradeSel = el('select', { 'aria-label': 'Nivå' });
  for (const g of GRADES) gradeSel.append(el('option', { value: g.id, text: g.label }));
  gradeSel.value = current.grade;
  gradeSel.dataset.prev = current.grade;
  const subjectSel = el('select', { 'aria-label': 'Ämne' });
  for (const s of SUBJECTS) subjectSel.append(el('option', { value: s.id, text: s.label }));
  subjectSel.value = current.subject;
  const readBox = el('input', { type: 'checkbox', 'aria-label': 'Visa ljudknapp' });
  readBox.checked = readAloudOf(current);
  const emit = (): void => {
    if (!isGradeId(gradeSel.value) || !isSubjectId(subjectSel.value)) return;
    onChange({ grade: gradeSel.value, subject: subjectSel.value, readAloud: readBox.checked });
  };
  gradeSel.addEventListener('change', () => {
    if (!isGradeId(gradeSel.value)) return;
    const prev = gradeSel.dataset.prev;
    if (gradeSel.value === 'forskola') readBox.checked = true;
    else if (prev === 'forskola') readBox.checked = false;
    gradeSel.dataset.prev = gradeSel.value;
    emit();
  });
  subjectSel.addEventListener('change', () => {
    emit();
  });
  readBox.addEventListener('change', () => {
    emit();
  });
  return el(
    'div',
    { class: 'learn-setup' },
    el('label', {}, el('span', { text: 'Nivå' }), gradeSel),
    el('label', {}, el('span', { text: 'Ämne' }), subjectSel),
    el('label', { class: 'learn-read' }, readBox, el('span', { text: 'Visa ljudknapp 🔊' })),
  );
}

export function setLearnFieldValues(root: ParentNode, settings: LearnSettings): void {
  const [gradeSel, subjectSel] = root.querySelectorAll('select');
  if (gradeSel) {
    gradeSel.value = settings.grade;
    gradeSel.dataset.prev = settings.grade;
  }
  if (subjectSel) subjectSel.value = settings.subject;
  const box = root.querySelector('input[type="checkbox"]');
  if (box instanceof HTMLInputElement) box.checked = readAloudOf(settings);
}
