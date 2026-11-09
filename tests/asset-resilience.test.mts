/**
 * Resilient asset-laddning: retry + fallback så start inte blockeras.
 * Kör: npx tsx tests/asset-resilience.test.mts
 */
import assert from 'node:assert/strict';

const im = import.meta as ImportMeta & { env?: { BASE_URL?: string } };
im.env = { ...im.env, BASE_URL: im.env?.BASE_URL ?? '/runornas-kall-laro/' };

const { withRetries, fetchJsonResilient } = await import('../src/render/resilientAssets');

let attempts = 0;
const ok = await withRetries(
  'test-retry',
  async () => {
    attempts++;
    if (attempts < 3) throw new TypeError('Failed to fetch');
    return 'ok';
  },
  () => 'fallback',
);
assert.equal(ok, 'ok');
assert.equal(attempts, 3);

let fails = 0;
const fb = await withRetries(
  'test-fail',
  async () => {
    fails++;
    throw new Error('404');
  },
  () => 0,
);
assert.equal(fb, 0);
assert.equal(fails, 3);

const origFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL) => {
  const u = String(input);
  if (u.includes('saknad-tile.png')) return new Response(null, { status: 404 });
  return origFetch(input);
};

const data = await fetchJsonResilient<{ x: number }>('2d/tiles/saknad-tile.png', { x: 1 });
assert.deepEqual(data, { x: 1 });

globalThis.fetch = origFetch;

console.log('ASSET_RESILIENCE_OK');
