import { defineConfig } from 'vite';

/** Lärversionen publiceras på /runornas-kall-laro/. */
export default defineConfig({
  base: '/runornas-kall-laro/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          return chunkName(id.replaceAll('\\', '/')) ?? undefined;
        },
        // Rolldown ignorerar manualChunks om codeSplitting också är satt.
        // Gruppen gör samma uppdelning, men utan att sluka delade moduler
        // (annars laddas learn/world redan med entry).
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            {
              debugName: 'manual-chunks',
              name(id: string) {
                return chunkName(id.replaceAll('\\', '/'));
              },
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
    },
  },
  server: { port: 5173 },
});

/**
 * Delar upp bundlen. Fråge-JSON och lär-strid laddas med import() först när ämnet valts.
 */
function chunkName(id: string): string | null {
  if (id.includes('node_modules/pixi.js') || id.includes('node_modules/@pixi/')) return 'pixi';
  if (id.includes('/fragor_svenska.json')) return 'learn-data-svenska';
  if (id.includes('/fragor_engelska.json')) return 'learn-data-engelska';
  if (/\/src\/learn\/(LearnEncounter|questions|bank|mathQuestions|damage|speech|choices)\.ts$/.test(id)) return 'learn';
  if (id.includes('/src/ui/LearnOverlay.ts')) return 'learn';
  if (isWorldChunk(id)) return 'world';
  if (id.includes('/src/data/') && id.endsWith('.json')) return 'game-data';
  return null;
}

/** Bara moduler som enbart nås via dynamisk import. Delade filer får inte dras in här. */
function isWorldChunk(id: string): boolean {
  return (
    id.includes('/src/world/bigWorld/worldGenerator.ts') ||
    id.includes('/src/world/bigWorld/runtimeApi.ts') ||
    id.includes('/src/world/bigWorld/heroRegion.ts') ||
    id.includes('/src/world/bigWorld/BigWorldStreamGround.ts') ||
    id.includes('/src/world/bigWorld/chunkCache.ts') ||
    id.includes('/src/world/bigWorld/biomeBlend.ts') ||
    id.includes('/src/world/bigWorld/groundTiles.ts') ||
    id.includes('/src/world/bigWorld/groundPatchBounds.ts') ||
    id.includes('/src/world/bigWorld/roads.ts')
  );
}
