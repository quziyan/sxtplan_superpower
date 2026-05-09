import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * 全局运行时设置(key/value 单例表)。
 *
 * 用法:整数走 valueInt,字符串走 valueText。一行一个 key。
 * 当前键:
 *   - news_freshness_days  (int 1-365)  — 证据新闻取最近 N 天发布的
 *
 * 设计原则:env 是 fallback,DB 是 override。env 总有默认值,DB 行缺失
 * 时降级到 env;DB 行存在时优先 DB(支持运行时编辑)。
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  valueInt: integer('value_int'),
  valueText: text('value_text'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type AppSetting = typeof appSettings.$inferSelect
export type NewAppSetting = typeof appSettings.$inferInsert
