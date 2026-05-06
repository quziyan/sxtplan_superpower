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

describe('server boot', () => {
  test('GET /health returns 200', async () => {
    process.env.SESSION_SECRET = '0'.repeat(64)
    // import dynamically AFTER env is set
    const mod = await import('@/server')
    const res = await mod.default.fetch(new Request('http://x/health'))
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string }
    expect(body.status).toBe('ok')
  })
})
