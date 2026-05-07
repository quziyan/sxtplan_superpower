import type { Db } from '@/db/client'
import { getAdapter } from '@/dispatch/adapter-pool'
import { advanceFromWebhook } from '@/dispatch/service'
import type { DispatchState } from '@/dispatch/state-machine'
import { mediaFetchQueue as defaultMediaFetchQueue } from '@/scheduler/queue'
import { markFailed, markProcessed, persistEnvelope } from './envelope'
import { verifySignature } from './signature'

export type IngestRawRequest = {
  adapterKey: string
  rawBody: string
  // headers MUST be lowercased by the caller (route layer)
  headers: Record<string, string>
}

export type IngestStatus = 'PROCESSED' | 'DUPLICATE' | 'INVALID_SIG' | 'INVALID_ADAPTER'

export type IngestResult = {
  envelopeId: string
  status: IngestStatus
}

/**
 * Minimal queue surface processIngest depends on. The real `mediaFetchQueue`
 * (BullMQ) satisfies this; tests inject a recording stub to avoid Redis.
 */
export type MediaFetchQueueLike = {
  add: (
    name: string,
    data: { dispatchId: string; sourceUrl: string; mediaType: 'image' | 'video' | 'metadata' },
  ) => Promise<unknown>
}

export type ProcessIngestDeps = {
  mediaFetchQueue?: MediaFetchQueueLike
}

type WebhookBody = {
  externalId: string
  state: string
  mediaUrls?: string[]
  meta?: Record<string, unknown>
}

function parseBody(raw: string): WebhookBody {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('invalid JSON body')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('webhook body must be a JSON object')
  }
  const obj = parsed as Record<string, unknown>
  const externalId = obj.externalId
  const state = obj.state
  if (typeof externalId !== 'string' || externalId.length === 0) {
    throw new Error('webhook body missing externalId')
  }
  if (typeof state !== 'string' || state.length === 0) {
    throw new Error('webhook body missing state')
  }
  const out: WebhookBody = { externalId, state }
  if (Array.isArray(obj.mediaUrls)) {
    const urls: string[] = []
    for (const u of obj.mediaUrls) {
      if (typeof u === 'string') urls.push(u)
    }
    if (urls.length > 0) out.mediaUrls = urls
  }
  if (typeof obj.meta === 'object' && obj.meta !== null) {
    out.meta = obj.meta as Record<string, unknown>
  }
  return out
}

export async function processIngest(
  db: Db,
  secret: string,
  req: IngestRawRequest,
  deps: ProcessIngestDeps = {},
): Promise<IngestResult> {
  try {
    getAdapter(req.adapterKey)
  } catch {
    return { envelopeId: '', status: 'INVALID_ADAPTER' }
  }

  const idempotencyKey =
    req.headers['x-idempotency-key'] ?? `auto-${Date.now()}-${Math.random()}`
  const sig = req.headers['x-signature']
  let sigStatus: 'OK' | 'INVALID' | 'MISSING'
  if (!sig) sigStatus = 'MISSING'
  else if (verifySignature(req.rawBody, sig, secret)) sigStatus = 'OK'
  else sigStatus = 'INVALID'

  const env = await persistEnvelope(db, {
    adapterKey: req.adapterKey,
    idempotencyKey,
    sigStatus,
    rawHeaders: req.headers,
    rawBody: req.rawBody,
  })

  if (env.isDuplicate) return { envelopeId: env.id, status: 'DUPLICATE' }
  if (sigStatus !== 'OK') return { envelopeId: env.id, status: 'INVALID_SIG' }

  // OK + non-duplicate → drive the dispatch state machine inline. Any failure
  // (parse error, unknown dispatch, illegal transition, optimistic-lock loss,
  // media-enqueue failure) is caught and recorded on the envelope row via
  // `markFailed`. The HTTP response shape is preserved (status: 'PROCESSED')
  // because the request itself was understood and persisted — the envelope's
  // `status` column reflects the *internal* processing outcome.
  const queue = deps.mediaFetchQueue ?? defaultMediaFetchQueue
  try {
    const parsed = parseBody(req.rawBody)
    const updated = await advanceFromWebhook(db, {
      adapterKey: req.adapterKey,
      externalId: parsed.externalId,
      newState: parsed.state as DispatchState,
      ...(parsed.meta ? { payload: parsed.meta } : {}),
    })
    if (parsed.mediaUrls && parsed.mediaUrls.length > 0) {
      for (const url of parsed.mediaUrls) {
        await queue.add('fetch', {
          dispatchId: updated.id,
          sourceUrl: url,
          mediaType: 'image',
        })
      }
    }
    await markProcessed(db, env.id, updated.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await markFailed(db, env.id, msg)
  }

  return { envelopeId: env.id, status: 'PROCESSED' }
}
