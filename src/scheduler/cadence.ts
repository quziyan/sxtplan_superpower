/**
 * 设计稿 §3.1 表:
 *   K_days       cadence
 *   ────────────────────
 *   K ≤ 3        每 6 小时(360 min)
 *   3 < K ≤ 14   每 24 小时
 *   14 < K ≤ 60  每 48 小时
 *   K > 60       每周(10080 min)
 */
export function cadenceMinutesForK(kDays: number): number {
  if (kDays <= 3) return 6 * 60
  if (kDays <= 14) return 24 * 60
  if (kDays <= 60) return 48 * 60
  return 7 * 24 * 60
}

export function nextRefreshAt(now: Date, kDays: number, lastRefreshAt?: Date | null): Date {
  const minutes = cadenceMinutesForK(kDays)
  const base = lastRefreshAt ?? now
  return new Date(base.getTime() + minutes * 60_000)
}
