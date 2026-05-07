import { Queue } from 'bullmq'
import { loadEnv } from '@/env'

const env = loadEnv()

// BullMQ accepts a redis url string OR an ioredis instance
const connection = { url: env.REDIS_URL }

export const refreshQueue = new Queue<{ predictionId: string; kind: 'INCR' | 'FULL' }>('refresh', { connection })
export const fullRecalcQueue = new Queue<{ predictionId: string }>('full-recalc', { connection })
export const newsIngestQueue = new Queue<{ keywords: string[] }>('news-ingest', { connection })
export const dispatchQueue = new Queue<{ predictionId: string; adapterKey: string }>('dispatch', { connection })

export async function closeAllQueues() {
  await Promise.allSettled([
    refreshQueue.close(),
    fullRecalcQueue.close(),
    newsIngestQueue.close(),
    dispatchQueue.close(),
  ])
}
