import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AdapterFactory,
  type ExternalAdapter,
  type Pool,
  type PoolConfig,
  makePool,
} from '@/integrations/external-adapter'

// ─── Test fixture ──────────────────────────────────────────────────────────
let factoryCalls: Record<string, number>

class FakeAdapter implements ExternalAdapter {
  readonly key: string
  constructor(k: string) {
    this.key = k
    factoryCalls[k] = (factoryCalls[k] ?? 0) + 1
  }
}

function fakeFactory(k: string): AdapterFactory<FakeAdapter> {
  return () => new FakeAdapter(k)
}

beforeEach(() => {
  factoryCalls = {}
})

// ─── Tests ─────────────────────────────────────────────────────────────────
describe('makePool — happy path single-flight', () => {
  test('1. init + getDefault returns the default-key adapter (mock)', () => {
    const pool: Pool<FakeAdapter> = makePool<FakeAdapter>({
      factories: { mock: fakeFactory('mock'), real: fakeFactory('real') },
      defaultKey: 'mock',
    })
    pool.init()
    const a = pool.getDefault()
    expect(a.key).toBe('mock')
  })

  test('2. get(key) lazy-instantiates a key not in default/alsoRegister', () => {
    const pool = makePool<FakeAdapter>({
      factories: { mock: fakeFactory('mock'), real: fakeFactory('real') },
      defaultKey: 'mock',
    })
    pool.init()
    expect(factoryCalls['real']).toBeUndefined()
    const real = pool.get('real')
    expect(real.key).toBe('real')
    expect(factoryCalls['real']).toBe(1)
  })
})

describe('makePool — error cases', () => {
  test('3. get(unknown) throws clear error', () => {
    const pool = makePool<FakeAdapter>({
      factories: { mock: fakeFactory('mock') },
      defaultKey: 'mock',
    })
    pool.init()
    expect(() => pool.get('does-not-exist')).toThrow(/unknown adapter key: does-not-exist/)
  })

  test('4. get before init throws "Pool not initialized"', () => {
    const pool = makePool<FakeAdapter>({
      factories: { mock: fakeFactory('mock') },
      defaultKey: 'mock',
    })
    expect(() => pool.get('mock')).toThrow(/Pool not initialized/)
  })

  test('7. alsoRegister with an unknown key throws at init', () => {
    const pool = makePool<FakeAdapter>({
      factories: { mock: fakeFactory('mock') },
      defaultKey: 'mock',
      alsoRegister: ['ghost'],
    })
    expect(() => pool.init()).toThrow(/unknown adapter key: ghost/)
  })

  test('8. defaultKey unknown throws at init', () => {
    const pool = makePool<FakeAdapter>({
      factories: { mock: fakeFactory('mock') },
      defaultKey: 'missing',
    })
    expect(() => pool.init()).toThrow(/unknown adapter key: missing/)
  })
})

describe('makePool — init semantics', () => {
  test('5. init is idempotent — second call does not reinstantiate (same reference)', () => {
    const pool = makePool<FakeAdapter>({
      factories: { mock: fakeFactory('mock') },
      defaultKey: 'mock',
    })
    pool.init()
    const first = pool.getDefault()
    expect(factoryCalls['mock']).toBe(1)

    pool.init()
    const second = pool.getDefault()
    expect(second).toBe(first) // reference equality
    expect(factoryCalls['mock']).toBe(1)
  })

  test('6. alsoRegister eagerly instantiates extra keys; list() shows both', () => {
    const pool = makePool<FakeAdapter>({
      factories: {
        mock: fakeFactory('mock'),
        'simulated-gzp': fakeFactory('simulated-gzp'),
      },
      defaultKey: 'mock',
      alsoRegister: ['simulated-gzp'],
    })
    pool.init()
    expect(factoryCalls['mock']).toBe(1)
    expect(factoryCalls['simulated-gzp']).toBe(1)
    expect(pool.list().sort()).toEqual(['mock', 'simulated-gzp'])
  })
})

describe('makePool — diagnostics & test helpers', () => {
  test('9. list() shows only instantiated keys; grows after lazy get()', () => {
    const pool = makePool<FakeAdapter>({
      factories: {
        mock: fakeFactory('mock'),
        real: fakeFactory('real'),
        third: fakeFactory('third'),
      },
      defaultKey: 'mock',
    })
    pool.init()
    expect(pool.list()).toEqual(['mock'])
    pool.get('real')
    expect(pool.list().sort()).toEqual(['mock', 'real'])
    // 'third' was never requested → not in list
    expect(pool.list()).not.toContain('third')
  })

  test('10. resetForTests clears all + re-init produces fresh instances', () => {
    const config: PoolConfig<FakeAdapter> = {
      factories: { mock: fakeFactory('mock') },
      defaultKey: 'mock',
    }
    const pool = makePool<FakeAdapter>(config)
    pool.init()
    const before = pool.getDefault()
    expect(factoryCalls['mock']).toBe(1)
    expect(pool.list()).toEqual(['mock'])

    pool.resetForTests()
    expect(pool.list()).toEqual([])
    // get() before re-init must throw — reset cleared the initialized flag
    expect(() => pool.get('mock')).toThrow(/Pool not initialized/)

    pool.init()
    const after = pool.getDefault()
    expect(after).not.toBe(before) // fresh instance
    expect(factoryCalls['mock']).toBe(2) // factory called again
  })
})

describe('makePool — factory invocation invariants', () => {
  test('11. factory is called only once per key (idempotency proof)', () => {
    const pool = makePool<FakeAdapter>({
      factories: { mock: fakeFactory('mock'), real: fakeFactory('real') },
      defaultKey: 'mock',
    })
    pool.init()
    const a1 = pool.get('real')
    const a2 = pool.get('real')
    const a3 = pool.get('real')
    expect(a1).toBe(a2)
    expect(a2).toBe(a3)
    expect(factoryCalls['real']).toBe(1)
  })

  test('12. adapter.key field does NOT have to match the registry key', () => {
    // Registry key is the lookup contract; adapter.key is informational.
    const pool = makePool<FakeAdapter>({
      factories: {
        // registry key 'alias' but the adapter reports 'underlying-name'
        alias: () => new FakeAdapter('underlying-name'),
      },
      defaultKey: 'alias',
    })
    pool.init()
    const a = pool.get('alias')
    expect(a.key).toBe('underlying-name')
    expect(pool.list()).toEqual(['alias'])
  })
})

describe('makePool — independent pools', () => {
  test('13. each makePool() returns an INDEPENDENT pool (no shared state)', () => {
    const poolA = makePool<FakeAdapter>({
      factories: { mock: fakeFactory('mock') },
      defaultKey: 'mock',
    })
    const poolB = makePool<FakeAdapter>({
      factories: { mock: fakeFactory('mock') },
      defaultKey: 'mock',
    })
    poolA.init()
    expect(() => poolB.get('mock')).toThrow(/Pool not initialized/)
    poolB.init()
    expect(poolA.getDefault()).not.toBe(poolB.getDefault())
    expect(factoryCalls['mock']).toBe(2)
  })
})
