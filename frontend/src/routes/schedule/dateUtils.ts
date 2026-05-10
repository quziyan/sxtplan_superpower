/**
 * Schedule tab — pure date math. No timezone surprises: we operate in
 * local time (browser TZ) since users navigate by their own calendar day.
 * windowDate comes back from the backend as 'YYYY-MM-DD' string and is
 * compared via slice(0,10) — no Date constructor needed for that path.
 */

export function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

// 周一为周首,周日为周末 — 国内日历惯例。
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7  // Mon=0 ... Sun=6
}

export function monthGridRange(anchor: Date): { start: Date; end: Date; cells: Date[] } {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const offset = mondayIndex(firstOfMonth)
  const start = new Date(firstOfMonth)
  start.setDate(1 - offset)
  const cells: Date[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    cells.push(d)
  }
  return { start, end: cells[cells.length - 1]!, cells }
}

export function weekRange(anchor: Date): { start: Date; end: Date; days: Date[] } {
  const offset = mondayIndex(anchor)
  const start = new Date(anchor)
  start.setDate(anchor.getDate() - offset)
  start.setHours(0, 0, 0, 0)
  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    days.push(d)
  }
  return { start, end: days[6]!, days }
}

// 中文周日缩写,与日历列头匹配
export const WEEKDAYS_ZH = ['一', '二', '三', '四', '五', '六', '日'] as const

export function weekdayLabel(d: Date): string {
  return WEEKDAYS_ZH[mondayIndex(d)]!
}
