import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetEnvCacheForTests } from '@/env'

const KEYS = ['DATABASE_URL', 'DATABASE_ADMIN_URL', 'SESSION_SECRET', 'NODE_ENV', 'PORT', 'REDIS_URL', 'COOKIE_DOMAIN']
let snapshot: Record<string, string | undefined> = {}

beforeEach(() => {
  snapshot = Object.fromEntries(KEYS.map(k => [k, process.env[k]]))
  resetEnvCacheForTests()
})
afterEach(() => {
  for (const k of KEYS) {
    if (snapshot[k] === undefined) delete process.env[k]
    else process.env[k] = snapshot[k]
  }
  resetEnvCacheForTests()
})

describe('static sim-media endpoint', () => {
  test('GET /static/sim-media/:filename returns image/jpeg with non-empty body', async () => {
    process.env.SESSION_SECRET = '0'.repeat(64)
    const mod = await import('@/server')
    const res = await mod.default.fetch(new Request('http://x/static/sim-media/anything.jpg'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/jpeg')
    const buf = await res.arrayBuffer()
    expect(buf.byteLength).toBeGreaterThan(0)
    // first two bytes of any JPEG are 0xFF 0xD8 (SOI marker)
    const bytes = new Uint8Array(buf)
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1]).toBe(0xd8)
  })

  test('different filenames serve identical placeholder bytes', async () => {
    process.env.SESSION_SECRET = '0'.repeat(64)
    const mod = await import('@/server')
    const a = await mod.default.fetch(new Request('http://x/static/sim-media/test.jpg'))
    const b = await mod.default.fetch(new Request('http://x/static/sim-media/other.jpg'))
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    const ba = new Uint8Array(await a.arrayBuffer())
    const bb = new Uint8Array(await b.arrayBuffer())
    expect(ba.byteLength).toBe(bb.byteLength)
    expect(ba.byteLength).toBeGreaterThan(0)
    // byte-for-byte equal
    for (let i = 0; i < ba.byteLength; i++) {
      if (ba[i] !== bb[i]) {
        throw new Error(`byte mismatch at offset ${i}`)
      }
    }
  })
})
