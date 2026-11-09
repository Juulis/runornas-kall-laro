import type { GameContext, GameModule } from '../core/GameContext';
import { trackChunkLoad } from '../ui/chunkLoad';

/**
 * Laddar en modul först när den behövs (efter menyn, eller strax därefter).
 * Misslyckad import visar retry och lämnar spelet igång.
 */
export function deferredModule(label: string, load: () => Promise<GameModule>): GameModule {
  let impl: GameModule | null = null;
  let ctx: GameContext | null = null;
  let started = false;

  const boot = (): void => {
    if (started || !ctx) return;
    started = true;
    const context = ctx;
    void trackChunkLoad(label, async (onProgress) => {
      onProgress(0.2);
      const mod = await load();
      onProgress(0.85);
      impl = mod;
      mod.init(context);
      onProgress(1);
      const extra = mod as GameModule & { reveal?: () => void };
      if (context.hero.playing) extra.reveal?.();
    });
  };

  return {
    init(next) {
      ctx = next;
      const bus = next.bus;
      bus.on('ui_open', ({ panel }) => {
        if (panel === 'menu') boot();
      });
      bus.on('ui_close', ({ panel }) => {
        if (panel === 'menu') boot();
      });
      setTimeout(boot, 50);
    },
    dispose() {
      impl?.dispose();
      impl = null;
      ctx = null;
    },
  };
}
