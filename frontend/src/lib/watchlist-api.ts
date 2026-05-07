import { api } from './api'

export type WatchList = {
  id: string
  name: string
  description: string | null
  vehicleClassId: string
  taskClassId: string
  regionId: string
  regionVersion: number
  kRangeMin: number
  kRangeMax: number
  isActive: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type CreateWatchListBody = {
  name: string
  description?: string
  vehicleClassId: string
  taskClassId: string
  regionId: string
  regionVersion: number
  kRangeMin?: number
  kRangeMax?: number
}

export async function listWatchLists(activeOnly = false): Promise<WatchList[]> {
  return api<WatchList[]>(`/watchlists${activeOnly ? '?active=true' : ''}`)
}

export async function createWatchList(body: CreateWatchListBody): Promise<WatchList> {
  return api<WatchList>('/watchlists', { method: 'POST', body: JSON.stringify(body) })
}

export async function setWatchListActive(id: string, isActive: boolean): Promise<WatchList> {
  return api<WatchList>(`/watchlists/${id}/active`, {
    method: 'PATCH', body: JSON.stringify({ isActive }),
  })
}
