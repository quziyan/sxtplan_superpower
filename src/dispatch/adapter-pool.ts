import type { CameraAdapter } from './types'
import { MockCameraAdapter } from './adapters/mock'
import { SimulatedGuangzhouPoliceCamAdapter } from './adapters/simulated-gzp'
import { loadEnv } from '@/env'
import { makePool, type Pool } from '@/integrations/external-adapter'

/**
 * Camera adapter pool — retrofitted onto `makePool` (au-T6).
 *
 * Public surface preserved verbatim for m3 callers (T08-T19, T34 e2e):
 *   - `getAdapter(key)`         — lookup by key
 *   - `registerAdapter(adapter)` — overlay a pre-built instance (test escape hatch;
 *                                  used by tests/dispatch/cancel-flow.test.ts and
 *                                  tests/e2e/m3-full-flow.test.ts to inject spies
 *                                  and short-delay variants)
 *   - `initAdapterPool()`        — env-driven (re)build of the pool
 *   - `resetAdapterPoolForTests()` — clears pool + overrides
 *
 * Internal architecture:
 *   - `_pool` (a `Pool<CameraAdapter>` from `makePool`) holds the env-derived
 *     factories (mock + optionally simulated-gzp).
 *   - `_overrides` is a side Map that `registerAdapter()` writes to. `getAdapter`
 *     checks overrides FIRST, so tests can replace `simulated-gzp` with a
 *     short-delay variant or register fresh keys like `spy` without rebuilding
 *     the whole pool.
 *
 * Auto-init at module load preserves the m3 contract that callers can grab an
 * adapter without an explicit `initAdapterPool()` call (server.ts startup also
 * calls it, so the auto-init is belt-and-suspenders).
 */

let _pool: Pool<CameraAdapter> | null = null
const _overrides = new Map<string, CameraAdapter>()

export function initAdapterPool(): void {
  const env = loadEnv()
  const factories: Record<string, () => CameraAdapter> = {
    mock: () => new MockCameraAdapter(),
  }

  const alsoRegister: string[] = []

  if (env.SIMULATED_GZP_ENABLED === 'true') {
    factories['simulated-gzp'] = () =>
      new SimulatedGuangzhouPoliceCamAdapter({
        apiKey: env.SIMULATED_GZP_API_KEY,
        webhookSecret: env.WEBHOOK_HMAC_SECRET,
        webhookUrl: env.SIMULATED_GZP_WEBHOOK_URL,
        fakeMediaBaseUrl: env.SIMULATED_GZP_FAKE_MEDIA_BASE,
        // Production delays — m3 e2e overrides via registerAdapter() below.
        inProgressDelayMs: 5000,
        completedDelayMs: 30000,
        cancelDelayMs: 5000,
      })
    alsoRegister.push('simulated-gzp')
  }

  _pool = makePool<CameraAdapter>({
    factories,
    defaultKey: 'mock',
    ...(alsoRegister.length > 0 ? { alsoRegister } : {}),
  })
  _pool.init()
  // Overrides survive re-init by design — cancel-flow.test.ts re-calls
  // initAdapterPool() in beforeEach AFTER registerAdapter(spy) in some flows;
  // however current tests reset overrides via resetAdapterPoolForTests() first.
  // We do NOT clear overrides here to keep the contract stable: explicit reset
  // is the only way to clear, matching the prior single-Map behavior where
  // initAdapterPool() called .clear() then re-added defaults — overrides
  // registered AFTER initAdapterPool() persist until reset.
}

/**
 * Overlay a pre-built adapter instance. Used by tests to inject spies or
 * replace env-derived adapters (e.g. short-delay simulated-gzp). Takes
 * precedence over the pool's factory-built instances on getAdapter() lookups.
 */
export function registerAdapter(adapter: CameraAdapter): void {
  _overrides.set(adapter.key, adapter)
}

export function getAdapter(key: string): CameraAdapter {
  if (!_pool) initAdapterPool()
  const override = _overrides.get(key)
  if (override) return override
  try {
    // _pool is non-null after the lazy init above; assert for the type system.
    return _pool!.get(key)
  } catch {
    // Preserve the historical error message m3 callers + tests grep for.
    throw new Error(`adapter '${key}' not registered`)
  }
}

/** Test helper: clears the pool + overrides. Pair with resetEnvCacheForTests() then call initAdapterPool(). */
export function resetAdapterPoolForTests(): void {
  _pool = null
  _overrides.clear()
}

// Auto-initialize at module load (registers Mock + optionally simulated-gzp)
initAdapterPool()
