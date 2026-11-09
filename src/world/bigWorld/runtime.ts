export type BigWorldRuntime = typeof import('./runtimeApi');

let cached: BigWorldRuntime | null = null;
let pending: Promise<BigWorldRuntime> | null = null;

export function peekBigWorldRuntime(): BigWorldRuntime | null {
  return cached;
}

export function bigWorldRuntime(): BigWorldRuntime {
  if (!cached) throw new Error('Stor värld är inte laddad');
  return cached;
}

/** Laddar markstreaming och regionkatalog en gång. Misslyckad import kan försökas igen. */
export function loadBigWorldRuntime(): Promise<BigWorldRuntime> {
  if (cached) return Promise.resolve(cached);
  pending ??= import('./runtimeApi')
    .then((mod) => {
      cached = mod;
      return mod;
    })
    .catch((err: unknown) => {
      pending = null;
      throw err;
    });
  return pending;
}
