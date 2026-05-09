import { eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { appSettings } from '@/db/schema/settings'
import { loadEnv } from '@/env'

/** 已知 key 列表 — 这里集中声明,避免 typo 散落在各处。 */
export const SETTING_KEYS = {
  NEWS_FRESHNESS_DAYS: 'news_freshness_days',
} as const

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]

/**
 * 读 news_freshness_days:DB 优先,缺失 fallback 到 env(默认 30)。
 * 同时验证范围 1-365,越界一律降到 env。
 */
export async function getNewsFreshnessDays(db: Db): Promise<number> {
  const env = loadEnv()
  const fallback = env.NEWS_FRESHNESS_DAYS
  const [row] = await db.select().from(appSettings)
    .where(eq(appSettings.key, SETTING_KEYS.NEWS_FRESHNESS_DAYS))
  if (!row || row.valueInt === null || row.valueInt === undefined) return fallback
  if (row.valueInt < 1 || row.valueInt > 365) return fallback
  return row.valueInt
}

export async function setNewsFreshnessDays(db: Db, value: number): Promise<void> {
  if (!Number.isInteger(value) || value < 1 || value > 365) {
    throw new Error(`news_freshness_days must be integer in [1, 365], got ${value}`)
  }
  // upsert by primary key
  await db.insert(appSettings)
    .values({ key: SETTING_KEYS.NEWS_FRESHNESS_DAYS, valueInt: value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { valueInt: value, updatedAt: new Date() },
    })
}
