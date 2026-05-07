import { randomUUID } from 'node:crypto'
import type { CameraAdapter, CancelAck, DispatchAck, DispatchRequest, DispatchStatus } from '../types'

/**
 * Mock camera adapter — m2 placeholder for real backends (EX-2 deferred to m3).
 * Acks immediately, returns a fake external_id, never actually monitors anything.
 * State transitions in real backends arrive via webhook (m3); the mock has no callback.
 */
export class MockCameraAdapter implements CameraAdapter {
  readonly key = 'mock'

  async dispatch(_req: DispatchRequest): Promise<DispatchAck> {
    return {
      externalId: `mock-${randomUUID()}`,
      acceptedAt: new Date().toISOString(),
    }
  }

  async cancel(externalId: string, _idempotencyKey: string): Promise<CancelAck> {
    return { externalId, cancelledAt: new Date().toISOString() }
  }

  async pollStatus(externalId: string): Promise<DispatchStatus> {
    // Mock always reports IN_PROGRESS — m3 will replace with real state machine
    return { externalId, state: 'IN_PROGRESS' }
  }

  /**
   * Stub for simulated outgoing webhook signing — m3 real backends will sign
   * with their own secret. Mock returns empty string; tests don't verify it.
   */
  signOutgoing(_rawBody: string): string {
    return ''
  }
}
