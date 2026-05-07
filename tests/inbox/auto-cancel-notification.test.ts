import { describe, expect, test } from 'bun:test'
import { pushAutoCancelToInbox } from '@/inbox/auto-cancel-notification'
import { createTestDb } from '../helpers/test-db'

describe('pushAutoCancelToInbox', () => {
  test('does not throw when called with valid args (degraded shim)', async () => {
    const ctx = await createTestDb()
    await expect(
      pushAutoCancelToInbox(ctx.db, 'pred-1', 'dispatch-1', 0.27),
    ).resolves.toBeUndefined()
    await ctx.cleanup()
  })
})
