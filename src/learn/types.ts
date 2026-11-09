/** Nivåer i lärversionen. Id:n sparas, etiketterna visas i menyn. */
export const GRADES = [
  { id: 'forskola', label: 'Förskola' },
  { id: 'ak1', label: 'Åk 1' },
  { id: 'ak2', label: 'Åk 2' },
  { id: 'ak3', label: 'Åk 3' },
  { id: 'ak4_6', label: 'Åk 4–6' },
  { id: 'ak7_9', label: 'Åk 7–9' },
  { id: 'gymnasiet', label: 'Gymnasiet' },
  { id: 'vuxen', label: 'Vuxen' },
] as const;

export const SUBJECTS = [
  { id: 'blandat', label: 'Blandat' },
  { id: 'matte', label: 'Matte' },
  { id: 'svenska', label: 'Svenska' },
  { id: 'engelska', label: 'Engelska' },
] as const;

export type GradeId = (typeof GRADES)[number]['id'];
export type SubjectId = (typeof SUBJECTS)[number]['id'];
export type QuestionSubject = Exclude<SubjectId, 'blandat'>;

export interface QuestionMeta {
  a?: number;
  b?: number;
  n?: number;
  result?: number;
  r1?: number;
  r2?: number;
}

export type SpeakLang = 'sv-SE' | 'en-US' | 'en-GB';

/** Flervalsfråga: exakt fyra unika alternativ och ett rätt svar. */
export interface LearnQuestion {
  id: string;
  prompt: string;
  choices: readonly [string, string, string, string];
  correctIndex: number;
  answer: string;
  subject: QuestionSubject;
  grade: GradeId;
  rule: string;
  meta?: QuestionMeta;
  /** Text som läses upp. Saknas: prompten, utom rättstavning som läser svaret. */
  speakText?: string;
  speakLang?: SpeakLang;
  /** Emoji i samma ordning som choices. null om alternativet saknar bild. */
  choiceEmojis?: readonly (string | null)[];
  /** Läs prompten tillsammans med ordet som ska sägas. */
  speakPrompt?: boolean;
}

export interface LearnSettings {
  grade: GradeId;
  subject: SubjectId;
  /** Läs upp frågan. Saknas: på i förskolan, av annars. */
  readAloud?: boolean;
}

export type EncounterKind = 'normal' | 'champion' | 'boss';

const GRADE_IDS = new Set<string>(GRADES.map((g) => g.id));
const SUBJECT_IDS = new Set<string>(SUBJECTS.map((s) => s.id));

export function isGradeId(v: unknown): v is GradeId {
  return typeof v === 'string' && GRADE_IDS.has(v);
}

export function isSubjectId(v: unknown): v is SubjectId {
  return typeof v === 'string' && SUBJECT_IDS.has(v);
}

export const DEFAULT_LEARN_SETTINGS: LearnSettings = { grade: 'ak1', subject: 'blandat', readAloud: false };

/** Sant när alternativet är svaret, även om det visas som «🐶 hund». */
export function choiceMatchesAnswer(choice: string, answer: string): boolean {
  if (choice === answer) return true;
  return choice.endsWith(` ${answer}`);
}

export function questionCount(kind: EncounterKind): number {
  if (kind === 'boss') return 5;
  if (kind === 'champion') return 3;
  return 1;
}

export function encounterKindOf(monster: { boss: boolean; elite?: string | null }): EncounterKind {
  if (monster.boss) return 'boss';
  if (monster.elite === 'champion') return 'champion';
  return 'normal';
}

/** Sant när frågan har fyra unika alternativ och exakt ett rätt. */
export function isValidQuestion(q: LearnQuestion): boolean {
  if (q.choices.length !== 4) return false;
  if (new Set(q.choices).size !== 4) return false;
  if (q.correctIndex < 0 || q.correctIndex > 3) return false;
  const chosen = q.choices[q.correctIndex];
  if (chosen === undefined || !choiceMatchesAnswer(chosen, q.answer)) return false;
  return q.choices.filter((c) => choiceMatchesAnswer(c, q.answer)).length === 1;
}
