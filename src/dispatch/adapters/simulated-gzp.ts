import { randomUUID } from 'node:crypto'
import { computeSignature } from '@/webhook/signature'
import type { CameraAdapter, CancelAck, DispatchAck, DispatchRequest, DispatchStatus } from '../types'

export type SimulatedGzpConfig = {
  apiKey: string
  webhookSecret: string
  webhookUrl: string
  fakeMediaBaseUrl: string
  /** Default 5000 in production; tests override to small values. */
  inProgressDelayMs: number
  /** Default 30000 in production; tests override. */
  completedDelayMs: number
  /** Default 5000 in production; tests override (was hardcoded in draft). */
  cancelDelayMs: number
}

/**
 * 模拟广东省警务摄像头 backend.
 * - dispatch() 立即 ack, 返回 fake external_id
 * - 内部 setTimeout 模拟 IN_PROGRESS / COMPLETED 状态推进, 反向 POST webhook
 * - 每次 webhook 请求带 HMAC 签名 + idempotency_key
 * - cancel() 接到后 cancelDelayMs 内反向 webhook CANCELLED
 *
 * Timer refs are .unref()'d so they don't keep the bun event loop alive after tests finish.
 */
export class SimulatedGuangzhouPoliceCamAdapter implements CameraAdapter {
  readonly key = 'simulated-gzp'

  constructor(private cfg: SimulatedGzpConfig) {}

  async dispatch(req: DispatchRequest): Promise<DispatchAck> {
    const externalId = `gzp-${randomUUID()}`
    const acceptedAt = new Date().toISOString()
    this.scheduleUnref(() => this.fireProgress(externalId, req.predictionId), this.cfg.inProgressDelayMs)
    this.scheduleUnref(() => this.fireCompleted(externalId, req.predictionId), this.cfg.completedDelayMs)
    return { externalId, acceptedAt }
  }

  async cancel(externalId: string, idempotencyKey: string): Promise<CancelAck> {
    this.scheduleUnref(() => this.fireCancelled(externalId, idempotencyKey), this.cfg.cancelDelayMs)
    return { externalId, cancelledAt: new Date().toISOString() }
  }

  async pollStatus(externalId: string): Promise<DispatchStatus> {
    // m3: status 改由 webhook 推, pollStatus 只回报占位状态
    return { externalId, state: 'IN_PROGRESS' }
  }

  signOutgoing(rawBody: string): string {
    return computeSignature(rawBody, this.cfg.webhookSecret)
  }

  // --- internals ---

  private scheduleUnref(fn: () => void, ms: number): void {
    const t = setTimeout(fn, ms)
    // bun's setTimeout returns Timer with optional unref(); guard for environments without it
    ;(t as unknown as { unref?: () => void }).unref?.()
  }

  private async fireProgress(externalId: string, _predictionId: string): Promise<void> {
    const body = JSON.stringify({ externalId, state: 'IN_PROGRESS', ts: new Date().toISOString() })
    await this.postWebhook(body, `progress-${externalId}`)
  }

  private async fireCompleted(externalId: string, _predictionId: string): Promise<void> {
    const mediaUrls = [
      `${this.cfg.fakeMediaBaseUrl}${externalId}-1.jpg`,
      `${this.cfg.fakeMediaBaseUrl}${externalId}-2.jpg`,
    ]
    const body = JSON.stringify({
      externalId,
      state: 'COMPLETED',
      mediaUrls,
      capturedAt: new Date().toISOString(),
      meta: { vehicleType: 'detected', trackingPath: [[113.27, 23.13], [113.28, 23.14]] },
    })
    await this.postWebhook(body, `completed-${externalId}`)
  }

  private async fireCancelled(externalId: string, originalIdem: string): Promise<void> {
    const body = JSON.stringify({ externalId, state: 'CANCELLED', ts: new Date().toISOString() })
    await this.postWebhook(body, `cancelled-${externalId}-${originalIdem}`)
  }

  private async postWebhook(body: string, idempotencyKey: string): Promise<void> {
    const signature = this.signOutgoing(body)
    try {
      await fetch(this.cfg.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signature,
          'X-Idempotency-Key': idempotencyKey,
          'X-Adapter-Key': this.key,
        },
        body,
      })
    } catch (e) {
      console.error(`[simulated-gzp] webhook post failed:`, (e as Error).message)
    }
  }
}
