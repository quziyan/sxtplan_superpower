import { eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { appSettings } from '@/db/schema/settings'
import { loadEnv } from '@/env'

/** 已知 key 列表 — 集中声明,避免 typo 散落在各处。 */
export const SETTING_KEYS = {
  NEWS_FRESHNESS_DAYS: 'news_freshness_days',
  NEWS_RELEVANCE_THRESHOLD: 'news_relevance_threshold',
  NEWS_MAX_TO_RERANK: 'news_max_to_rerank',
} as const

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]

/**
 * Generic integer setting reader:DB 优先,DB 缺失/越界 fallback 到 caller-提供的 default。
 */
async function getIntSetting(
  db: Db,
  key: SettingKey,
  fallback: number,
  range: { min: number; max: number },
): Promise<number> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key))
  if (!row || row.valueInt === null || row.valueInt === undefined) return fallback
  if (row.valueInt < range.min || row.valueInt > range.max) return fallback
  return row.valueInt
}

async function setIntSetting(
  db: Db,
  key: SettingKey,
  value: number,
  range: { min: number; max: number },
  label: string,
): Promise<void> {
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new Error(`${label} must be integer in [${range.min}, ${range.max}], got ${value}`)
  }
  await db.insert(appSettings)
    .values({ key, valueInt: value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { valueInt: value, updatedAt: new Date() },
    })
}

// ── news_freshness_days ────────────────────────────────────────────────
export async function getNewsFreshnessDays(db: Db): Promise<number> {
  return getIntSetting(
    db, SETTING_KEYS.NEWS_FRESHNESS_DAYS,
    loadEnv().NEWS_FRESHNESS_DAYS,
    { min: 1, max: 365 },
  )
}
export async function setNewsFreshnessDays(db: Db, value: number): Promise<void> {
  return setIntSetting(
    db, SETTING_KEYS.NEWS_FRESHNESS_DAYS, value,
    { min: 1, max: 365 }, 'news_freshness_days',
  )
}

// ── news_relevance_threshold ───────────────────────────────────────────
export async function getNewsRelevanceThreshold(db: Db): Promise<number> {
  return getIntSetting(
    db, SETTING_KEYS.NEWS_RELEVANCE_THRESHOLD,
    loadEnv().RELEVANCE_THRESHOLD,
    { min: 0, max: 100 },
  )
}
export async function setNewsRelevanceThreshold(db: Db, value: number): Promise<void> {
  return setIntSetting(
    db, SETTING_KEYS.NEWS_RELEVANCE_THRESHOLD, value,
    { min: 0, max: 100 }, 'news_relevance_threshold',
  )
}

// ── news_max_to_rerank ─────────────────────────────────────────────────
const MAX_TO_RERANK_DEFAULT = 50
export async function getNewsMaxToRerank(db: Db): Promise<number> {
  return getIntSetting(
    db, SETTING_KEYS.NEWS_MAX_TO_RERANK,
    MAX_TO_RERANK_DEFAULT,
    { min: 1, max: 100 },
  )
}
export async function setNewsMaxToRerank(db: Db, value: number): Promise<void> {
  return setIntSetting(
    db, SETTING_KEYS.NEWS_MAX_TO_RERANK, value,
    { min: 1, max: 100 }, 'news_max_to_rerank',
  )
}
