import { sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import type { Region } from '@/db/schema/region'
import { BadRequest, NotFound } from '@/lib/errors'

export type CreateRegionInput =
  | { kind: 'ADMIN_NAMED'; name: string; parentId?: string; geom: GeoJSON.Polygon; createdBy?: string }
  | { kind: 'AD_HOC'; name?: string; geom: GeoJSON.Polygon; createdBy?: string }

function validatePolygon(p: GeoJSON.Polygon) {
  if (p.type !== 'Polygon') throw BadRequest('geom must be Polygon')
  if (!p.coordinates.length) throw BadRequest('Polygon must have at least one ring')
  const outer = p.coordinates[0]!
  if (outer.length < 4) throw BadRequest('Polygon outer ring needs >= 4 points')
  const first = outer[0]!
  const last = outer[outer.length - 1]!
  if (first[0] !== last[0] || first[1] !== last[1]) throw BadRequest('Polygon outer ring not closed')
}

export async function createRegion(db: Db, input: CreateRegionInput): Promise<Region> {
  validatePolygon(input.geom)
  const result = await db.execute(sql`
    INSERT INTO regions (kind, name, parent_id, version, geom, created_by)
    VALUES (
      ${input.kind},
      ${input.kind === 'ADMIN_NAMED' ? input.name : (input.name ?? null)},
      ${'parentId' in input ? input.parentId ?? null : null},
      1,
      ST_GeomFromGeoJSON(${JSON.stringify(input.geom)}),
      ${input.createdBy ?? null}
    )
    RETURNING id, kind, name, parent_id AS "parentId", version,
              effective_from AS "effectiveFrom", effective_to AS "effectiveTo",
              ST_AsGeoJSON(geom)::json AS geom,
              created_by AS "createdBy", created_at AS "createdAt"
  `)
  return result[0] as unknown as Region
}

export async function getRegion(db: Db, id: string, version?: number): Promise<Region> {
  const versionFilter = version !== undefined
    ? sql`AND version = ${version}`
    : sql`AND effective_to IS NULL`
  const result = await db.execute(sql`
    SELECT id, kind, name, parent_id AS "parentId", version,
           effective_from AS "effectiveFrom", effective_to AS "effectiveTo",
           ST_AsGeoJSON(geom)::json AS geom,
           created_by AS "createdBy", created_at AS "createdAt"
    FROM regions WHERE id = ${id} ${versionFilter}
  `)
  if (!result[0]) throw NotFound(`region ${id}${version !== undefined ? ` v${version}` : ''} not found`)
  return result[0] as unknown as Region
}

export type UpdateAdminRegionInput = {
  id: string
  geom: GeoJSON.Polygon
  effectiveFrom?: Date
  changedBy?: string
}

// 仅 ADMIN_NAMED 支持版本化更新。AD_HOC immutable。
export async function updateAdminRegionGeom(db: Db, input: UpdateAdminRegionInput): Promise<Region> {
  validatePolygon(input.geom)
  const cur = await getRegion(db, input.id) // 当前版本
  if (cur.kind !== 'ADMIN_NAMED') throw BadRequest('AD_HOC regions are immutable')
  const effFrom = (input.effectiveFrom ?? new Date()).toISOString()
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE regions SET effective_to = ${effFrom}::timestamptz
      WHERE id = ${input.id} AND effective_to IS NULL
    `)
    await tx.execute(sql`
      INSERT INTO regions (id, kind, name, parent_id, version, effective_from, geom, created_by)
      VALUES (
        ${input.id}, ${cur.kind}, ${cur.name}, ${cur.parentId},
        ${cur.version + 1}, ${effFrom}::timestamptz,
        ST_GeomFromGeoJSON(${JSON.stringify(input.geom)}),
        ${input.changedBy ?? null}
      )
    `)
  })
  return getRegion(db, input.id) // 新当前
}
