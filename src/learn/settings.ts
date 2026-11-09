import { isRecord } from '../core/json';
import type { KeyValueStore } from '../core/storage';
import { DEFAULT_LEARN_SETTINGS, isGradeId, isSubjectId, type LearnSettings } from './types';

/** Global inställning (localStorage). Sparfilen har samma fält per hjälte. */
export const LEARN_STORAGE_KEY = 'rk_laro';

export function parseLearnSettings(raw: unknown): LearnSettings | null {
  if (!isRecord(raw)) return null;
  if (!isGradeId(raw.grade) || !isSubjectId(raw.subject)) return null;
  return { grade: raw.grade, subject: raw.subject };
}

export function readLearnSettings(store: KeyValueStore): LearnSettings {
  try {
    const raw = store.get(LEARN_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LEARN_SETTINGS };
    return parseLearnSettings(JSON.parse(raw) as unknown) ?? { ...DEFAULT_LEARN_SETTINGS };
  } catch {
    return { ...DEFAULT_LEARN_SETTINGS };
  }
}

export function writeLearnSettings(store: KeyValueStore, settings: LearnSettings): void {
  const parsed = parseLearnSettings(settings) ?? DEFAULT_LEARN_SETTINGS;
  store.set(LEARN_STORAGE_KEY, JSON.stringify(parsed));
}
