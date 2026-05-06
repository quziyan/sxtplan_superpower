import { describe, expect, test } from 'bun:test'

describe('env', () => {
  test('throws when DATABASE_URL missing', async () => {
    const { resetEnvCacheForTests } = require('../src/env')
    resetEnvCacheForTests()
    const orig = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    expect(() => require('../src/env').loadEnv()).toThrow(/DATABASE_URL/)
    if (orig) process.env.DATABASE_URL = orig
  })

  test('parses valid env', () => {
    const { resetEnvCacheForTests } = require('../src/env')
    resetEnvCacheForTests()
    process.env.DATABASE_URL = 'postgres://x:y@h:5432/d'
    process.env.DATABASE_ADMIN_URL = 'postgres://x:y@h:5432/d'
    process.env.SESSION_SECRET = '0'.repeat(64)
    process.env.NODE_ENV = 'development'
    const { loadEnv } = require('../src/env')
    const env = loadEnv()
    expect(env.PORT).toBe(3000)
    expect(env.NODE_ENV).toBe('development')
    process.env.NODE_ENV = 'test'
  })
})
