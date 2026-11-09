import { el } from '../menu/dom';
import { GRADES, SUBJECTS, isGradeId, isSubjectId, type GradeId, type LearnSettings, type SubjectId } from '../learn/types';

/** Nivå- och ämnesväljare. Etiketterna är svenska även om spelet är på engelska. */
export function buildLearnFields(current: LearnSettings, onChange: (s: LearnSettings) => void): HTMLDivElement {
  let grade: GradeId = current.grade;
  let subject: SubjectId = current.subject;
  const gradeSel = el('select', { 'aria-label': 'Nivå' });
  for (const g of GRADES) gradeSel.append(el('option', { value: g.id, text: g.label }));
  gradeSel.value = grade;
  const subjectSel = el('select', { 'aria-label': 'Ämne' });
  for (const s of SUBJECTS) subjectSel.append(el('option', { value: s.id, text: s.label }));
  subjectSel.value = subject;
  const emit = (): void => onChange({ grade, subject });
  gradeSel.addEventListener('change', () => {
    if (!isGradeId(gradeSel.value)) return;
    grade = gradeSel.value;
    emit();
  });
  subjectSel.addEventListener('change', () => {
    if (!isSubjectId(subjectSel.value)) return;
    subject = subjectSel.value;
    emit();
  });
  return el(
    'div',
    { class: 'learn-setup' },
    el('label', {}, el('span', { text: 'Nivå' }), gradeSel),
    el('label', {}, el('span', { text: 'Ämne' }), subjectSel),
  );
}

export function setLearnFieldValues(root: ParentNode, settings: LearnSettings): void {
  const [gradeSel, subjectSel] = root.querySelectorAll('select');
  if (gradeSel) gradeSel.value = settings.grade;
  if (subjectSel) subjectSel.value = settings.subject;
}
