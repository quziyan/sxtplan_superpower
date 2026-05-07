import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetEnvCacheForTests } from '@/env'
import {
  getOssAdapter,
  initOssAdapter,
  resetOssAdapterForTests,
} from '@/media/oss-adapter-pool'
import { AliyunOssAdapter } from '@/media/adapters/aliyun-oss'
import { MockOssAdapter } from '@/media/adapters/mock-oss'

const KEYS = [
  'OSS_ADAPTER_KEY',
  'OSS_ENDPOINT',
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
  'OSS_BUCKET',
] as const
let snapshot: Record<string, string | undefined> = {}

beforeEach(() => {
  snapshot = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  resetEnvCacheForTests()
  resetOssAdapterForTests()
})

afterEach(() => {
  for (const k of KEYS) {
    if (snapshot[k] === undefined) delete process.env[k]
    else process.env[k] = snapshot[k]
  }
  resetEnvCacheForTests()
  resetOssAdapterForTests()
})

describe('oss-adapter-pool', () => {
  test('initOssAdapter with OSS_ADAPTER_KEY=mock returns MockOssAdapter', () => {
    process.env.OSS_ADAPTER_KEY = 'mock'
    resetEnvCacheForTests()
    resetOssAdapterForTests()

    const adapter = initOssAdapter()
    expect(adapter).toBeInstanceOf(MockOssAdapter)
    expect(adapter.key).toBe('mock')
  })

  test('initOssAdapter with OSS_ADAPTER_KEY=aliyun returns AliyunOssAdapter', () => {
    process.env.OSS_ADAPTER_KEY = 'aliyun'
    process.env.OSS_ENDPOINT = 'https://oss-cn-shenzhen.aliyuncs.com'
    process.env.OSS_ACCESS_KEY_ID = 'fake-ak-id'
    process.env.OSS_ACCESS_KEY_SECRET = 'fake-ak-secret'
    process.env.OSS_BUCKET = 'cnp-media-test'
    resetEnvCacheForTests()
    resetOssAdapterForTests()

    const adapter = initOssAdapter()
    expect(adapter).toBeInstanceOf(AliyunOssAdapter)
    expect(adapter.key).toBe('aliyun')
  })

  test('initOssAdapter is singleton (two calls return same reference)', () => {
    process.env.OSS_ADAPTER_KEY = 'mock'
    resetEnvCacheForTests()
    resetOssAdapterForTests()

    const a = initOssAdapter()
    const b = initOssAdapter()
    expect(a).toBe(b)
  })

  test('resetOssAdapterForTests clears singleton and re-init reflects new env', () => {
    process.env.OSS_ADAPTER_KEY = 'mock'
    resetEnvCacheForTests()
    resetOssAdapterForTests()
    const first = initOssAdapter()
    expect(first).toBeInstanceOf(MockOssAdapter)

    // switch backend, reset, re-init → fresh instance of different class
    process.env.OSS_ADAPTER_KEY = 'aliyun'
    process.env.OSS_ENDPOINT = 'https://oss-cn-shenzhen.aliyuncs.com'
    process.env.OSS_ACCESS_KEY_ID = 'fake-ak-id'
    process.env.OSS_ACCESS_KEY_SECRET = 'fake-ak-secret'
    process.env.OSS_BUCKET = 'cnp-media-test'
    resetEnvCacheForTests()
    resetOssAdapterForTests()

    const second = initOssAdapter()
    expect(second).not.toBe(first)
    expect(second).toBeInstanceOf(AliyunOssAdapter)
    expect(second.key).toBe('aliyun')
  })

  test('getOssAdapter without prior init lazy-initializes', () => {
    process.env.OSS_ADAPTER_KEY = 'mock'
    resetEnvCacheForTests()
    resetOssAdapterForTests()

    // no initOssAdapter() call beforehand — getOssAdapter must handle it
    const adapter = getOssAdapter()
    expect(adapter).toBeInstanceOf(MockOssAdapter)
    expect(adapter.key).toBe('mock')
    // and a follow-up returns the same singleton
    expect(getOssAdapter()).toBe(adapter)
  })
})
