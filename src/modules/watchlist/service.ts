import { eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { watchLists, type WatchList } from '@/db/schema/watchlist'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'

/**
 * Plan-PP fix:新建监视清单 modal 只收 name + keywords,V/T/R 走全局「通用」兜底。
 *
 * 单元名(`通用车辆 / 通用任务 / 通用区域`)第一次调用时 find-or-create,后续复用。
 * 这样 UI 极简,V/T/R 仍可用于 predictions 外键约束。需要细分时分析师可单独建
 * 真正的 V/T/R 然后挪 wl 过去(后续 UI 支持)。
 */
const GENERIC_V_NAME = '通用车辆'
const GENERIC_T_NAME = '通用任务'
const GENERIC_R_NAME = '通用区域'

async function findOrCreateGenericVehicle(db: Db): Promise<string> {
  const [exist] = await db.select({ id: vehicleClasses.id }).from(vehicleClasses)
    .where(eq(vehicleClasses.name, GENERIC_V_NAME)).limit(1)
  if (exist) return exist.id
  const [row] = await db.insert(vehicleClasses).values({ name: GENERIC_V_NAME, level: 1 }).returning({ id: vehicleClasses.id })
  return row!.id
}

async function findOrCreateGenericTask(db: Db): Promise<string> {
  const [exist] = await db.select({ id: taskClasses.id }).from(taskClasses)
    .where(eq(taskClasses.name, GENERIC_T_NAME)).limit(1)
  if (exist) return exist.id
  const [row] = await db.insert(taskClasses).values({ name: GENERIC_T_NAME, level: 1 }).returning({ id: taskClasses.id })
  return row!.id
}

async function findOrCreateGenericRegion(db: Db): Promise<{ id: string; version: number }> {
  // regions 是带版本的命名实体;查最新 version。找不到则创建 version=1。
  const rows = await db.execute<{ id: string; version: number }>(sql`
    SELECT id::text, version FROM regions WHERE name = ${GENERIC_R_NAME}
    ORDER BY version DESC LIMIT 1
  `) as unknown as Array<{ id: string; version: number }>
  if (rows[0]) return { id: rows[0].id, version: rows[0].version }
  // 没有 → 创建一个最简单的兜底区域(用 PostGIS 点几何)
  // regions.geom 是 Polygon — 用一个广州中心的最小占位多边形
  const created = await db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('ADMIN_NAMED', ${GENERIC_R_NAME}, 1,
      ST_GeomFromText('POLYGON((113.0 22.9, 113.6 22.9, 113.6 23.4, 113.0 23.4, 113.0 22.9))', 4326))
    RETURNING id::text, version
  `) as unknown as Array<{ id: string; version: number }>
  return { id: created[0]!.id, version: created[0]!.version }
}

export type CreateWatchListInput = {
  name: string
  description?: string
  /** 可选 — 不传走「通用车辆」兜底 */
  vehicleClassId?: string
  /** 可选 — 不传走「通用任务」兜底 */
  taskClassId?: string
  /** 可选 — 不传走「通用区域」兜底 */
  regionId?: string
  regionVersion?: number
  kRangeMin?: number
  kRangeMax?: number
  keywords?: string[]
  createdBy: string
}

export async function createWatchList(db: Db, input: CreateWatchListInput): Promise<WatchList> {
  const vehicleClassId = input.vehicleClassId ?? await findOrCreateGenericVehicle(db)
  const taskClassId = input.taskClassId ?? await findOrCreateGenericTask(db)
  let regionId: string
  let regionVersion: number
  if (input.regionId && input.regionVersion) {
    regionId = input.regionId
    regionVersion = input.regionVersion
  } else {
    const r = await findOrCreateGenericRegion(db)
    regionId = r.id
    regionVersion = r.version
  }
  const [row] = await db.insert(watchLists).values({
    name: input.name,
    description: input.description ?? null,
    vehicleClassId,
    taskClassId,
    regionId,
    regionVersion,
    kRangeMin: input.kRangeMin ?? 1,
    kRangeMax: input.kRangeMax ?? 14,
    keywords: input.keywords ?? [],
    createdBy: input.createdBy,
  }).returning()
  if (!row) throw new Error('insert returned no row')
  return row
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

export type UpdateWatchListKeywordsInput = {
  id: string
  keywords: string[]
}

export async function updateWatchListKeywords(
  db: Db,
  input: UpdateWatchListKeywordsInput,
): Promise<WatchList> {
  const [row] = await db.update(watchLists)
    .set({ keywords: input.keywords, updatedAt: new Date() })
    .where(eq(watchLists.id, input.id))
    .returning()
  if (!row) throw new Error(`watchlist ${input.id} not found`)
  return row
}

export type UpdateWatchListNameInput = { id: string; name: string }
export async function updateWatchListName(
  db: Db,
  input: UpdateWatchListNameInput,
): Promise<WatchList> {
  const [row] = await db.update(watchLists)
    .set({ name: input.name, updatedAt: new Date() })
    .where(eq(watchLists.id, input.id))
    .returning()
  if (!row) throw new Error(`watchlist ${input.id} not found`)
  return row
}

export async function deleteWatchList(db: Db, id: string): Promise<void> {
  const r = await db.delete(watchLists).where(eq(watchLists.id, id)).returning({ id: watchLists.id })
  if (r.length === 0) throw new Error(`watchlist ${id} not found`)
}
