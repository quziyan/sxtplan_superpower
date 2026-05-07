import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getDefaultAdapterKey } from '@/dispatch/constants'
import { resetEnvCacheForTests } from '@/env'

describe('getDefaultAdapterKey', () => {
  let snapshot: Record<string, string | undefined>

  beforeEach(() => {
    snapshot = {
      CAMERA_BACKEND_KIND: process.env.CAMERA_BACKEND_KIND,
      SIMULATED_GZP_ENABLED: process.env.SIMULATED_GZP_ENABLED,
    }
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(snapshot)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    resetEnvCacheForTests()
  })

  test('returns "real-gzp" when CAMERA_BACKEND_KIND=real-gzp', () => {
    process.env.CAMERA_BACKEND_KIND = 'real-gzp'
    resetEnvCacheForTests()
    expect(getDefaultAdapterKey()).toBe('real-gzp')
  })

  test('returns "simulated-gzp" when CAMERA_BACKEND_KIND=simulated-gzp', () => {
    process.env.CAMERA_BACKEND_KIND = 'simulated-gzp'
    resetEnvCacheForTests()
    expect(getDefaultAdapterKey()).toBe('simulated-gzp')
  })

  test('falls back to SIMULATED_GZP_ENABLED=true → simulated-gzp', () => {
    delete process.env.CAMERA_BACKEND_KIND
    process.env.SIMULATED_GZP_ENABLED = 'true'
    resetEnvCacheForTests()
    expect(getDefaultAdapterKey()).toBe('simulated-gzp')
  })

  test('returns "mock" when nothing set', () => {
    delete process.env.CAMERA_BACKEND_KIND
    delete process.env.SIMULATED_GZP_ENABLED
    resetEnvCacheForTests()
    expect(getDefaultAdapterKey()).toBe('mock')
  })

  test('CAMERA_BACKEND_KIND=mock wins over SIMULATED_GZP_ENABLED=true', () => {
    process.env.CAMERA_BACKEND_KIND = 'mock'
    process.env.SIMULATED_GZP_ENABLED = 'true'
    resetEnvCacheForTests()
    expect(getDefaultAdapterKey()).toBe('mock')
  })
})
