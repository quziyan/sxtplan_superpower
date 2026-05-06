import { customType } from 'drizzle-orm/pg-core'

// PostGIS POLYGON stored as geometry(POLYGON,4326).
// Service layer wraps INSERT in ST_GeomFromGeoJSON and SELECT in ST_AsGeoJSON.
export const polygon = customType<{
  data: GeoJSON.Polygon
  driverData: string
}>({
  dataType() { return 'geometry(POLYGON,4326)' },
  toDriver(value: GeoJSON.Polygon): string { return JSON.stringify(value) },
  fromDriver(value: string): GeoJSON.Polygon { return JSON.parse(value) as GeoJSON.Polygon },
})
