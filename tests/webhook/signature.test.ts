import { describe, expect, test } from 'bun:test'
import { computeSignature, verifySignature } from '@/webhook/signature'

describe('webhook signature', () => {
  const secret = 'super-secret-key'
  const body = '{"event":"camera.detection","ts":1714000000}'

  test('1. same secret + body → verifySignature returns true', () => {
    const sig = computeSignature(body, secret)
    expect(verifySignature(body, sig, secret)).toBe(true)
  })

  test('2. wrong secret → false', () => {
    const sig = computeSignature(body, secret)
    expect(verifySignature(body, sig, 'wrong-secret')).toBe(false)
  })

  test('3. tampered body → false', () => {
    const sig = computeSignature(body, secret)
    const tamperedBody = body.replace('1714000000', '1714000001')
    expect(verifySignature(tamperedBody, sig, secret)).toBe(false)
  })

  test('4. tampered sig (flip last hex char) → false', () => {
    const sig = computeSignature(body, secret)
    const last = sig.slice(-1)
    const flipped = last === '0' ? '1' : '0'
    const tamperedSig = sig.slice(0, -1) + flipped
    expect(verifySignature(body, tamperedSig, secret)).toBe(false)
  })

  test('5. non-hex providedHex → false (caught by try/catch, no throw)', () => {
    const sig = computeSignature(body, secret)
    // build a string of the same length as sig but with non-hex chars
    const nonHex = 'z'.repeat(sig.length)
    expect(() => verifySignature(body, nonHex, secret)).not.toThrow()
    expect(verifySignature(body, nonHex, secret)).toBe(false)
  })

  test('6. different-length sig → false (early length-mismatch return)', () => {
    expect(verifySignature(body, 'abc123', secret)).toBe(false)
    expect(verifySignature(body, '', secret)).toBe(false)
  })
})
