import { sql } from 'drizzle-orm'
import { check, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { polygon } from '../types'

export const regionKindEnum = pgEnum('region_kind', ['ADMIN_NAMED', 'AD_HOC'])

export const regions = pgTable(
  'regions',
  {
    id: uuid('id').notNull().defaultRandom(),
    kind: regionKindEnum('kind').notNull(),
    name: text('name'),
    parentId: uuid('parent_id'),
    version: integer('version').notNull().default(1),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    geom: polygon('geom').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.version], name: 'regions_pk' }),
    check('region_admin_named_has_name', sql`(${t.kind} = 'AD_HOC') OR (${t.name} IS NOT NULL)`),
    check('region_version_positive', sql`${t.version} >= 1`),
    uniqueIndex('regions_one_current').on(t.id).where(sql`${t.effectiveTo} IS NULL`),
    index('regions_geom_idx').using('gist', t.geom),
    index('regions_kind_idx').on(t.kind),
    index('regions_name_idx').on(t.name),
  ]
)

export type Region = typeof regions.$inferSelect
export type NewRegion = typeof regions.$inferInsert
