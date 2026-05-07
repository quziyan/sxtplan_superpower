import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { _resetOssClientForTests, getOssClient } from '../../src/media/oss-client'
import { resetEnvCacheForTests } from '../../src/env'

const KEYS = ['OSS_ENDPOINT', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_BUCKET']
let snapshot: Record<string, string | undefined> = {}

beforeEach(() => {
  snapshot = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  // Force the empty-AK default path: clear OSS_ACCESS_KEY_ID even if shell has one.
  for (const k of KEYS) delete process.env[k]
  _resetOssClientForTests()
  resetEnvCacheForTests()
})

afterEach(() => {
  for (const k of KEYS) {
    if (snapshot[k] === undefined) delete process.env[k]
    else process.env[k] = snapshot[k]
  }
  _resetOssClientForTests()
  resetEnvCacheForTests()
})

describe('oss-client', () => {
  test('getOssClient throws when OSS_ACCESS_KEY_ID is empty (default)', () => {
    // All OSS_* vars are unset — zod defaults to '' for AK ID, which is the un-configured signal.
    expect(() => getOssClient()).toThrow(
      /OSS not configured; set OSS_ENDPOINT\/OSS_ACCESS_KEY_ID\/OSS_ACCESS_KEY_SECRET\/OSS_BUCKET/,
    )
  })

  test('getOssClient returns an OSS instance when all 4 env vars are set', () => {
    process.env.OSS_ENDPOINT = 'https://oss-cn-shenzhen.aliyuncs.com'
    process.env.OSS_ACCESS_KEY_ID = 'fake-ak-id'
    process.env.OSS_ACCESS_KEY_SECRET = 'fake-ak-secret'
    process.env.OSS_BUCKET = 'cnp-media-test'
    resetEnvCacheForTests()

    const client = getOssClient()
    expect(client).toBeDefined()
    // ali-oss exports a class-like constructor; signatureUrl is a public method we'd use later.
    expect(typeof client.signatureUrl).toBe('function')
    expect(typeof client.put).toBe('function')
  })

  test('after _resetOssClientForTests, cleared env throws again (cache reset works)', () => {
    // First, populate and build a cached client.
    process.env.OSS_ENDPOINT = 'https://oss-cn-shenzhen.aliyuncs.com'
    process.env.OSS_ACCESS_KEY_ID = 'fake-ak-id'
    process.env.OSS_ACCESS_KEY_SECRET = 'fake-ak-secret'
    process.env.OSS_BUCKET = 'cnp-media-test'
    resetEnvCacheForTests()
    expect(getOssClient()).toBeDefined()

    // Now reset the singleton + env, and verify the throw path is reachable again.
    _resetOssClientForTests()
    for (const k of KEYS) delete process.env[k]
    resetEnvCacheForTests()

    expect(() => getOssClient()).toThrow(/OSS not configured/)
  })
})
