import { createHmac, timingSafeEqual } from 'node:crypto'

function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

export function signValue(value: string, secret: string): string {
  return `${value}.${hmac(value, secret)}`
}

export function verifyValue(signed: string, secret: string): string | null {
  const lastDot = signed.lastIndexOf('.')
  if (lastDot < 0) return null
  const value = signed.slice(0, lastDot)
  const sig = signed.slice(lastDot + 1)
  const expected = hmac(value, secret)
  if (sig.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  return value
}
