import type { Db } from '@/db/client'
import { taskClasses, taskEdgeTags, vehicleClasses, vehicleEdgeTags } from '@/db/schema/taxonomy'

export async function listVehicleClasses(db: Db) {
  return db.select().from(vehicleClasses).orderBy(vehicleClasses.level, vehicleClasses.name)
}

export async function createVehicleClass(db: Db, input: { name: string; level: 1 | 2; parentId?: string; description?: string }) {
  const [row] = await db.insert(vehicleClasses).values({
    name: input.name,
    level: input.level,
    parentId: input.parentId ?? null,
    description: input.description ?? null,
  }).returning()
  return row!
}

export async function listTaskClasses(db: Db) {
  return db.select().from(taskClasses).orderBy(taskClasses.level, taskClasses.name)
}

export async function createTaskClass(db: Db, input: { name: string; level: 1 | 2; parentId?: string; description?: string }) {
  const [row] = await db.insert(taskClasses).values({
    name: input.name,
    level: input.level,
    parentId: input.parentId ?? null,
    description: input.description ?? null,
  }).returning()
  return row!
}

export async function attachVehicleEdgeTag(db: Db, vehicleClassId: string, tag: string, createdBy?: string) {
  const [row] = await db.insert(vehicleEdgeTags).values({
    vehicleClassId, tag, createdBy: createdBy ?? null,
  }).returning()
  return row!
}

export async function attachTaskEdgeTag(db: Db, taskClassId: string, tag: string, createdBy?: string) {
  const [row] = await db.insert(taskEdgeTags).values({
    taskClassId, tag, createdBy: createdBy ?? null,
  }).returning()
  return row!
}
