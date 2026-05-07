import { api } from './api'

// Lightweight summary for region pickers (NewWatchListModal, etc.).
// Backend default returns ADMIN_NAMED current-effective only; pass kind='ALL'
// to also include AD_HOC. Pickers nearly always want NAMED so we default to it.
export type RegionListItem = {
  id: string
  kind: 'ADMIN_NAMED' | 'AD_HOC'
  name: string | null
  version: number
}

export async function listRegions(opts: { kind?: 'ADMIN_NAMED' | 'AD_HOC' | 'ALL' } = {}): Promise<RegionListItem[]> {
  const kind = opts.kind ?? 'ADMIN_NAMED'
  const qs = kind === 'ADMIN_NAMED' ? '' : `?kind=${kind}`
  return api<RegionListItem[]>(`/regions${qs}`)
}
