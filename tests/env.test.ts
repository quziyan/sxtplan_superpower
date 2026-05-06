import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetEnvCacheForTests } from '../src/env'

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

describe('env', () => {
  test('throws when DATABASE_URL missing', () => {
    delete process.env.DATABASE_URL
    const { loadEnv } = require('../src/env')
    expect(() => loadEnv()).toThrow(/DATABASE_URL/)
  })

  test('parses valid env', () => {
    process.env.DATABASE_URL = 'postgres://x:y@h:5432/d'
    process.env.DATABASE_ADMIN_URL = 'postgres://x:y@h:5432/d'
    process.env.SESSION_SECRET = '0'.repeat(64)
    process.env.NODE_ENV = 'development'
    const { loadEnv } = require('../src/env')
    const env = loadEnv()
    expect(env.PORT).toBe(3000)
    expect(env.NODE_ENV).toBe('development')
  })
})
