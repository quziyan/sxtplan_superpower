import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { users } from './user'

export const vehicleClasses = pgTable(
  'vehicle_classes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id').references((): any => vehicleClasses.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    level: integer('level').notNull(), // 1 = 大类, 2 = 子类
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('vehicle_level_1_has_no_parent', sql`(${t.level} = 1 AND ${t.parentId} IS NULL) OR (${t.level} = 2 AND ${t.parentId} IS NOT NULL)`),
    check('vehicle_level_in_range', sql`${t.level} IN (1, 2)`),
    index('vehicle_classes_parent_idx').on(t.parentId),
    index('vehicle_classes_name_idx').on(t.name),
  ]
)

export const taskClasses = pgTable(
  'task_classes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id').references((): any => taskClasses.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    level: integer('level').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('task_level_1_has_no_parent', sql`(${t.level} = 1 AND ${t.parentId} IS NULL) OR (${t.level} = 2 AND ${t.parentId} IS NOT NULL)`),
    check('task_level_in_range', sql`${t.level} IN (1, 2)`),
    index('task_classes_parent_idx').on(t.parentId),
    index('task_classes_name_idx').on(t.name),
  ]
)

// EdgeTag 挂在 Level 2 上,允许分析师创建。tag 是自由文本但同一 vehicleClass 内去重。
export const vehicleEdgeTags = pgTable(
  'vehicle_edge_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleClassId: uuid('vehicle_class_id').notNull().references(() => vehicleClasses.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('vehicle_tag_unique').on(t.vehicleClassId, t.tag)]
)

export const taskEdgeTags = pgTable(
  'task_edge_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskClassId: uuid('task_class_id').notNull().references(() => taskClasses.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('task_tag_unique').on(t.taskClassId, t.tag)]
)

// Plan-PP — 每个用户关注的车辆类型集合(可关注 level-1 或 level-2)
export const userFollowedVehicleClasses = pgTable(
  'user_followed_vehicle_classes',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    vehicleClassId: uuid('vehicle_class_id').notNull().references(() => vehicleClasses.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.vehicleClassId] }),
    index('ufvc_user_idx').on(t.userId),
    index('ufvc_vehicle_idx').on(t.vehicleClassId),
  ]
)

export type VehicleClass = typeof vehicleClasses.$inferSelect
export type TaskClass = typeof taskClasses.$inferSelect
export type UserFollowedVehicleClass = typeof userFollowedVehicleClasses.$inferSelect
