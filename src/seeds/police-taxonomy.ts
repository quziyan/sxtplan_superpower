import { and, eq, isNull } from 'drizzle-orm'
import { createDb } from '@/db/client'
import { taskClasses, taskEdgeTags, vehicleClasses, vehicleEdgeTags } from '@/db/schema/taxonomy'
import type { Db } from '@/db/client'

type Hierarchy = {
  parent: string
  children: string[]
  tags?: string[]
}

const VEHICLE_HIERARCHY: Hierarchy[] = [
  {
    parent: '警务车辆',
    children: ['治安巡逻车', '交警执法车', '刑侦专项车', '综治巡防车', '城管执法车'],
    tags: ['指挥车', '便携设备车', '排查车'],
  },
]

const TASK_HIERARCHY: Hierarchy[] = [
  {
    parent: '警务执法',
    children: ['街面治安巡逻', '路面交通执法', '专项行动', '综合治理巡查', '城管执法巡查'],
    tags: ['夜间巡逻', '节假日加强', '常态'],
  },
]

type ClassTable = typeof vehicleClasses | typeof taskClasses

async function ensureClass(
  db: Db,
  table: ClassTable,
  name: string,
  level: 1 | 2,
  parentId: string | null,
): Promise<{ id: string; name: string; level: number; parentId: string | null }> {
  const where = parentId === null
    ? and(eq(table.name, name), eq(table.level, level), isNull(table.parentId))
    : and(eq(table.name, name), eq(table.level, level), eq(table.parentId, parentId))
  const existing = await db.select().from(table).where(where)
  if (existing[0]) return existing[0] as any
  const insertValues = parentId === null
    ? { name, level }
    : { name, level, parentId }
  const inserted = await db.insert(table).values(insertValues as any).returning()
  return inserted[0] as any
}

async function ensureVehicleTag(db: Db, vehicleClassId: string, tag: string) {
  await db
    .insert(vehicleEdgeTags)
    .values({ vehicleClassId, tag })
    .onConflictDoNothing({ target: [vehicleEdgeTags.vehicleClassId, vehicleEdgeTags.tag] })
}

async function ensureTaskTag(db: Db, taskClassId: string, tag: string) {
  await db
    .insert(taskEdgeTags)
    .values({ taskClassId, tag })
    .onConflictDoNothing({ target: [taskEdgeTags.taskClassId, taskEdgeTags.tag] })
}

export async function seedPoliceTaxonomy(db: Db): Promise<void> {
  for (const h of VEHICLE_HIERARCHY) {
    const parent = await ensureClass(db, vehicleClasses, h.parent, 1, null)
    for (const child of h.children) {
      const c = await ensureClass(db, vehicleClasses, child, 2, parent.id)
      console.log(`[seed] vehicle ${h.parent} > ${child} (${c.id.slice(0, 8)})`)
      for (const tag of h.tags ?? []) {
        await ensureVehicleTag(db, c.id, tag)
      }
    }
  }
  for (const h of TASK_HIERARCHY) {
    const parent = await ensureClass(db, taskClasses, h.parent, 1, null)
    for (const child of h.children) {
      const c = await ensureClass(db, taskClasses, child, 2, parent.id)
      console.log(`[seed] task ${h.parent} > ${child} (${c.id.slice(0, 8)})`)
      for (const tag of h.tags ?? []) {
        await ensureTaskTag(db, c.id, tag)
      }
    }
  }
}

async function main() {
  const { db, sql } = createDb('admin')
  console.log('[seed:taxonomy:police] start')
  try {
    await seedPoliceTaxonomy(db)
    console.log('[seed:taxonomy:police] done')
  } finally {
    await sql.end()
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
