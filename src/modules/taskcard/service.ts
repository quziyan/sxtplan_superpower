import { eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { taskCards, type TaskCard } from '@/db/schema/watchlist'

export type CreateTaskCardInput = {
  name: string
  description?: string
  vehicleClassId: string
  taskClassId: string
  regionId: string
  regionVersion: number
  targetWindowDate: Date
  targetWindowHalf: 'AM' | 'PM'
  createdBy: string
}

export async function createTaskCard(db: Db, input: CreateTaskCardInput): Promise<TaskCard> {
  const [row] = await db.insert(taskCards).values({
    name: input.name,
    description: input.description ?? null,
    vehicleClassId: input.vehicleClassId,
    taskClassId: input.taskClassId,
    regionId: input.regionId,
    regionVersion: input.regionVersion,
    targetWindowDate: input.targetWindowDate,
    targetWindowHalf: input.targetWindowHalf,
    createdBy: input.createdBy,
  }).returning()
  console.log(`[taskcard] created ${row!.id}; PredictionAgent dispatch deferred to m2 §6/§7 wiring`)
  return row!
}

export async function listTaskCards(db: Db): Promise<TaskCard[]> {
  return db.select().from(taskCards)
}

export async function getTaskCard(db: Db, id: string): Promise<TaskCard | null> {
  const [row] = await db.select().from(taskCards).where(eq(taskCards.id, id))
  return row ?? null
}
