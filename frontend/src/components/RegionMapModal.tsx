/// <reference types="vite/client" />
import { useEffect, useRef, useState } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'
import { Btn } from './Btn'
import { getRegion, type RegionDetail } from '@/lib/region-api'

const AMAP_KEY = (import.meta.env.VITE_AMAP_API_KEY as string | undefined) ?? ''

/**
 * 弹窗:展示一个 region 的 polygon — 居中显示 + fitView。
 * 数据源:GET /api/regions/:id?version=N → GeoJSON Polygon。
 * 无 VITE_AMAP_API_KEY 时降级为坐标点列表 + 极简 SVG 草图。
 */
export function RegionMapModal({
  open, regionId, regionVersion, regionName, onClose,
}: {
  open: boolean
  regionId: string | null
  regionVersion: number | null
  regionName: string | null
  onClose: () => void
}) {
  const [region, setRegion] = useState<RegionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mapBoxRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)

  useEffect(() => {
    if (!open || !regionId) return
    setRegion(null)
    setError(null)
    getRegion(regionId, regionVersion ?? undefined)
      .then(setRegion)
      .catch((e) => setError((e as Error).message))
  }, [open, regionId, regionVersion])

  useEffect(() => {
    if (!open || !region || !AMAP_KEY || !mapBoxRef.current) return
    let cancelled = false
    AMapLoader.load({ key: AMAP_KEY, version: '2.0', plugins: [] })
      .then((AMap) => {
        if (cancelled || !mapBoxRef.current) return
        const ring = region.geom.coordinates[0] ?? []
        const path = ring.map((p) => [p[0], p[1]] as [number, number])
        const center = computeCentroid(path)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const A = AMap as any
        // 200m 方框对应 zoom ~18,直接 setFitView 会贴满边缘;预设 zoom=17 给视野
        const map = new A.Map(mapBoxRef.current, { zoom: 17, center, viewMode: '2D' })
        mapRef.current = map
        const poly = new A.Polygon({
          path,
          strokeColor: '#4ea1ff',
          strokeWeight: 2,
          fillColor: '#4ea1ff',
          fillOpacity: 0.18,
        })
        map.add(poly)
        // fitView with generous padding, then cap zoom to 17 max(避免过度放大空地)
        map.setFitView([poly], false, [80, 80, 80, 80])
        // 加中心点 marker 帮助用户定位
        new A.Marker({ position: center, map })
        // 若 fitView 把 zoom 推过头,拉回 17
        setTimeout(() => { if (map.getZoom() > 17) map.setZoom(17) }, 100)
      })
      .catch((e) => setError(`地图加载失败:${(e as Error).message}`))
    return () => {
      cancelled = true
      mapRef.current?.destroy?.()
      mapRef.current = null
    }
  }, [open, region])

  if (!open || !regionId) return null

  const title = regionName ?? (region?.name ?? regionId.slice(0, 8))
  const ringCoords = region?.geom.coordinates[0] ?? []

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(840px, 92vw)',
          background: 'var(--c-panel, #161a23)',
          border: '1px solid var(--c-border, #2a2f3a)',
          borderRadius: 8,
          padding: 'var(--sp-4)',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--sp-3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <div style={{ fontSize: 'var(--fs-4)', fontWeight: 600 }}>{title}</div>
            <div style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)', fontFamily: 'monospace', marginTop: 2 }}>
              {regionId.slice(0, 8)}…{regionVersion !== null ? ` v${regionVersion}` : ''}
              {region && ` · ${region.kind}`}
              {ringCoords.length > 0 && ` · ${ringCoords.length} 顶点`}
            </div>
          </div>
          <Btn size="sm" onClick={onClose}>关闭 ×</Btn>
        </div>

        {error && (
          <div style={{ color: 'var(--c-bad)', fontSize: 'var(--fs-2)' }}>{error}</div>
        )}

        {!region && !error && (
          <div className="empty" style={{ padding: 'var(--sp-5)' }}>加载区域…</div>
        )}

        {region && (
          <>
            {AMAP_KEY ? (
              <div ref={mapBoxRef} style={{ width: '100%', height: 460, borderRadius: 6, overflow: 'hidden' }} />
            ) : (
              <PolygonSvgFallback coordinates={ringCoords} />
            )}
            <details style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)' }}>
              <summary style={{ cursor: 'pointer' }}>坐标点序列 (Polygon, {ringCoords.length} 点)</summary>
              <pre style={{
                marginTop: 6, padding: 'var(--sp-2)', maxHeight: 180, overflow: 'auto',
                background: 'var(--c-panel-2, #1a1f2b)', borderRadius: 4, fontSize: 11,
              }}>
                {JSON.stringify(ringCoords, null, 2)}
              </pre>
            </details>
          </>
        )}
      </div>
    </div>
  )
}

/** 取多边形重心(简单算术平均;polygon 闭合点不去重也无妨) */
function computeCentroid(path: [number, number][]): [number, number] {
  if (path.length === 0) return [113.27, 23.13]  // 广州市中心兜底
  let sx = 0, sy = 0
  for (const [x, y] of path) { sx += x; sy += y }
  return [sx / path.length, sy / path.length]
}

/** 无 AMAP key 时的兜底:把 polygon 投影到 SVG 视口画轮廓。 */
function PolygonSvgFallback({ coordinates }: { coordinates: number[][] }) {
  if (coordinates.length < 3) {
    return (
      <div className="map-stub" style={{ height: 460, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-muted)' }}>
        坐标点不足无法绘制(需 ≥ 3 顶点)
      </div>
    )
  }
  const xs = coordinates.map((p) => p[0] ?? 0)
  const ys = coordinates.map((p) => p[1] ?? 0)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const W = 800, H = 440
  // Plan-PP fix10:加 200% 留白(polygon 占视口 ~33%),polygon 真正居中
  const rawX = (maxX - minX) || 1
  const rawY = (maxY - minY) || 1
  const sx = rawX * 3
  const sy = rawY * 3
  const k = Math.min(W / sx, H / sy)
  // 视口中心
  const cx = W / 2, cy = H / 2
  // polygon 数据空间中心
  const dataCx = (minX + maxX) / 2, dataCy = (minY + maxY) / 2
  const px = (x: number) => cx + (x - dataCx) * k
  // 纬度向上为正,SVG y 向下为正 — 翻转
  const py = (y: number) => cy - (y - dataCy) * k
  const points = coordinates.map((p) => `${px(p[0] ?? 0).toFixed(1)},${py(p[1] ?? 0).toFixed(1)}`).join(' ')
  // 网格背景,给一点地图感
  const gridStep = 40
  const gridLines: React.ReactNode[] = []
  for (let x = 0; x <= W; x += gridStep) {
    gridLines.push(<line key={`vx${x}`} x1={x} y1={0} x2={x} y2={H} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />)
  }
  for (let y = 0; y <= H; y += gridStep) {
    gridLines.push(<line key={`hy${y}`} x1={0} y1={y} x2={W} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />)
  }
  return (
    <div style={{ width: '100%', height: 460, background: 'var(--c-panel-2, #1a1f2b)', borderRadius: 6, overflow: 'hidden' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
        <rect width={W} height={H} fill="transparent" />
        {gridLines}
        <polygon points={points} fill="rgba(78,161,255,0.18)" stroke="#4ea1ff" strokeWidth={2} />
        <circle cx={cx} cy={cy} r={3} fill="#4ea1ff" />
        <text x={8} y={H - 8} fill="rgba(255,255,255,0.4)" fontSize={11}>
          地图占位 · 配置 VITE_AMAP_API_KEY 启用真实底图
        </text>
      </svg>
    </div>
  )
}
