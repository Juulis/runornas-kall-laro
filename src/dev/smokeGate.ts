/** Dev, capture-bygge eller ?smoke=1 — DOM-metrics för röktest. */
export function smokeMetricsEnabled(): boolean {
  const env = import.meta.env as { DEV?: boolean; VITE_CAPTURE_HOOK?: string } | undefined;
  if (env?.DEV) return true;
  if (env?.VITE_CAPTURE_HOOK === 'true') return true;
  return smokeQueryEnabled();
}

/** Bara ?smoke=1, inte hela dev-läget. Används så röktestet kan gå ur lägret utan att frågor låser gången. */
export function smokeQueryEnabled(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('smoke') === '1';
}

/** Teleport m.m. — endast dev/capture, inte ?smoke=1 i prod. */
export function captureSmokeHooksEnabled(): boolean {
  const env = import.meta.env as { DEV?: boolean; VITE_CAPTURE_HOOK?: string } | undefined;
  if (env?.DEV) return true;
  return env?.VITE_CAPTURE_HOOK === 'true';
}

/** @deprecated use smokeMetricsEnabled */
export function smokeOrCaptureEnabled(): boolean {
  return smokeMetricsEnabled();
}
