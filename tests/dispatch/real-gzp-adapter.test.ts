import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { RealGuangzhouPoliceCamAdapter } from '@/dispatch/adapters/real-gzp'

type FetchCall = { url: string; init: { method?: string; headers?: Record<string, string>; body?: string } }

const cfg = {
  apiKey: 'test-api-key',
  webhookSecret: 'test-webhook-secret-32-chars-okkkk',
  backendBaseUrl: 'https://camera.example.com.cn',
  requestTimeoutMs: 5000,
}

describe('RealGuangzhouPoliceCamAdapter', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('dispatch happy path returns externalId + sends signed headers', async () => {
    const calls: FetchCall[] = []
    globalThis.fetch = (async (url: string, init: FetchCall['init']) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(
        JSON.stringify({ externalId: 'ext-123', acceptedAt: '2026-05-07T12:00Z' }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const adapter = new RealGuangzhouPoliceCamAdapter(cfg)
    const ack = await adapter.dispatch({ predictionId: 'pred-1', paramsJson: {} })

    expect(ack.externalId).toBe('ext-123')
    expect(ack.acceptedAt).toBe('2026-05-07T12:00Z')
    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.url).toBe('https://camera.example.com.cn/dispatch')
    expect(call.init.headers!['X-API-Key']).toBe('test-api-key')
    expect(call.init.headers!['X-Idempotency-Key']).toMatch(/^dispatch-pred-1-/)
  })

  test('dispatch HTTP 500 throws', async () => {
    globalThis.fetch = (async () => new Response('Internal Server Error', { status: 500 })) as unknown as typeof fetch
    const adapter = new RealGuangzhouPoliceCamAdapter(cfg)
    await expect(
      adapter.dispatch({ predictionId: 'pred-2', paramsJson: {} }),
    ).rejects.toThrow(/HTTP 500/)
  })

  test('cancel happy path returns ack', async () => {
    const calls: FetchCall[] = []
    globalThis.fetch = (async (url: string, init: FetchCall['init']) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(
        JSON.stringify({ externalId: 'ext-x', cancelledAt: '2026-05-07T12:01Z' }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const adapter = new RealGuangzhouPoliceCamAdapter(cfg)
    const ack = await adapter.cancel('ext-x', 'cancel-test-1')

    expect(ack.externalId).toBe('ext-x')
    expect(ack.cancelledAt).toBe('2026-05-07T12:01Z')
    const call = calls[0]!
    expect(call.url).toBe('https://camera.example.com.cn/cancel')
    expect(call.init.headers!['X-Idempotency-Key']).toBe('cancel-test-1')
    expect(call.init.headers!['X-API-Key']).toBe('test-api-key')
    expect(call.init.headers!['Content-Type']).toBe('application/json')
  })

  test('signOutgoing produces deterministic 64-hex HMAC', () => {
    const adapter = new RealGuangzhouPoliceCamAdapter(cfg)
    const sig = adapter.signOutgoing('test body')
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
    // Determinism: same input + secret → same digest
    expect(adapter.signOutgoing('test body')).toBe(sig)
    expect(adapter.signOutgoing('different body')).not.toBe(sig)
  })

  test('pollStatus always returns IN_PROGRESS (webhook-driven)', async () => {
    const adapter = new RealGuangzhouPoliceCamAdapter(cfg)
    const status = await adapter.pollStatus('ext-poll')
    expect(status.externalId).toBe('ext-poll')
    expect(status.state).toBe('IN_PROGRESS')
  })
})
