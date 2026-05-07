import { createHmac, timingSafeEqual } from 'node:crypto'

export function computeSignature(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

export function verifySignature(rawBody: string, providedHex: string, secret: string): boolean {
  const expected = computeSignature(rawBody, secret)
  if (providedHex.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(providedHex, 'hex'), Buffer.from(expected, 'hex'))
  } catch { return false }
}
