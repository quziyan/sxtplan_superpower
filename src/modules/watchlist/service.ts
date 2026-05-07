import { eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { watchLists, type WatchList } from '@/db/schema/watchlist'

export type CreateWatchListInput = {
  name: string
  description?: string
  vehicleClassId: string
  taskClassId: string
  regionId: string
  regionVersion: number
  kRangeMin?: number
  kRangeMax?: number
  createdBy: string
}

export async function createWatchList(db: Db, input: CreateWatchListInput): Promise<WatchList> {
  const [row] = await db.insert(watchLists).values({
    name: input.name,
    description: input.description ?? null,
    vehicleClassId: input.vehicleClassId,
    taskClassId: input.taskClassId,
    regionId: input.regionId,
    regionVersion: input.regionVersion,
    kRangeMin: input.kRangeMin ?? 1,
    kRangeMax: input.kRangeMax ?? 14,
    createdBy: input.createdBy,
  }).returning()
  return row!
}

export async function listWatchLists(db: Db, opts: { activeOnly?: boolean } = {}): Promise<WatchList[]> {
  if (opts.activeOnly) {
    return db.select().from(watchLists).where(eq(watchLists.isActive, true))
  }
  return db.select().from(watchLists)
}

export async function getWatchList(db: Db, id: string): Promise<WatchList | null> {
  const [row] = await db.select().from(watchLists).where(eq(watchLists.id, id))
  return row ?? null
}

export async function setWatchListActive(db: Db, id: string, isActive: boolean): Promise<WatchList> {
  const [row] = await db.update(watchLists)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(watchLists.id, id))
    .returning()
  if (!row) throw new Error(`watchlist ${id} not found`)
  return row
}
