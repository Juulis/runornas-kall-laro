import type { KeyValueStore } from '../core/storage';
import { LocalStore, MemoryStore } from '../core/storage';
import type { EncounterKind, GradeId, SubjectId } from './types';
import { applyLearnAnswer, loadRewards, saveRewards, type RewardState, type RewardSubject, type StickerId } from './rewards';
import { loadStats, applyStatsAnswer, saveStats } from './stats';

export interface LearnAnswerInput {
  correct: boolean;
  kind: EncounterKind;
  grade: GradeId;
  /** Faktiskt ämne på frågan, aldrig blandat. */
  subject: RewardSubject;
  rule: string;
  durationMs: number;
  /** Inställningens ämne. Kan vara blandat. */
  settingsSubject?: SubjectId;
  /** Sant på sista frågan i ett champion- eller bossmöte. */
  encounterDone?: boolean;
  /** Rätt i mötet efter den här frågan. */
  encounterCorrect?: number;
  now?: Date;
}

export interface LearnAnswerResult {
  starsGained: number;
  streak: number;
  unlockedStickers: StickerId[];
  toasts: string[];
  dailyDone: boolean;
  rewards: RewardState;
  statsWarning: string | null;
}

export type LearnAnswerListener = (result: LearnAnswerResult) => void;

const listeners = new Set<LearnAnswerListener>();

/** Prenumerera på varje sparat svar. Returnerar en avprenumerering. */
export function onLearnAnswer(listener: LearnAnswerListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(result: LearnAnswerResult): void {
  for (const listener of listeners) {
    try {
      listener(result);
    } catch (err) {
      console.warn('Belöningslyssnare fel', err);
    }
  }
}

let memoryStore: KeyValueStore | null = null;

function defaultStore(): KeyValueStore {
  try {
    if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage) {
      return new LocalStore(globalThis.localStorage);
    }
  } catch {
    /* testmiljö utan localStorage */
  }
  memoryStore ??= new MemoryStore();
  return memoryStore;
}

/**
 * En inkopplingspunkt: stjärnor, streak, märken och statistik.
 * Lyssnare får samma resultat som returvärdet.
 */
export function recordLearnAnswer(input: LearnAnswerInput, store?: KeyValueStore): LearnAnswerResult {
  const used = store ?? defaultStore();
  const now = input.now ?? new Date();
  const applied = applyLearnAnswer(loadRewards(used, now), { ...input, now });
  saveRewards(used, applied.state);
  const stats = applyStatsAnswer(loadStats(used, now), {
    correct: input.correct,
    grade: input.grade,
    subject: input.subject,
    rule: input.rule,
    durationMs: input.durationMs,
    streak: applied.streak,
    now,
  });
  const saved = saveStats(used, stats);
  const result: LearnAnswerResult = {
    starsGained: applied.starsGained,
    streak: applied.streak,
    unlockedStickers: applied.unlockedStickers,
    toasts: applied.toasts,
    dailyDone: applied.dailyDone,
    rewards: applied.state,
    statsWarning: saved.warning,
  };
  emit(result);
  return result;
}
