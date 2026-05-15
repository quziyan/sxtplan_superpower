import { api } from './api'

export type AdminNewsItem = {
  id: string
  url: string
  title: string
  sourceKind: string
  sourceLabel: string
  summaryZh: string | null
  publishedAt: string | null
  fetchedAt: string
  matchedRegions: string[]
  evidenceCount: number
}

export type ListNewsItemsResp = {
  total: number
  limit: number
  offset: number
  items: AdminNewsItem[]
}

export type ListNewsItemsOpts = {
  q?: string
  limit?: number
  offset?: number
  hasEvidence?: 'true' | 'false' | 'all'
}

export async function listAdminNewsItems(opts: ListNewsItemsOpts = {}): Promise<ListNewsItemsResp> {
  const p = new URLSearchParams()
  if (opts.q) p.set('q', opts.q)
  if (opts.limit !== undefined) p.set('limit', String(opts.limit))
  if (opts.offset !== undefined) p.set('offset', String(opts.offset))
  if (opts.hasEvidence) p.set('hasEvidence', opts.hasEvidence)
  const qs = p.toString()
  return api<ListNewsItemsResp>(`/admin/news-items${qs ? '?' + qs : ''}`)
}

export type DeleteNewsItemResp =
  | { ok: true; id: string; deletedEvidence: number }
  | { error: { code: string; message: string }; evidenceCount: number }

export async function deleteAdminNewsItem(id: string, cascade = false): Promise<DeleteNewsItemResp> {
  return api<DeleteNewsItemResp>(`/admin/news-items/${id}${cascade ? '?cascade=true' : ''}`, {
    method: 'DELETE',
  })
}

export type BulkDeleteResp =
  | { ok: true; deleted: number; deletedEvidence: number }
  | { error: { code: string; message: string }; blockers: Array<{ newsId: string; n: number }> }

export async function bulkDeleteAdminNewsItems(ids: string[], cascade = false): Promise<BulkDeleteResp> {
  return api<BulkDeleteResp>(`/admin/news-items/bulk-delete`, {
    method: 'POST',
    body: JSON.stringify({ ids, cascade }),
  })
}

export async function purgeAllNewsItems(): Promise<{ ok: true; deletedEvidence: number; deletedNews: number }> {
  return api(`/admin/news-items/purge-all`, {
    method: 'POST',
    body: JSON.stringify({ confirm: 'DELETE_ALL' }),
  })
}
