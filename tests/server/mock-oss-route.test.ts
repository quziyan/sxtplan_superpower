import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetEnvCacheForTests } from '@/env'
import {
  getOssAdapter,
  resetOssAdapterForTests,
} from '@/media/oss-adapter-pool'
import type { MockOssAdapter } from '@/media/adapters/mock-oss'

// Snapshot/restore the env keys we toggle, plus reset both caches between tests
// so adjacent tests don't bleed state through the OssAdapter singleton.
const KEYS = [
  'OSS_ADAPTER_KEY',
  'OSS_ENDPOINT',
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
  'OSS_BUCKET',
  'SESSION_SECRET',
  'NODE_ENV',
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

describe('GET /static/mock-oss/:key', () => {
  test('mock backend + existing key → 200 image/jpeg with body bytes matching put()', async () => {
    process.env.SESSION_SECRET = '0'.repeat(64)
    process.env.OSS_ADAPTER_KEY = 'mock'
    resetEnvCacheForTests()
    resetOssAdapterForTests()

    // pre-populate the mock store via the live singleton
    const adapter = getOssAdapter() as MockOssAdapter
    expect(adapter.key).toBe('mock')
    const key = 'media/x/route-hit.jpg'
    const body = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04])
    await adapter.put(key, body)

    const mod = await import('@/server')
    const res = await mod.default.fetch(
      new Request(`http://x/static/mock-oss/${encodeURIComponent(key)}`),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/jpeg')

    const got = new Uint8Array(await res.arrayBuffer())
    expect(got.byteLength).toBe(body.byteLength)
    for (let i = 0; i < body.byteLength; i++) {
      if (got[i] !== body[i]) {
        throw new Error(`byte mismatch at offset ${i}: expected ${body[i]}, got ${got[i]}`)
      }
    }
  })

  test('mock backend + missing key → 404 with error JSON', async () => {
    process.env.SESSION_SECRET = '0'.repeat(64)
    process.env.OSS_ADAPTER_KEY = 'mock'
    resetEnvCacheForTests()
    resetOssAdapterForTests()

    // ensure singleton is the empty mock — no put() calls
    const adapter = getOssAdapter()
    expect(adapter.key).toBe('mock')

    const mod = await import('@/server')
    const res = await mod.default.fetch(
      new Request('http://x/static/mock-oss/does-not-exist.jpg'),
    )
    expect(res.status).toBe(404)
    const json = (await res.json()) as { error: string }
    expect(json.error).toMatch(/key not found/)
  })

  test('aliyun backend → 404 "mock OSS not active" (route refuses to serve)', async () => {
    process.env.SESSION_SECRET = '0'.repeat(64)
    process.env.OSS_ADAPTER_KEY = 'aliyun'
    process.env.OSS_ENDPOINT = 'https://oss-cn-shenzhen.aliyuncs.com'
    process.env.OSS_ACCESS_KEY_ID = 'fake-ak-id'
    process.env.OSS_ACCESS_KEY_SECRET = 'fake-ak-secret'
    process.env.OSS_BUCKET = 'cnp-media-test'
    resetEnvCacheForTests()
    resetOssAdapterForTests()

    const mod = await import('@/server')
    const res = await mod.default.fetch(
      new Request('http://x/static/mock-oss/anything.jpg'),
    )
    expect(res.status).toBe(404)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('mock OSS not active')
  })
})
