import { describe, expect, test } from 'bun:test'

/**
 * Plan-D Task 10 — A1 acceptance integration test.
 *
 * Spec ISC-Anti.2: `--integration` flag OFF means m4 e2e never calls
 * external APIs. This file is GUARANTEED skipped in default `bun test`
 * runs because INTEGRATION_TESTS is unset; only `bun run test:integration`
 * (which exports INTEGRATION_TESTS=true) will run it.
 *
 * When run, the test exercises the real customer (打真客户) backend:
 *   1. Build adapter from env (REAL_GZP_API_KEY, REAL_GZP_BACKEND_URL).
 *   2. Send a [TEST]-prefixed dispatch.
 *   3. Verify externalId + acceptedAt in the ack.
 *   4. Immediately cancel to avoid real camera deployment.
 */

const RUN_INTEGRATION = process.env.INTEGRATION_TESTS === 'true'

describe.skipIf(!RUN_INTEGRATION)('real-gzp integration (打真客户 backend)', () => {
  test('REAL_GZP_API_KEY + REAL_GZP_BACKEND_URL set + dispatch returns externalId', async () => {
    if (!process.env.REAL_GZP_API_KEY) {
      throw new Error('REAL_GZP_API_KEY required for integration test')
    }
    if (!process.env.REAL_GZP_BACKEND_URL) {
      throw new Error('REAL_GZP_BACKEND_URL required for integration test')
    }

    const { RealGuangzhouPoliceCamAdapter } = await import('@/dispatch/adapters/real-gzp')

    const adapter = new RealGuangzhouPoliceCamAdapter({
      apiKey: process.env.REAL_GZP_API_KEY,
      webhookSecret: process.env.WEBHOOK_HMAC_SECRET ?? 'test-secret-32-chars-replace-prod',
      backendBaseUrl: process.env.REAL_GZP_BACKEND_URL,
      requestTimeoutMs: 30000,
    })

    const ack = await adapter.dispatch({
      predictionId: `[TEST]-pred-${Date.now()}`,
      paramsJson: {
        regionPolygon: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
        },
        timeWindow: {
          start: new Date().toISOString(),
          end: new Date(Date.now() + 3600_000).toISOString(),
        },
        vehicleClass: 'patrol',
      },
    })
    expect(ack.externalId).toBeTruthy()
    expect(ack.acceptedAt).toBeTruthy()

    // Immediately cancel to prevent actual camera deployment.
    const cancelAck = await adapter.cancel(ack.externalId, `cancel-test-${Date.now()}`)
    expect(cancelAck.externalId).toBe(ack.externalId)
  }, 30000)
})
