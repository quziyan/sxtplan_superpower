import { describe, expect, test } from 'bun:test'
import { hashPassword, verifyPassword } from '@/auth/password'

describe('password', () => {
  test('hash + verify round trip', async () => {
    const h = await hashPassword('correct horse battery staple')
    expect(h).not.toBe('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true)
    expect(await verifyPassword('wrong', h)).toBe(false)
  })

  test('different inputs produce different hashes', async () => {
    const a = await hashPassword('a')
    const b = await hashPassword('a')
    expect(a).not.toBe(b) // 不同 salt
  })
})
