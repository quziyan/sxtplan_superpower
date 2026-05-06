import { describe, expect, test } from 'bun:test'
import { signValue, verifyValue } from '@/auth/cookie'

const SECRET = '0'.repeat(64)

describe('signed cookie', () => {
  test('sign and verify round trip', () => {
    const signed = signValue('session-id-abc', SECRET)
    expect(signed).toContain('.')
    expect(verifyValue(signed, SECRET)).toBe('session-id-abc')
  })

  test('tampered value rejected', () => {
    const signed = signValue('a', SECRET)
    const tampered = `b.${signed.split('.')[1]!}`
    expect(verifyValue(tampered, SECRET)).toBeNull()
  })

  test('wrong secret rejected', () => {
    const signed = signValue('a', SECRET)
    expect(verifyValue(signed, '1'.repeat(64))).toBeNull()
  })
})
