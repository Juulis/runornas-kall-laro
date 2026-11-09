import type { LearnSettings } from './types';
import { trackChunkLoad } from '../ui/chunkLoad';

const jobs = new Map<string, Promise<void>>();

function keyOf(settings: Pick<LearnSettings, 'subject'>): string {
  if (settings.subject === 'matte') return 'matte';
  if (settings.subject === 'blandat') return 'svenska+engelska';
  return settings.subject;
}

/**
 * Laddar lär-modulen och frågebankerna för valt ämne. Matte hämtar ingen JSON.
 * Samma ämne delar pågående löfte. Fel visas med retry och löftet väntar på lyckat försök.
 */
export function preloadLearnForPlay(settings: LearnSettings, onProgress?: (ratio: number) => void): Promise<void> {
  const key = keyOf(settings);
  const existing = jobs.get(key);
  if (existing) return existing;
  const job = trackChunkLoad('Laddar frågor…', async (report) => {
    const step = (ratio: number): void => {
      report(ratio);
      onProgress?.(ratio);
    };
    step(0.08);
    const bank = await import('./bank');
    step(0.34);
    await import('./LearnEncounter');
    step(0.5);
    await bank.preloadLearnBanks(settings, (ratio) => step(0.5 + ratio * 0.5));
    step(1);
  });
  jobs.set(key, job);
  return job;
}
