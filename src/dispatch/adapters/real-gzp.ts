import { randomUUID } from 'node:crypto'
import { computeSignature } from '@/webhook/signature'
import type { CameraAdapter, CancelAck, DispatchAck, DispatchRequest, DispatchStatus } from '../types'

export type RealGzpConfig = {
  /** EX-8 customer-supplied real API key. */
  apiKey: string
  /** Matches WEBHOOK_HMAC_SECRET — used for outgoing X-Signature on /dispatch & /cancel. */
  webhookSecret: string
  /** Customer backend, e.g. https://camera.example.com.cn */
  backendBaseUrl: string
  /** Per-request timeout in ms, default 30s in production. */
  requestTimeoutMs: number
}

/**
 * Real Guangzhou Police camera backend adapter — talks to the customer's actual service.
 * Contract: docs/integrations/customer-camera-api-v0.1.md (Task 6).
 *
 * Adapter does NOT process webhook callbacks — that is WebhookIngest's job.
 * Adapter only calls customer's POST /dispatch + POST /cancel.
 *
 * Wire body mirrors the customer contract: `predictionId` plus optional
 * `regionPolygon` / `timeWindow` / `vehicleClass` / `priority` / `metadata`
 * extracted from `DispatchRequest.paramsJson` (which is the codebase's
 * generic carrier for backend-specific dispatch parameters).
 */
export class RealGuangzhouPoliceCamAdapter implements CameraAdapter {
  readonly key = 'real-gzp'

  constructor(private cfg: RealGzpConfig) {}

  async dispatch(req: DispatchRequest): Promise<DispatchAck> {
    const url = new URL('/dispatch', this.cfg.backendBaseUrl)
    const params = req.paramsJson ?? {}
    const body = JSON.stringify({
      predictionId: req.predictionId,
      regionPolygon: params.regionPolygon ?? null,
      timeWindow: params.timeWindow ?? null,
      vehicleClass: params.vehicleClass ?? null,
      priority: params.priority ?? null,
      metadata: params.metadata ?? null,
    })
    const signature = computeSignature(body, this.cfg.webhookSecret)
    const idempotencyKey = `dispatch-${req.predictionId}-${randomUUID()}`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.cfg.apiKey,
        'X-Idempotency-Key': idempotencyKey,
        'X-Signature': signature,
      },
      body,
      signal: AbortSignal.timeout(this.cfg.requestTimeoutMs),
    })

    if (!res.ok) {
      throw new Error(`real-gzp dispatch failed: HTTP ${res.status} - ${await res.text()}`)
    }

    const json = (await res.json()) as { externalId: string; acceptedAt: string }
    return { externalId: json.externalId, acceptedAt: json.acceptedAt }
  }

  async cancel(externalId: string, idempotencyKey: string): Promise<CancelAck> {
    const url = new URL('/cancel', this.cfg.backendBaseUrl)
    const body = JSON.stringify({ externalId })
    const signature = computeSignature(body, this.cfg.webhookSecret)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.cfg.apiKey,
        'X-Idempotency-Key': idempotencyKey,
        'X-Signature': signature,
      },
      body,
      signal: AbortSignal.timeout(this.cfg.requestTimeoutMs),
    })

    if (!res.ok) {
      throw new Error(`real-gzp cancel failed: HTTP ${res.status}`)
    }

    const json = (await res.json()) as { externalId: string; cancelledAt: string }
    return { externalId: json.externalId, cancelledAt: json.cancelledAt }
  }

  async pollStatus(externalId: string): Promise<DispatchStatus> {
    // m4: real-gzp has no poll endpoint — status is pushed via webhook. Return placeholder.
    return { externalId, state: 'IN_PROGRESS' }
  }

  signOutgoing(rawBody: string): string {
    return computeSignature(rawBody, this.cfg.webhookSecret)
  }
}
