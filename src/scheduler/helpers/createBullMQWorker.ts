import { Worker, type WorkerOptions, type Processor } from 'bullmq'
import { loadEnv } from '@/env'

export type CreateBullMQWorkerOptions<T, R = unknown> = {
  name: string
  handler: Processor<T, R>
  /** 可选：覆盖默认 connection 配置 */
  connection?: WorkerOptions['connection']
  /** 可选：其他 BullMQ Worker 选项（concurrency / autorun / limiter 等） */
  options?: Omit<WorkerOptions, 'connection'>
}

/**
 * 共享 BullMQ Worker boilerplate（env.REDIS_URL + 标准 connection 配置）。
 * m3 worker 复用此 helper，避免每个 worker 重复 `new Worker(...)` 模板。
 *
 * 默认 connection: `{ url: env.REDIS_URL }`。可通过 `connection` 覆盖；
 * 其它 BullMQ 选项（concurrency / autorun 等）通过 `options` 传入。
 */
export function createBullMQWorker<T = unknown, R = unknown>(
  opts: CreateBullMQWorkerOptions<T, R>,
): Worker<T, R> {
  const env = loadEnv()
  return new Worker<T, R>(
    opts.name,
    opts.handler,
    {
      ...opts.options,
      connection: opts.connection ?? { url: env.REDIS_URL },
    },
  )
}
