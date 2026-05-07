import type { Db } from '@/db/client'
import { getAdapter } from '@/dispatch/adapter-pool'
import { persistEnvelope } from './envelope'
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

export async function processIngest(
  db: Db,
  secret: string,
  req: IngestRawRequest,
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

  return { envelopeId: env.id, status: 'PROCESSED' }
}
