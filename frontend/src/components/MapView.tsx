import { useEffect, useRef } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'

const AMAP_KEY = import.meta.env.VITE_AMAP_API_KEY ?? ''

export function MapView({ height = 280 }: { height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)

  useEffect(() => {
    if (!AMAP_KEY || !ref.current) return
    let cancelled = false
    AMapLoader.load({ key: AMAP_KEY, version: '2.0', plugins: [] })
      .then((AMap) => {
        if (cancelled || !ref.current) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mapRef.current = new (AMap as any).Map(ref.current, { zoom: 10, center: [113.27, 23.13] })
      }).catch((e) => console.error('amap load failed', e))
    return () => { cancelled = true; mapRef.current?.destroy?.() }
  }, [])

  if (!AMAP_KEY) {
    return (
      <div className="map-stub" style={{ height }}>
        <div className="map-stub__grid" />
        <div className="map-stub__attribution">地图占位 · 配置 VITE_AMAP_API_KEY 后启用</div>
      </div>
    )
  }
  return <div ref={ref} style={{ height }} className="map-stub" />
}
