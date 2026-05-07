import { describe, expect, test } from 'bun:test'
import { getAdapter } from '@/dispatch/adapter-pool'

describe('MockCameraAdapter', () => {
  test('dispatch returns externalId starting with mock-', async () => {
    const a = getAdapter('mock')
    const ack = await a.dispatch({ predictionId: 'p1', paramsJson: {} })
    expect(ack.externalId).toMatch(/^mock-[0-9a-f-]+$/)
    expect(new Date(ack.acceptedAt).getTime()).toBeGreaterThan(0)
  })

  test('cancel returns externalId echoed + cancelledAt', async () => {
    const a = getAdapter('mock')
    const c = await a.cancel('mock-abc', 'idem-key-1')
    expect(c.externalId).toBe('mock-abc')
    expect(new Date(c.cancelledAt).getTime()).toBeGreaterThan(0)
  })

  test('pollStatus returns IN_PROGRESS', async () => {
    const a = getAdapter('mock')
    const s = await a.pollStatus('mock-xyz')
    expect(s.externalId).toBe('mock-xyz')
    expect(s.state).toBe('IN_PROGRESS')
  })

  test('getAdapter unknown key throws', () => {
    expect(() => getAdapter('nonexistent')).toThrow(/not registered/)
  })

  test('signOutgoing is defined and returns a string', () => {
    const a = getAdapter('mock')
    expect(typeof a.signOutgoing).toBe('function')
    const sig = a.signOutgoing?.('{"any":"payload"}')
    expect(typeof sig).toBe('string')
  })
})
