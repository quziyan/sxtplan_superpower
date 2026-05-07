import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SimulatedGuangzhouPoliceCamAdapter } from '@/dispatch/adapters/simulated-gzp'
import { computeSignature } from '@/webhook/signature'

type FetchCall = { url: string; init: { method?: string; headers?: Record<string, string>; body?: string } }

const baseCfg = {
  apiKey: 'test-api-key',
  webhookSecret: 'test-webhook-secret-12345',
  webhookUrl: 'http://localhost:9999/webhook/simulated-gzp',
  fakeMediaBaseUrl: 'http://fake-media.example.com/',
  inProgressDelayMs: 50,
  completedDelayMs: 100,
  cancelDelayMs: 30,
}

let calls: FetchCall[] = []
let originalFetch: typeof fetch

beforeEach(() => {
  calls = []
  originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as unknown as typeof fetch
})

afterEach(async () => {
  // Wait for any late-firing timers to resolve so they don't leak into next test
  await new Promise(r => setTimeout(r, 200))
  globalThis.fetch = originalFetch
})

describe('SimulatedGuangzhouPoliceCamAdapter', () => {
  test('dispatch() returns externalId with gzp- prefix', async () => {
    const adapter = new SimulatedGuangzhouPoliceCamAdapter(baseCfg)
    const ack = await adapter.dispatch({ predictionId: 'p-1', paramsJson: {} })
    expect(ack.externalId).toMatch(/^gzp-[0-9a-f-]+$/)
    expect(new Date(ack.acceptedAt).getTime()).toBeGreaterThan(0)
  })

  test('IN_PROGRESS webhook fires after inProgressDelayMs', async () => {
    const adapter = new SimulatedGuangzhouPoliceCamAdapter(baseCfg)
    const ack = await adapter.dispatch({ predictionId: 'p-prog', paramsJson: {} })

    // Wait long enough for IN_PROGRESS but not COMPLETED
    await new Promise(r => setTimeout(r, 75))

    const inProgressCalls = calls.filter(c => {
      const body = JSON.parse(c.init.body ?? '{}')
      return body.state === 'IN_PROGRESS'
    })
    expect(inProgressCalls.length).toBe(1)
    const firstCall = inProgressCalls[0]!
    expect(firstCall.url).toBe(baseCfg.webhookUrl)
    expect(firstCall.init.method).toBe('POST')
    const body = JSON.parse(firstCall.init.body!)
    expect(body.externalId).toBe(ack.externalId)
    expect(body.state).toBe('IN_PROGRESS')
  })

  test('COMPLETED webhook fires after completedDelayMs with mediaUrls', async () => {
    const adapter = new SimulatedGuangzhouPoliceCamAdapter(baseCfg)
    const ack = await adapter.dispatch({ predictionId: 'p-done', paramsJson: {} })

    await new Promise(r => setTimeout(r, 150))

    const completedCalls = calls.filter(c => {
      const body = JSON.parse(c.init.body ?? '{}')
      return body.state === 'COMPLETED'
    })
    expect(completedCalls.length).toBe(1)
    const body = JSON.parse(completedCalls[0]!.init.body!)
    expect(body.externalId).toBe(ack.externalId)
    expect(Array.isArray(body.mediaUrls)).toBe(true)
    expect(body.mediaUrls.length).toBe(2)
    expect(body.mediaUrls[0]).toBe(`${baseCfg.fakeMediaBaseUrl}${ack.externalId}-1.jpg`)
    expect(body.mediaUrls[1]).toBe(`${baseCfg.fakeMediaBaseUrl}${ack.externalId}-2.jpg`)
    expect(typeof body.capturedAt).toBe('string')
    expect(body.meta).toBeDefined()
  })

  test('cancel() triggers CANCELLED webhook after cancelDelayMs', async () => {
    const adapter = new SimulatedGuangzhouPoliceCamAdapter(baseCfg)
    const externalId = 'gzp-test-cancel-abc'
    const cancelAck = await adapter.cancel(externalId, 'idem-cancel-1')
    expect(cancelAck.externalId).toBe(externalId)
    expect(new Date(cancelAck.cancelledAt).getTime()).toBeGreaterThan(0)

    await new Promise(r => setTimeout(r, 60))

    const cancelledCalls = calls.filter(c => {
      const body = JSON.parse(c.init.body ?? '{}')
      return body.state === 'CANCELLED'
    })
    expect(cancelledCalls.length).toBe(1)
    const body = JSON.parse(cancelledCalls[0]!.init.body!)
    expect(body.externalId).toBe(externalId)
    expect(body.state).toBe('CANCELLED')
    // Idempotency key for cancelled webhook should embed the original idempotency key
    expect(cancelledCalls[0]!.init.headers!['X-Idempotency-Key']).toContain('idem-cancel-1')
  })

  test('signOutgoing produces HMAC matching computeSignature', () => {
    const adapter = new SimulatedGuangzhouPoliceCamAdapter(baseCfg)
    const body = JSON.stringify({ hello: 'world', n: 42 })
    const sig = adapter.signOutgoing(body)
    expect(sig).toBe(computeSignature(body, baseCfg.webhookSecret))
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
  })

  test('webhook headers include X-Signature, X-Idempotency-Key, X-Adapter-Key', async () => {
    const adapter = new SimulatedGuangzhouPoliceCamAdapter(baseCfg)
    await adapter.dispatch({ predictionId: 'p-headers', paramsJson: {} })

    await new Promise(r => setTimeout(r, 75))

    expect(calls.length).toBeGreaterThan(0)
    const headers = calls[0]!.init.headers!
    expect(headers['Content-Type']).toBe('application/json')
    expect(typeof headers['X-Signature']).toBe('string')
    expect(headers['X-Signature']!.length).toBe(64)
    // Verify signature is correct for the body
    const expectedSig = computeSignature(calls[0]!.init.body!, baseCfg.webhookSecret)
    expect(headers['X-Signature']).toBe(expectedSig)
    expect(typeof headers['X-Idempotency-Key']).toBe('string')
    expect(headers['X-Idempotency-Key']!.length).toBeGreaterThan(0)
    expect(headers['X-Adapter-Key']).toBe('simulated-gzp')
  })

  test('pollStatus returns IN_PROGRESS (m3 status pushed via webhook)', async () => {
    const adapter = new SimulatedGuangzhouPoliceCamAdapter(baseCfg)
    const status = await adapter.pollStatus('gzp-anything')
    expect(status.externalId).toBe('gzp-anything')
    expect(status.state).toBe('IN_PROGRESS')
  })
})
