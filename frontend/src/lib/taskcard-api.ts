import { api } from './api'

export type TaskCard = {
  id: string
  name: string
  description: string | null
  vehicleClassId: string
  taskClassId: string
  regionId: string
  regionVersion: number
  targetWindowDate: string
  targetWindowHalf: 'AM' | 'PM'
  createdBy: string
  createdAt: string
}

export type CreateTaskCardBody = {
  name: string
  description?: string
  vehicleClassId: string
  taskClassId: string
  regionId: string
  regionVersion: number
  targetWindowDate: string
  targetWindowHalf: 'AM' | 'PM'
}

export async function listTaskCards(): Promise<TaskCard[]> {
  return api<TaskCard[]>('/taskcards')
}

export async function createTaskCard(body: CreateTaskCardBody): Promise<TaskCard> {
  return api<TaskCard>('/taskcards', { method: 'POST', body: JSON.stringify(body) })
}
