import { sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { loadEnv } from '@/env'

/**
 * Plan-PP fix9 — 把 LLM 抽取的地名解析为 region.id/version:
 *   1. 进程内 cache:同名 location 不重复调高德
 *   2. 行政区映射:locationDistrict 命中现有 ADMIN_NAMED region 直接用(免外部 API)
 *   3. AD_HOC by name:locationFine 已经在 regions 表里有同名 AD_HOC,直接复用
 *   4. 高德 Geocode:调 https://restapi.amap.com/v3/geocode/geo 拿 lat/lng
 *   5. 200m × 200m 方框 polygon → INSERT AD_HOC region 返 id
 *   6. 全部失败 → null,调用方 fallback 到 wl.regionId
 *
 * 注意:AMAP_GEOCODE_KEY 空时直接跳到步骤 1-3,4-5 不走;能命中就命中,不能命中就 null。
 */

export type ResolvedRegion = {
  id: string
  version: number
  source: 'admin-cache' | 'ad-hoc-cache' | 'amap-geocode' | 'admin-named' | 'ad-hoc-existing'
}

// 进程内 cache:key = `${district}|${fine}`,value = ResolvedRegion(命中)或 null(已知不可解析)
const cache = new Map<string, ResolvedRegion | null>()

export async function resolveOrCreateRegion(
  db: Db,
  opts: { locationFine?: string; locationDistrict?: string },
): Promise<ResolvedRegion | null> {
  const fine = opts.locationFine?.trim()
  const district = opts.locationDistrict?.trim()
  if (!fine && !district) return null

  const cacheKey = `${district ?? ''}|${fine ?? ''}`
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null

  // 1. fine 命中现有 AD_HOC region(LLM 反复抽到同一地名时复用)
  if (fine) {
    const hit = await findRegionByName(db, fine, 'AD_HOC')
    if (hit) {
      const r: ResolvedRegion = { ...hit, source: 'ad-hoc-existing' }
      cache.set(cacheKey, r)
      return r
    }
  }

  // 2. district 命中现有 ADMIN_NAMED region(优先精度高的 — 街道 > 区 > 市)
  if (district) {
    const adm = await findAdminRegionByDistrictLabel(db, district)
    if (adm) {
      // 如果 LLM 也给了 fine,优先建/复用 fine 的 AD_HOC,失败再退到 admin
      if (fine) {
        const fineRegion = await tryGeocodeAndCreate(db, fine, adm)
        if (fineRegion) {
          cache.set(cacheKey, fineRegion)
          return fineRegion
        }
      }
      const r: ResolvedRegion = { ...adm, source: 'admin-named' }
      cache.set(cacheKey, r)
      return r
    }
  }

  // 3. 没有 admin 命中,但有 fine → 直接高德 geocode,parent_id = null
  if (fine) {
    const fineRegion = await tryGeocodeAndCreate(db, fine, null)
    if (fineRegion) {
      cache.set(cacheKey, fineRegion)
      return fineRegion
    }
  }

  cache.set(cacheKey, null)
  return null
}

async function findRegionByName(
  db: Db,
  name: string,
  kind: 'AD_HOC' | 'ADMIN_NAMED',
): Promise<{ id: string; version: number } | null> {
  const rows = await db.execute<{ id: string; version: number }>(sql`
    SELECT id, version FROM regions
    WHERE name = ${name} AND kind = ${kind} AND effective_to IS NULL
    LIMIT 1
  `)
  const arr = rows as unknown as Array<{ id: string; version: number }>
  return arr[0] ?? null
}

/**
 * 行政区标签命中:LLM 给的 district 是字符串(例:"广州市天河区天河南街道"),
 * 我们按"包含子串" + "ADMIN_NAMED" 找最匹配的 region。
 * 优先策略:取最长名字命中(更精细的街道优于市/区)。
 */
async function findAdminRegionByDistrictLabel(
  db: Db,
  label: string,
): Promise<{ id: string; version: number } | null> {
  const rows = await db.execute<{ id: string; version: number; name: string }>(sql`
    SELECT id, version, name FROM regions
    WHERE kind = 'ADMIN_NAMED'
      AND effective_to IS NULL
      AND position(name in ${label}) > 0
    ORDER BY length(name) DESC
    LIMIT 1
  `)
  const arr = rows as unknown as Array<{ id: string; version: number; name: string }>
  return arr[0] ?? null
}

/**
 * 高德 geocode → lat/lng → 200m × 200m 方框 polygon → INSERT AD_HOC region。
 * 失败(无 key / API 错 / 解析空)→ null。
 */
async function tryGeocodeAndCreate(
  db: Db,
  fine: string,
  parent: { id: string; version: number } | null,
): Promise<ResolvedRegion | null> {
  const env = loadEnv()
  if (!env.AMAP_GEOCODE_KEY) return null

  const center = await amapGeocode(fine, env.AMAP_GEOCODE_KEY)
  if (!center) return null

  const polygon = build200mBox(center.lng, center.lat)
  try {
    const inserted = await db.execute<{ id: string; version: number }>(sql`
      INSERT INTO regions (kind, name, parent_id, version, geom)
      VALUES (
        'AD_HOC',
        ${fine},
        ${parent ? sql`${parent.id}::uuid` : sql`NULL`},
        1,
        ST_GeomFromGeoJSON(${JSON.stringify(polygon)})
      )
      RETURNING id, version
    `)
    const arr = inserted as unknown as Array<{ id: string; version: number }>
    const row = arr[0]
    if (!row) return null
    return { id: row.id, version: row.version, source: 'amap-geocode' }
  } catch (e) {
    console.warn(`[location-resolver] INSERT AD_HOC region failed for "${fine}": ${(e as Error).message}`)
    return null
  }
}

type GeocodeResult = { lng: number; lat: number }

async function amapGeocode(address: string, key: string): Promise<GeocodeResult | null> {
  try {
    const url = `https://restapi.amap.com/v3/geocode/geo?key=${encodeURIComponent(key)}&address=${encodeURIComponent(address)}&city=广州&output=JSON`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) {
      console.warn(`[location-resolver] amap HTTP ${res.status} for "${address}"`)
      return null
    }
    const json = (await res.json()) as {
      status?: string
      info?: string
      geocodes?: Array<{ location?: string }>
    }
    if (json.status !== '1' || !json.geocodes?.length) {
      console.warn(`[location-resolver] amap empty for "${address}" (info=${json.info ?? '?'})`)
      return null
    }
    const loc = json.geocodes[0]!.location
    if (!loc) return null
    const [lngStr, latStr] = loc.split(',')
    const lng = Number.parseFloat(lngStr ?? '')
    const lat = Number.parseFloat(latStr ?? '')
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
    return { lng, lat }
  } catch (e) {
    console.warn(`[location-resolver] amap fetch error for "${address}": ${(e as Error).message}`)
    return null
  }
}

/**
 * 用中心点 (lng, lat) 造 200m × 200m 闭合 polygon(正方形)。
 * 经度 1° ≈ 111km × cos(lat),纬度 1° ≈ 111km。
 * 100m = 0.001 / cos(lat) lng-deg, 0.0009 lat-deg。
 */
export function build200mBox(lng: number, lat: number): GeoJSON.Polygon {
  const dLat = 100 / 111_000  // 100m in lat-degrees
  const dLng = 100 / (111_000 * Math.cos((lat * Math.PI) / 180))
  // 闭合环,4 角 + 起点
  const ring: [number, number][] = [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ]
  return { type: 'Polygon', coordinates: [ring] }
}

/** 测试 / 调试用 */
export function clearLocationResolverCache(): void {
  cache.clear()
}
