import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getAdapter, initAdapterPool, resetAdapterPoolForTests } from '@/dispatch/adapter-pool'
import { resetEnvCacheForTests } from '@/env'
import { SimulatedGuangzhouPoliceCamAdapter } from '@/dispatch/adapters/simulated-gzp'

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
