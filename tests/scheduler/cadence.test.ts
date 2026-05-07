import { describe, expect, test } from 'bun:test'
import { cadenceMinutesForK, nextRefreshAt } from '@/scheduler/cadence'

describe('cadenceMinutesForK', () => {
  test('K=1 → 6h', () => expect(cadenceMinutesForK(1)).toBe(360))
  test('K=3 → 6h boundary', () => expect(cadenceMinutesForK(3)).toBe(360))
  test('K=4 → 24h', () => expect(cadenceMinutesForK(4)).toBe(1440))
  test('K=14 → 24h boundary', () => expect(cadenceMinutesForK(14)).toBe(1440))
  test('K=15 → 48h', () => expect(cadenceMinutesForK(15)).toBe(2880))
  test('K=60 → 48h boundary', () => expect(cadenceMinutesForK(60)).toBe(2880))
  test('K=61 → weekly', () => expect(cadenceMinutesForK(61)).toBe(10080))
  test('K=120 → weekly', () => expect(cadenceMinutesForK(120)).toBe(10080))
})

describe('nextRefreshAt', () => {
  test('without lastRefreshAt uses now + cadence', () => {
    const now = new Date('2026-05-06T00:00:00Z')
    const next = nextRefreshAt(now, 5)  // 24h
    expect(next.toISOString()).toBe('2026-05-07T00:00:00.000Z')
  })
  test('with lastRefreshAt adds cadence to that', () => {
    const now = new Date('2026-05-06T12:00:00Z')
    const last = new Date('2026-05-06T06:00:00Z')
    const next = nextRefreshAt(now, 1, last)  // 6h cadence
    expect(next.toISOString()).toBe('2026-05-06T12:00:00.000Z')
  })
})
