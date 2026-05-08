import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { halfDayEnum } from './prediction'

export const watchLists = pgTable(
  'watch_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    vehicleClassId: uuid('vehicle_class_id').notNull(),
    taskClassId: uuid('task_class_id').notNull(),
    regionId: uuid('region_id').notNull(),
    regionVersion: integer('region_version').notNull(),
    kRangeMin: integer('k_range_min').notNull().default(1),
    kRangeMax: integer('k_range_max').notNull().default(14),
    isActive: boolean('is_active').notNull().default(true),
    keywords: text('keywords').array().notNull().default(sql`ARRAY[]::text[]`),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('watchlist_active_idx').on(t.isActive),
    index('watchlist_vrt_idx').on(t.vehicleClassId, t.regionId, t.taskClassId),
  ]
)

export const taskCards = pgTable(
  'task_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    vehicleClassId: uuid('vehicle_class_id').notNull(),
    taskClassId: uuid('task_class_id').notNull(),
    regionId: uuid('region_id').notNull(),
    regionVersion: integer('region_version').notNull(),
    targetWindowDate: timestamp('target_window_date', { withTimezone: false, mode: 'date' }).notNull(),
    targetWindowHalf: halfDayEnum('target_window_half').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('taskcard_target_idx').on(t.targetWindowDate, t.targetWindowHalf)]
)

export type WatchList = typeof watchLists.$inferSelect
export type NewWatchList = typeof watchLists.$inferInsert
export type TaskCard = typeof taskCards.$inferSelect
export type NewTaskCard = typeof taskCards.$inferInsert
