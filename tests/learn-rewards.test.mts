/**
 * Belöningar och statistik för lärläget.
 * Kör: npx tsx tests/learn-rewards.test.mts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Rng } from '../src/core/Rng';
import { MemoryStore } from '../src/core/storage';
import { recordLearnAnswer, onLearnAnswer, type LearnAnswerInput, type LearnAnswerResult } from '../src/learn/rewardEvents';
import {
  DAILY_BONUS,
  REWARD_BACKUP_KEY,
  REWARD_STORAGE_KEY,
  COSMETIC_IDS,
  STICKER_IDS,
  STICKER_MOTIF,
  applyLearnAnswer,
  buyCosmetic,
  defaultRewardState,
  equipCosmetic,
  isStickerEarned,
  loadRewards,
  parseRewards,
  saveRewards,
  starsPerCorrect,
  streakFlameKind,
  type RewardState,
  encounterPassThreshold,
} from '../src/learn/rewards';
import {
  MAX_ANSWER_MS,
  STATS_BACKUP_KEY,
  STATS_STORAGE_KEY,
  compactStats,
  defaultStats,
  hardestTypes,
  loadStats,
  parseStats,
  recordAnswer,
  resetStatsQuotaWarning,
  saveStats,
} from '../src/learn/stats';
import { stockholmDate, stockholmTimestamp, weekdayLetter } from '../src/learn/stockholm';
import { ParentView } from '../src/ui/ParentView';
import { RewardHud } from '../src/ui/RewardHud';
import { StickerAlbum } from '../src/ui/StickerAlbum';
import { cosmeticIconUrl, stickerIdUrl } from '../src/ui/rewardArt';

const day1 = new Date('2026-11-09T10:00:00Z');
const day2 = new Date('2026-11-10T10:00:00Z');

function play(store: MemoryStore, n: number, now: Date, extra: Partial<LearnAnswerInput> = {}): LearnAnswerResult[] {
  const out: LearnAnswerResult[] = [];
  for (let i = 0; i < n; i++) {
    out.push(
      recordLearnAnswer(
        {
          correct: true,
          kind: 'normal',
          grade: 'ak1',
          subject: 'matte',
          rule: 'ak1-plus',
          durationMs: 800,
          now,
          ...extra,
        },
        store,
      ),
    );
  }
  return out;
}

assert.equal(stockholmDate(new Date('2026-11-09T21:00:00Z')), '2026-11-09');
assert.equal(stockholmDate(new Date('2026-11-09T23:30:00Z')), '2026-11-10');
assert.equal(stockholmDate(new Date('2026-07-15T21:30:00Z')), '2026-07-15');
assert.equal(stockholmDate(new Date('2026-07-15T22:30:00Z')), '2026-07-16');
assert.match(stockholmTimestamp(new Date('2026-11-09T21:00:00Z')), /^2026-11-09T22:00:00\+01:00$/);
assert.match(stockholmTimestamp(new Date('2026-07-15T21:30:00Z')), /^2026-07-15T23:30:00\+02:00$/);
assert.equal(weekdayLetter('2026-11-09'), 'M');
assert.equal(weekdayLetter('2026-11-10'), 'T');
assert.equal(weekdayLetter('2026-11-11'), 'O');
assert.equal(weekdayLetter('2026-11-12'), 'T');
assert.equal(weekdayLetter('2026-11-13'), 'F');
assert.equal(weekdayLetter('2026-11-14'), 'L');
assert.equal(weekdayLetter('2026-11-15'), 'S');

assert.equal(starsPerCorrect('normal'), 1);
assert.equal(starsPerCorrect('champion'), 2);
assert.equal(starsPerCorrect('boss'), 3);
assert.equal(streakFlameKind(0), null);
assert.equal(streakFlameKind(1), 'liten');
assert.equal(streakFlameKind(2), 'liten');
assert.equal(streakFlameKind(3), 'mellan');
assert.equal(streakFlameKind(6), 'mellan');
assert.equal(streakFlameKind(7), 'stor');
assert.equal(streakFlameKind(20), 'stor');
assert.equal(STICKER_IDS.length, 15);
// Fallback-alias enligt leverans.md (primär grafik är {id}.png)
assert.equal(STICKER_MOTIF.forsta_ratt, 'runsten');
assert.equal(STICKER_MOTIF.streak_5, 'ekorre');
assert.equal(STICKER_MOTIF.streak_10, 'rav');
assert.equal(STICKER_MOTIF.streak_20, 'vargvalp');
assert.equal(STICKER_MOTIF.matte_ak1, 'runsten');
assert.equal(STICKER_MOTIF.svenska_ak1, 'uggla');
assert.equal(STICKER_MOTIF.engelska_ak1, 'korp');
assert.equal(STICKER_MOTIF.las_ak1, 'alg');
assert.equal(STICKER_MOTIF.forskola_stjarna, 'igelkott');
assert.equal(STICKER_MOTIF.champion_3, 'alg');
assert.equal(STICKER_MOTIF.boss_1, 'uggla');
assert.equal(STICKER_MOTIF.blandat_50, 'igelkott');
assert.equal(STICKER_MOTIF.dag_7, 'ekorre');
assert.equal(STICKER_MOTIF.las_ak3, 'vargvalp');
assert.equal(STICKER_MOTIF.alla_amnen, 'korp');
for (const id of STICKER_IDS) {
  assert.ok(STICKER_MOTIF[id], id);
}
for (const id of STICKER_IDS) {
  assert.match(stickerIdUrl(id, true), new RegExp(`/assets/ui/klistermarken/${id}\\.png$`));
  assert.match(stickerIdUrl(id, false), new RegExp(`/assets/ui/klistermarken/${id}_last\\.png$`));
}
for (const id of COSMETIC_IDS) {
  assert.match(cosmeticIconUrl(id), new RegExp(`/assets/ui/kosmetika/${id}_64\\.png$`));
}

{
  const store = new MemoryStore();
  const normal = recordLearnAnswer(
    { correct: true, kind: 'normal', grade: 'ak1', subject: 'matte', rule: 'ak1-plus', durationMs: 10, now: day1 },
    store,
  );
  assert.equal(normal.starsGained, 1);
  const champion = recordLearnAnswer(
    { correct: true, kind: 'champion', grade: 'ak1', subject: 'matte', rule: 'ak1-plus', durationMs: 10, now: day1 },
    store,
  );
  assert.equal(champion.starsGained, 2);
  const boss = recordLearnAnswer(
    { correct: true, kind: 'boss', grade: 'ak1', subject: 'matte', rule: 'ak1-plus', durationMs: 10, now: day1 },
    store,
  );
  assert.equal(boss.starsGained, 3);
  assert.equal(loadRewards(store, day1).stjarnor, 6);
  assert.equal(boss.streak, 3);
}

{
  const store = new MemoryStore();
  play(store, 2, day1);
  const wrong = recordLearnAnswer(
    { correct: false, kind: 'boss', grade: 'ak1', subject: 'matte', rule: 'ak1-plus', durationMs: 10, now: day1 },
    store,
  );
  assert.equal(wrong.starsGained, 0);
  assert.equal(wrong.streak, 0);
  assert.equal(wrong.rewards.stjarnor, 2);
  assert.equal(wrong.rewards.langsta_streak, 2);
  assert.equal(wrong.rewards.dagligt.ratt, 2);
  const again = recordLearnAnswer(
    { correct: true, kind: 'normal', grade: 'ak1', subject: 'matte', rule: 'ak1-plus', durationMs: 10, now: day1 },
    store,
  );
  assert.equal(again.streak, 1);
  assert.equal(again.rewards.stjarnor, 3);
}

{
  const fresh = defaultRewardState(day1);
  const snap = structuredClone(fresh);
  applyLearnAnswer(fresh, { correct: true, kind: 'normal', grade: 'ak1', subject: 'matte', now: day1 });
  assert.deepEqual(fresh, snap);
}

{
  const store = new MemoryStore();
  let heard = 0;
  const off = onLearnAnswer(() => {
    heard += 1;
  });
  const first = play(store, 11, day1);
  assert.equal(heard, 11);
  off();
  assert.equal(first[0]?.unlockedStickers.includes('forsta_ratt'), true);
  assert.equal(first[0]?.toasts.includes('Nytt märke: Första stjärnan!'), true);
  assert.equal(first[4]?.starsGained, 3);
  assert.equal(first[4]?.toasts.includes('Fem i rad!'), true);
  assert.equal(first[4]?.unlockedStickers.includes('streak_5'), true);
  assert.equal(first[9]?.starsGained, 1 + 5 + DAILY_BONUS);
  assert.equal(first[9]?.dailyDone, true);
  assert.equal(first[9]?.toasts.includes('Tio i rad!'), true);
  assert.equal(first[9]?.toasts.includes('Dagens mål är klart!'), true);
  assert.equal(first[9]?.unlockedStickers.includes('streak_10'), true);
  assert.equal(first[10]?.starsGained, 1);
  assert.equal(first[10]?.dailyDone, false);
  assert.equal(loadRewards(store, day1).stjarnor, 11 + 2 + 5 + DAILY_BONUS);
  assert.deepEqual(loadRewards(store, day1).dagar_mal_klart, ['2026-11-09']);

  recordLearnAnswer({ correct: false, kind: 'normal', grade: 'ak1', subject: 'matte', rule: 'ak1-plus', durationMs: 10, now: day1 }, store);
  const second = play(store, 20, day1);
  assert.equal(second[4]?.starsGained, 3);
  assert.equal(second[9]?.starsGained, 6);
  assert.equal(second[9]?.dailyDone, false);
  assert.equal(second[19]?.starsGained, 11);
  assert.equal(second[19]?.toasts.includes('Tjugo i rad!'), true);
  assert.equal(second[19]?.unlockedStickers.includes('streak_20'), true);
  assert.equal(loadRewards(store, day1).dagar_mal_klart.length, 1);
  assert.equal(loadRewards(store, day1).klistermarken.includes('matte_ak1'), true);

  const nextDay = play(store, 10, day2);
  assert.equal(nextDay[9]?.dailyDone, true);
  assert.equal(nextDay[9]?.starsGained, 1 + DAILY_BONUS);
  const rolled = loadRewards(store, day2);
  assert.equal(rolled.dagligt.datum, '2026-11-10');
  assert.equal(rolled.dagligt.ratt, 10);
  assert.equal(rolled.dagligt.mal_klart, true);
  assert.deepEqual(rolled.dagar_mal_klart, ['2026-11-09', '2026-11-10']);
  assert.equal(heard, 11);
}

{
  const made = defaultRewardState(new Date('2026-11-08T12:00:00Z'));
  made.stjarnor = 4;
  made.dagligt = { datum: '2026-11-08', ratt: 4, mal_klart: false };
  const store = new MemoryStore();
  saveRewards(store, made);
  const loaded = loadRewards(store, day1);
  assert.equal(loaded.dagligt.datum, '2026-11-09');
  assert.equal(loaded.dagligt.ratt, 0);
  assert.equal(loaded.dagligt.mal_klart, false);
  assert.equal(loaded.stjarnor, 4);
}

{
  const store = new MemoryStore();
  play(store, 19, day1, { subject: 'svenska', rule: 'ordklass' });
  assert.equal(loadRewards(store, day1).klistermarken.includes('svenska_ak1'), false);
  const last = play(store, 1, day1, { subject: 'svenska', rule: 'ordklass' });
  assert.equal(last[0]?.unlockedStickers.includes('svenska_ak1'), true);
  assert.equal(loadRewards(store, day1).per_amne_niva['svenska:ak1']?.ratt, 20);
}

{
  const store = new MemoryStore();
  play(store, 49, day1, { settingsSubject: 'blandat', subject: 'engelska', rule: 'glosa' });
  assert.equal(isStickerEarned(loadRewards(store, day1), 'blandat_50'), false);
  play(store, 1, day1, { settingsSubject: 'blandat', subject: 'engelska', rule: 'glosa' });
  const rewards = loadRewards(store, day1);
  assert.equal(rewards.blandat_ratt, 50);
  assert.equal(rewards.per_amne_niva['engelska:ak1']?.ratt, 50);
  assert.equal(rewards.per_amne_niva['blandat:ak1'], undefined);
  assert.equal(isStickerEarned(rewards, 'blandat_50'), true);
  assert.equal(rewards.klistermarken.includes('blandat_50'), true);
}

{
  const store = new MemoryStore();
  play(store, 50, day1, { subject: 'matte' });
  const rewards = loadRewards(store, day1);
  assert.equal(rewards.blandat_ratt, 0);
  assert.equal(rewards.klistermarken.includes('blandat_50'), false);
  assert.equal(rewards.klistermarken.includes('matte_ak1'), true);
}

function earned(patch: (state: RewardState) => void, id: Parameters<typeof isStickerEarned>[1], ok: boolean): void {
  const state = defaultRewardState(day1);
  patch(state);
  assert.equal(isStickerEarned(state, id), ok, id);
}

earned(
  (s) => {
    s.ratt_totalt = 0;
  },
  'forsta_ratt',
  false,
);
earned(
  (s) => {
    s.ratt_totalt = 1;
  },
  'forsta_ratt',
  true,
);
earned(
  (s) => {
    s.langsta_streak = 4;
  },
  'streak_5',
  false,
);
earned(
  (s) => {
    s.langsta_streak = 5;
  },
  'streak_5',
  true,
);
earned(
  (s) => {
    s.langsta_streak = 9;
  },
  'streak_10',
  false,
);
earned(
  (s) => {
    s.langsta_streak = 10;
  },
  'streak_10',
  true,
);
earned(
  (s) => {
    s.langsta_streak = 19;
  },
  'streak_20',
  false,
);
earned(
  (s) => {
    s.langsta_streak = 20;
  },
  'streak_20',
  true,
);
earned(
  (s) => {
    s.per_amne_niva['matte:ak1'] = { ratt: 19 };
  },
  'matte_ak1',
  false,
);
earned(
  (s) => {
    s.per_amne_niva['matte:ak1'] = { ratt: 20 };
  },
  'matte_ak1',
  true,
);
earned(
  (s) => {
    s.per_amne_niva['engelska:ak1'] = { ratt: 20 };
  },
  'engelska_ak1',
  true,
);
earned(
  (s) => {
    s.per_amne_niva['lasforstaelse:ak1'] = { ratt: 19 };
  },
  'las_ak1',
  false,
);
earned(
  (s) => {
    s.per_amne_niva['lasforstaelse:ak1'] = { ratt: 20 };
  },
  'las_ak1',
  true,
);
earned(
  (s) => {
    s.per_amne_niva['engelska:forskola'] = { ratt: 14 };
  },
  'forskola_stjarna',
  false,
);
earned(
  (s) => {
    s.per_amne_niva['engelska:forskola'] = { ratt: 10 };
    s.per_amne_niva['matte:forskola'] = { ratt: 5 };
  },
  'forskola_stjarna',
  true,
);
earned(
  (s) => {
    s.champions_ok = 2;
  },
  'champion_3',
  false,
);
earned(
  (s) => {
    s.champions_ok = 3;
  },
  'champion_3',
  true,
);
earned(
  (s) => {
    s.bossar_ok = 0;
  },
  'boss_1',
  false,
);
earned(
  (s) => {
    s.bossar_ok = 1;
  },
  'boss_1',
  true,
);
earned(
  (s) => {
    s.blandat_ratt = 49;
  },
  'blandat_50',
  false,
);
earned(
  (s) => {
    s.blandat_ratt = 50;
  },
  'blandat_50',
  true,
);
earned(
  (s) => {
    s.dagar_mal_klart = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
  },
  'dag_7',
  false,
);
earned(
  (s) => {
    s.dagar_mal_klart = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
  },
  'dag_7',
  true,
);
earned(
  (s) => {
    s.per_amne_niva['lasforstaelse:ak3'] = { ratt: 29 };
  },
  'las_ak3',
  false,
);
earned(
  (s) => {
    s.per_amne_niva['lasforstaelse:ak3'] = { ratt: 30 };
  },
  'las_ak3',
  true,
);
earned(
  (s) => {
    s.per_amne_niva = {
      'matte:ak1': { ratt: 6 },
      'matte:ak2': { ratt: 4 },
      'svenska:ak1': { ratt: 10 },
      'engelska:gymnasiet': { ratt: 10 },
      'lasforstaelse:ak3': { ratt: 9 },
    };
  },
  'alla_amnen',
  false,
);
earned(
  (s) => {
    s.per_amne_niva = {
      'matte:ak1': { ratt: 6 },
      'matte:ak2': { ratt: 4 },
      'svenska:ak1': { ratt: 10 },
      'engelska:gymnasiet': { ratt: 10 },
      'lasforstaelse:ak3': { ratt: 9 },
      'lasforstaelse:ak1': { ratt: 1 },
      'horforstaelse:ak1': { ratt: 10 },
    };
  },
  'alla_amnen',
  true,
);

{
  const store = new MemoryStore();
  recordLearnAnswer(
    {
      correct: true,
      kind: 'champion',
      grade: 'ak1',
      subject: 'matte',
      rule: 'ak1-plus',
      durationMs: 10,
      encounterDone: true,
      encounterCorrect: 2,
      now: day1,
    },
    store,
  );
  assert.equal(loadRewards(store, day1).champions_ok, 0, '2 av 4 räcker inte för champion');
  for (let i = 0; i < 2; i++) {
    recordLearnAnswer(
      {
        correct: true,
        kind: 'champion',
        grade: 'ak1',
        subject: 'matte',
        rule: 'ak1-plus',
        durationMs: 10,
        encounterDone: true,
        encounterCorrect: 3,
        now: day1,
      },
      store,
    );
  }
  assert.equal(loadRewards(store, day1).champions_ok, 2);
  recordLearnAnswer(
    {
      correct: false,
      kind: 'champion',
      grade: 'ak1',
      subject: 'matte',
      rule: 'ak1-plus',
      durationMs: 10,
      encounterDone: true,
      encounterCorrect: 3,
      now: day1,
    },
    store,
  );
  const rewards = loadRewards(store, day1);
  assert.equal(rewards.champions_ok, 3);
  assert.equal(rewards.streak, 0);
  assert.equal(rewards.klistermarken.includes('champion_3'), true);

  recordLearnAnswer(
    {
      correct: true,
      kind: 'boss',
      grade: 'ak1',
      subject: 'matte',
      rule: 'ak1-plus',
      durationMs: 10,
      encounterDone: true,
      encounterCorrect: 4,
      now: day1,
    },
    store,
  );
  assert.equal(loadRewards(store, day1).bossar_ok, 0, '4 av 6 räcker inte för boss');
  recordLearnAnswer(
    {
      correct: true,
      kind: 'normal',
      grade: 'ak1',
      subject: 'matte',
      rule: 'ak1-plus',
      durationMs: 10,
      encounterDone: true,
      encounterCorrect: 1,
      now: day1,
    },
    store,
  );
  assert.equal(loadRewards(store, day1).bossar_ok, 0);
  recordLearnAnswer(
    {
      correct: true,
      kind: 'boss',
      grade: 'ak3',
      subject: 'lasforstaelse',
      rule: 'slutsats',
      durationMs: 1200,
      encounterDone: true,
      encounterCorrect: 5,
      now: day1,
    },
    store,
  );
  const boss = loadRewards(store, day1);
  assert.equal(boss.bossar_ok, 1);
  assert.equal(boss.klistermarken.includes('boss_1'), true);
  assert.equal(boss.per_amne_niva['lasforstaelse:ak3']?.ratt, 1);
  const stats = loadStats(store, day1);
  assert.equal(stats.per_amne_niva['lasforstaelse:ak3']?.typer.slutsats?.ratt, 1);
}

{
  let state = defaultRewardState(day1);
  state.stjarnor = 15;
  const bought = buyCosmetic(state, 'hatt_ull');
  assert.equal(bought.ok, true);
  if (!bought.ok) throw new Error('köp');
  assert.equal(bought.state.stjarnor, 0);
  assert.deepEqual(bought.state.upplast, ['hatt_ull']);
  const again = buyCosmetic(bought.state, 'hatt_ull');
  assert.equal(again.ok, false);
  const poor = buyCosmetic(bought.state, 'hatt_rune');
  assert.equal(poor.ok, false);
  if (poor.ok) throw new Error('för många stjärnor');
  assert.equal(poor.reason, 'stjarnor');
  const on = equipCosmetic(bought.state, 'hatt_ull');
  assert.equal(on.aktiv_hatt, 'hatt_ull');
  const off = equipCosmetic(on, 'hatt_ull');
  assert.equal(off.aktiv_hatt, null);
  assert.equal(equipCosmetic(defaultRewardState(day1), 'mantel_gron').aktiv_mantel, null);
  const locked = buyCosmetic(defaultRewardState(day1), 'hatt_champion');
  assert.equal(locked.ok, false);
  state = defaultRewardState(day1);
  state.stjarnor = 3;
  state.klistermarken = ['champion_3'];
  const free = buyCosmetic(state, 'hatt_champion');
  assert.equal(free.ok, true);
  if (free.ok) assert.equal(free.state.stjarnor, 3);
  const worn = equipCosmetic(free.ok ? free.state : state, 'hatt_champion');
  assert.equal(worn.aktiv_hatt, 'hatt_champion');
  const other = { ...worn, upplast: [...worn.upplast, 'hatt_ull' as const], stjarnor: 0 };
  const swapped = equipCosmetic(other, 'hatt_ull');
  assert.equal(swapped.aktiv_hatt, 'hatt_ull');
}

{
  const store = new MemoryStore();
  recordAnswer(store, {
    correct: true,
    grade: 'ak1',
    subject: 'matte',
    rule: 'ak1-plus',
    durationMs: 1500,
    streak: 1,
    now: day1,
  });
  recordAnswer(store, {
    correct: false,
    grade: 'ak1',
    subject: 'matte',
    rule: 'ak1-minus',
    durationMs: 2500,
    streak: 0,
    now: day1,
  });
  recordAnswer(store, {
    correct: true,
    grade: 'ak2',
    subject: 'lasforstaelse',
    rule: 'varfor',
    durationMs: 1000,
    streak: 4,
    now: day1,
  });
  recordAnswer(store, {
    correct: true,
    grade: 'ak1',
    subject: 'matte',
    rule: 'ak1-plus',
    durationMs: MAX_ANSWER_MS + 50_000,
    streak: 2,
    now: day1,
  });
  const stats = loadStats(store, day1);
  assert.equal(stats.v, 1);
  assert.equal(stats.totalt.ratt, 3);
  assert.equal(stats.totalt.fel, 1);
  assert.equal(stats.totalt.tid_ms, 1500 + 2500 + 1000 + MAX_ANSWER_MS);
  assert.equal(stats.langsta_streak, 4);
  assert.equal(stats.per_amne_niva['matte:ak1']?.ratt, 2);
  assert.equal(stats.per_amne_niva['matte:ak1']?.fel, 1);
  assert.equal(stats.per_amne_niva['matte:ak1']?.typer['ak1-plus']?.ratt, 2);
  assert.equal(stats.per_amne_niva['matte:ak1']?.typer['ak1-minus']?.fel, 1);
  assert.equal(stats.per_amne_niva['lasforstaelse:ak2']?.typer.varfor?.ratt, 1);
  assert.equal(stats.per_dag['2026-11-09']?.ratt, 3);
  assert.equal(stats.per_dag['2026-11-09']?.fel, 1);
  assert.equal(stats.per_dag['2026-11-09']?.langsta_streak, 4);
}

{
  const store = new MemoryStore();
  const add = (rule: string, correct: boolean, subject: 'matte' | 'svenska' = 'matte'): void => {
    recordAnswer(store, { correct, grade: 'ak1', subject, rule, durationMs: 100, streak: 1, now: day1 });
  };
  for (let i = 0; i < 1; i++) add('plus', true);
  for (let i = 0; i < 4; i++) add('plus', false);
  for (let i = 0; i < 4; i++) add('minus', true);
  add('minus', false);
  add('lite', true);
  add('lite', false);
  for (let i = 0; i < 5; i++) add('ord', false, 'svenska');
  const stats = loadStats(store, day1);
  const matte = hardestTypes(stats, 'matte');
  assert.deepEqual(
    matte.map((row) => row.typ),
    ['plus', 'minus'],
  );
  assert.equal(matte[0]?.andel, 0.2);
  assert.equal(matte[0]?.niva, 'ak1');
  assert.equal(
    matte.some((row) => row.typ === 'lite'),
    false,
  );
  const all = hardestTypes(stats);
  assert.equal(all[0]?.typ, 'ord');
  assert.equal(all[0]?.fel, 5);
  assert.equal(all.length, 3);
}

{
  const stats = defaultStats(new Date('2026-01-20T12:00:00Z'));
  for (let day = 1; day <= 20; day++) {
    const key = `2026-01-${String(day).padStart(2, '0')}`;
    stats.per_dag[key] = { ratt: 1, fel: 0, tid_ms: 10, langsta_streak: 1 };
  }
  const trimmed = compactStats(stats);
  const keys = Object.keys(trimmed.per_dag).sort();
  assert.equal(keys.length, 14);
  assert.equal(keys[0], '2026-01-07');
  assert.equal(keys[13], '2026-01-20');
  const store = new MemoryStore();
  store.set(STATS_STORAGE_KEY, JSON.stringify(stats));
  const loaded = loadStats(store, new Date('2026-01-20T12:00:00Z'));
  assert.equal(Object.keys(loaded.per_dag).length, 14);
  const saved = JSON.parse(store.get(STATS_STORAGE_KEY) ?? '{}') as { per_dag: Record<string, unknown> };
  assert.equal(Object.keys(saved.per_dag).length, 14);
  assert.equal(Object.keys(saved.per_dag).sort()[0], '2026-01-07');
}

{
  const stats = defaultStats(day1);
  const typer: Record<string, { ratt: number; fel: number }> = { stor: { ratt: 4, fel: 1 } };
  for (let i = 0; i < 30; i++) typer[`t${i}`] = { ratt: 1, fel: 0 };
  stats.per_amne_niva['matte:ak1'] = { ratt: 34, fel: 1, tid_ms: 0, typer };
  const kept = compactStats(structuredClone(stats), 80_000);
  assert.equal(kept.per_amne_niva['matte:ak1']?.typer.t0?.ratt, 1);
  assert.equal(kept.per_amne_niva['matte:ak1']?.typer._ovrigt, undefined);
  const merged = compactStats(stats, 50);
  assert.equal(merged.per_amne_niva['matte:ak1']?.typer.stor?.ratt, 4);
  assert.equal(merged.per_amne_niva['matte:ak1']?.typer._ovrigt?.ratt, 30);
  assert.equal(merged.per_amne_niva['matte:ak1']?.typer.t0, undefined);
}

{
  const learn = '{"grade":"ak1","subject":"matte","readAloud":false}';
  const store = new MemoryStore();
  store.set('rk_laro', learn);
  store.set(REWARD_STORAGE_KEY, JSON.stringify({ v: 4, stjarnor: 9 }));
  const fresh = loadRewards(store, day1);
  assert.equal(fresh.stjarnor, 0);
  assert.equal(fresh.v, 1);
  assert.match(store.get(REWARD_BACKUP_KEY) ?? '', /"v":4/);
  store.set(REWARD_STORAGE_KEY, JSON.stringify({ v: 8, stjarnor: 3 }));
  loadRewards(store, day1);
  const backup = store.get(REWARD_BACKUP_KEY) ?? '';
  assert.match(backup, /"v":4/);
  assert.equal(backup.includes('"v":8'), false);
  assert.equal(store.get('rk_laro'), learn);

  store.set(REWARD_STORAGE_KEY, '{');
  loadRewards(store, day1);
  assert.match(store.get(REWARD_BACKUP_KEY) ?? '', /"v":4/);
  const replaced = JSON.parse(store.get(REWARD_STORAGE_KEY) ?? '{}') as { v: number };
  assert.equal(replaced.v, 1);
  assert.equal(store.get('rk_laro'), learn);
}

{
  const broken = new MemoryStore();
  broken.set(REWARD_STORAGE_KEY, '{');
  loadRewards(broken, day1);
  assert.equal(broken.get(REWARD_BACKUP_KEY), '{');
  const statsStore = new MemoryStore();
  statsStore.set('rk_laro', 'kvar');
  statsStore.set(STATS_STORAGE_KEY, JSON.stringify({ v: 2, totalt: { ratt: 5 } }));
  const empty = loadStats(statsStore, day1);
  assert.equal(empty.totalt.ratt, 0);
  assert.match(statsStore.get(STATS_BACKUP_KEY) ?? '', /"v":2/);
  statsStore.set(STATS_STORAGE_KEY, 'inte json');
  loadStats(statsStore, day1);
  assert.match(statsStore.get(STATS_BACKUP_KEY) ?? '', /"v":2/);
  assert.equal(statsStore.get('rk_laro'), 'kvar');
  assert.equal(parseStats({ v: 1, totalt: { ratt: 2, fel: 1, tid_ms: 5 } })?.totalt.ratt, 2);
  assert.equal(parseStats({ v: 3 }), null);
  assert.equal(parseStats('{'), null);
  assert.equal(parseRewards({ v: 1, stjarnor: -4, streak: 1.9, aktiv_hatt: 'hatt_ull' }, day1)?.stjarnor, 0);
  assert.equal(parseRewards({ v: 1, streak: 1.9 }, day1)?.streak, 1);
  assert.equal(parseRewards({ v: 1, aktiv_hatt: 'hatt_ull', upplast: ['hatt_ull'] }, day1)?.aktiv_hatt, 'hatt_ull');
  assert.equal(parseRewards({ v: 1, aktiv_hatt: 'hatt_ull' }, day1)?.aktiv_hatt, null);
  assert.equal(parseRewards({ v: 0 }), null);
  assert.equal(parseRewards(null), null);
}

{
  resetStatsQuotaWarning();
  class AlwaysQuota extends MemoryStore {
    override set(key: string, value: string): void {
      if (key === STATS_STORAGE_KEY) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      super.set(key, value);
    }
  }
  const quota = new AlwaysQuota();
  const first = saveStats(quota, defaultStats(day1));
  assert.equal(first.ok, false);
  assert.equal(first.warning, 'Kunde inte spara statistik');
  const second = saveStats(quota, defaultStats(day1));
  assert.equal(second.ok, false);
  assert.equal(second.warning, null);

  resetStatsQuotaWarning();
  class DropDays extends MemoryStore {
    override set(key: string, value: string): void {
      if (key === STATS_STORAGE_KEY) {
        const parsed = JSON.parse(value) as { per_dag?: Record<string, unknown> };
        if (Object.keys(parsed.per_dag ?? {}).length > 2) {
          const err = new Error('QuotaExceededError');
          err.name = 'QuotaExceededError';
          throw err;
        }
      }
      super.set(key, value);
    }
  }
  const drop = new DropDays();
  const stats = defaultStats(new Date('2026-03-05T12:00:00Z'));
  for (let day = 1; day <= 5; day++) {
    stats.per_dag[`2026-03-0${day}`] = { ratt: day, fel: 0, tid_ms: 1, langsta_streak: 1 };
  }
  const saved = saveStats(drop, stats);
  assert.equal(saved.ok, true);
  assert.equal(saved.warning, 'Kunde inte spara statistik');
  const raw = JSON.parse(drop.get(STATS_STORAGE_KEY) ?? '{}') as { per_dag: Record<string, unknown> };
  assert.deepEqual(Object.keys(raw.per_dag).sort(), ['2026-03-04', '2026-03-05']);
}

function installDom(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const g = globalThis as unknown as Record<string, unknown>;
  const win = dom.window as unknown as Record<string, unknown>;
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLSelectElement', 'Node', 'Event']) {
    g[key] = win[key];
  }
}

function parentText(): string {
  return document.querySelector('.rk-parent')?.textContent ?? '';
}

function gateProduct(): number {
  const sum = document.querySelector('.rk-gate .sum')?.textContent ?? '';
  const match = /(\d+)\s*×\s*(\d+)/.exec(sum);
  assert.ok(match, sum);
  return Number(match[1]) * Number(match[2]);
}

function clickButton(text: string): void {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === text);
  assert.ok(btn instanceof HTMLButtonElement, text);
  btn.click();
}

function fillGate(value: string): void {
  const input = document.querySelector('.rk-gate input');
  assert.ok(input instanceof HTMLInputElement);
  input.value = value;
  clickButton('Svara');
}

installDom();

{
  const store = new MemoryStore();
  const parent = new ParentView(store, {}, new Rng(3));
  parent.open();
  assert.match(parentText(), /Vad är \d+ × \d+/);
  fillGate('0');
  assert.match(parentText(), /Fel svar/);
  assert.match(parentText(), /Försök 2 av 3/);
  fillGate(String(gateProduct()));
  assert.match(parentText(), /Översikt/);
  assert.match(parentText(), /Inga svar ännu/);
  assert.match(parentText(), /Dagens mål/);
  clickButton('Nollställ statistik');
  assert.match(parentText(), /Svara först/);
  fillGate(String(gateProduct()));
  assert.match(parentText(), /Skriv NOLLSTÄLL/);
  const word = document.querySelector('input[aria-label="Skriv NOLLSTÄLL"]');
  assert.ok(word instanceof HTMLInputElement);
  word.value = 'nej';
  clickButton('Nollställ');
  assert.match(parentText(), /Skriv ordet NOLLSTÄLL/);
  const again = document.querySelector('input[aria-label="Skriv NOLLSTÄLL"]');
  assert.ok(again instanceof HTMLInputElement);
  again.value = 'NOLLSTÄLL';
  const box = document.querySelector('input[type="checkbox"]');
  assert.ok(box instanceof HTMLInputElement);
  assert.equal(box.checked, false);
  clickButton('Nollställ');
  assert.match(parentText(), /Statistiken är nollställd/);
  assert.match(parentText(), /Stjärnor och märken är kvar/);
  parent.dispose();
}

{
  const store = new MemoryStore();
  const state = defaultRewardState(day1);
  state.stjarnor = 15;
  saveRewards(store, state);
  const album = new StickerAlbum(store);
  album.open();
  const imgs = [...document.querySelectorAll('.rk-sticker img')];
  assert.equal(imgs.length, 15);
  assert.ok(imgs.every((img) => (img.getAttribute('src') ?? '').includes('_last')));
  clickButton('Köp 15');
  assert.match(document.querySelector('.rk-album')?.textContent ?? '', /Ullmössa är din/);
  assert.equal(loadRewards(store, day1).stjarnor, 0);
  assert.equal(loadRewards(store, day1).upplast.includes('hatt_ull'), true);
  clickButton('Ta på');
  assert.equal(loadRewards(store, day1).aktiv_hatt, 'hatt_ull');
  const host = document.createElement('div');
  document.body.append(host);
  const hud = new RewardHud(host);
  hud.render(loadRewards(store, day1));
  assert.match(hud.root.textContent ?? '', /Idag 0\/10/);
  assert.match(hud.root.textContent ?? '', /Ullmössa/);
  const srcs = [...hud.root.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '');
  assert.ok(srcs.some((src) => src.includes('stjarna_tom_64')));
  hud.render({ ...loadRewards(store, day1), stjarnor: 2, streak: 8, dagligt: { datum: '2026-11-09', ratt: 7, mal_klart: false } });
  const lit = [...hud.root.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '');
  assert.ok(lit.some((src) => src.includes('stjarna_64') && !src.includes('tom')));
  assert.ok(lit.some((src) => src.includes('streak_flamma_stor')));
  assert.match(hud.root.textContent ?? '', /Idag 7\/10/);
  hud.dispose();
  album.dispose();
}

console.log('learn-rewards.test.mts: ok');

// Trösklarna följer antalet frågor per möte (normal 1, champion 4, boss 6).
assert.equal(encounterPassThreshold('champion'), 3);
assert.equal(encounterPassThreshold('boss'), 5);
