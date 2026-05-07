import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getAdapter,
  initAdapterPool,
  registerAdapter,
  resetAdapterPoolForTests,
} from '@/dispatch/adapter-pool'
import { resetEnvCacheForTests } from '@/env'
import { SimulatedGuangzhouPoliceCamAdapter } from '@/dispatch/adapters/simulated-gzp'
import type {
  CameraAdapter,
  CancelAck,
  DispatchAck,
  DispatchRequest,
  DispatchStatus,
} from '@/dispatch/types'

const KEYS = [
  'SIMULATED_GZP_ENABLED',
  'SIMULATED_GZP_API_KEY',
  'SIMULATED_GZP_WEBHOOK_URL',
  'SIMULATED_GZP_FAKE_MEDIA_BASE',
] as const
let snapshot: Record<string, string | undefined> = {}

beforeEach(() => {
  snapshot = Object.fromEntries(KEYS.map(k => [k, process.env[k]]))
})

afterEach(() => {
  for (const k of KEYS) {
    if (snapshot[k] === undefined) delete process.env[k]
    else process.env[k] = snapshot[k]
  }
  resetEnvCacheForTests()
  resetAdapterPoolForTests()
  initAdapterPool()
})

describe('adapter-pool env-driven registration', () => {
  test('mock adapter is always registered', () => {
    delete process.env.SIMULATED_GZP_ENABLED
    resetEnvCacheForTests()
    resetAdapterPoolForTests()
    initAdapterPool()
    expect(getAdapter('mock').key).toBe('mock')
  })

  test('simulated-gzp NOT registered when SIMULATED_GZP_ENABLED=false (default)', () => {
    process.env.SIMULATED_GZP_ENABLED = 'false'
    resetEnvCacheForTests()
    resetAdapterPoolForTests()
    initAdapterPool()
    expect(() => getAdapter('simulated-gzp')).toThrow(/not registered/)
  })

  test('simulated-gzp IS registered when SIMULATED_GZP_ENABLED=true', () => {
    process.env.SIMULATED_GZP_ENABLED = 'true'
    resetEnvCacheForTests()
    resetAdapterPoolForTests()
    initAdapterPool()
    const a = getAdapter('simulated-gzp')
    expect(a.key).toBe('simulated-gzp')
    expect(a).toBeInstanceOf(SimulatedGuangzhouPoliceCamAdapter)
  })
})

// au-T6 retrofit semantics — verify the makePool-backed pool behaves like the
// prior single-Map registry under the public API contract m3 callers depend on.
describe('adapter-pool retrofit semantics (au-T6 / makePool)', () => {
  test('getAdapter lazy-reinitializes after resetAdapterPoolForTests (no "not initialized" leak)', () => {
    // Reset wipes _pool to null. Next getAdapter() call must lazy-init from
    // env, NOT throw "Pool not initialized" (the makePool internal error).
    resetAdapterPoolForTests()
    // Critical: do NOT call initAdapterPool() — we are testing the lazy path.
    const a = getAdapter('mock')
    expect(a.key).toBe('mock')
  })

  test('registerAdapter overlay takes precedence over env-derived factory instance', () => {
    process.env.SIMULATED_GZP_ENABLED = 'true'
    resetEnvCacheForTests()
    resetAdapterPoolForTests()
    initAdapterPool()
    // Baseline: env-derived simulated-gzp is the real adapter class.
    expect(getAdapter('simulated-gzp')).toBeInstanceOf(SimulatedGuangzhouPoliceCamAdapter)

    // Inject a stub under the same key — getAdapter() must return the stub
    // (this is the contract m3 e2e test relies on to swap delays).
    class StubGzp implements CameraAdapter {
      readonly key = 'simulated-gzp'
      async dispatch(_req: DispatchRequest): Promise<DispatchAck> {
        return { externalId: 'stub-ext', acceptedAt: new Date().toISOString() }
      }
      async cancel(externalId: string, _idem: string): Promise<CancelAck> {
        return { externalId, cancelledAt: new Date().toISOString() }
      }
      async pollStatus(externalId: string): Promise<DispatchStatus> {
        return { externalId, state: 'IN_PROGRESS' }
      }
    }
    const stub = new StubGzp()
    registerAdapter(stub)
    expect(getAdapter('simulated-gzp')).toBe(stub)
    expect(getAdapter('simulated-gzp')).not.toBeInstanceOf(SimulatedGuangzhouPoliceCamAdapter)
    // Mock still resolves from the pool — overrides are key-scoped, not pool-wide.
    expect(getAdapter('mock').key).toBe('mock')
  })
})
