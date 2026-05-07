import { describe, expect, test } from 'bun:test'
import { createBullMQWorker } from '@/scheduler/helpers/createBullMQWorker'

async function redisReachable(): Promise<boolean> {
  try {
    const IORedis = (await import('ioredis')).default
    const c = new IORedis({ lazyConnect: true })
    await c.connect()
    await c.quit()
    return true
  } catch {
    return false
  }
}
const REDIS_OK = await redisReachable()

describe('createBullMQWorker helper', () => {
  test.skipIf(!REDIS_OK)('creates Worker with default REDIS_URL connection', async () => {
    const w = createBullMQWorker({
      name: 'test-helper-worker',
      handler: async () => ({ ok: true }),
    })
    expect(w.name).toBe('test-helper-worker')
    await w.close()
  })

  test.skipIf(!REDIS_OK)('accepts custom connection override', async () => {
    const w = createBullMQWorker({
      name: 'test-helper-worker-custom',
      handler: async () => ({ ok: true }),
      connection: { host: 'localhost', port: 6379 },
    })
    expect(w.name).toBe('test-helper-worker-custom')
    await w.close()
  })
})
