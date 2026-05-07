/**
 * ExternalAdapter — generic base + makePool template (au-T5).
 *
 * This module provides a small, dependency-free pool template that fits the
 * two adapter shapes already present in the codebase:
 *
 *   1. Map-registry style (Camera m3 T09 — `src/dispatch/adapter-pool.ts`):
 *      multiple adapter instances are eagerly registered side-by-side
 *      (e.g. `mock` + `simulated-gzp`) and callers pick one by key.
 *      → use `defaultKey` + `alsoRegister` together.
 *
 *   2. Switch-factory style (Search m2 — `src/news/search-adapter.ts`,
 *      OSS au-T3 — `src/media/oss-adapter-pool.ts`): a single active
 *      adapter selected by an env enum.
 *      → use `defaultKey` alone; `getDefault()` returns it.
 *
 * Each `makePool()` call returns an INDEPENDENT pool — no module-level
 * shared state. Pools are explicit objects so several can coexist
 * (one per adapter family) and each can be reset in tests separately.
 *
 * Used by au-T6 (Camera retrofit) and au-T7 (Search retrofit).
 */

export interface ExternalAdapter {
  /**
   * Stable identifier for this adapter instance. Diagnostic only — the
   * registry key in `PoolConfig.factories` is the source of truth for
   * lookup, so `adapter.key` does not have to equal the factory key.
   */
  readonly key: string
}

export type AdapterFactory<A extends ExternalAdapter> = () => A

export type PoolConfig<A extends ExternalAdapter> = {
  /** Lazy factories keyed by registry key (typically equal to `adapter.key`). */
  factories: Record<string, AdapterFactory<A>>
  /**
   * Default key when caller doesn't specify one (single-flight selection).
   * Resolved at `init()` time. Throws on unknown key.
   */
  defaultKey: string
  /**
   * Optional: keys that should be eager-instantiated on `init()`
   * (Map-registry shape). Throws on unknown key. Omit the field entirely
   * (do not pass `undefined`) when not needed — exactOptionalPropertyTypes.
   */
  alsoRegister?: string[]
}

export interface Pool<A extends ExternalAdapter> {
  /** Idempotent. Instantiates `defaultKey` + `alsoRegister` keys. */
  init(): void
  /** Get by explicit key. Lazy-instantiates if not yet created. Throws on unknown key. */
  get(key: string): A
  /** Single-flight: returns the `defaultKey` adapter. */
  getDefault(): A
  /** Currently instantiated keys (diagnostics / tests). */
  list(): string[]
  /** Test-only: clears instantiated adapters and resets initialized flag. */
  resetForTests(): void
}

export function makePool<A extends ExternalAdapter>(config: PoolConfig<A>): Pool<A> {
  const instances = new Map<string, A>()
  let initialized = false

  function instantiate(key: string): A {
    const factory = config.factories[key]
    if (!factory) throw new Error(`unknown adapter key: ${key}`)
    const adapter = factory()
    instances.set(key, adapter)
    return adapter
  }

  function init(): void {
    if (initialized) return
    // Default first — guarantees getDefault() always works post-init.
    instantiate(config.defaultKey)
    if (config.alsoRegister) {
      for (const k of config.alsoRegister) {
        if (!instances.has(k)) instantiate(k)
      }
    }
    initialized = true
  }

  function get(key: string): A {
    if (!initialized) throw new Error('Pool not initialized')
    const existing = instances.get(key)
    if (existing) return existing
    return instantiate(key)
  }

  function getDefault(): A {
    return get(config.defaultKey)
  }

  function list(): string[] {
    return [...instances.keys()]
  }

  function resetForTests(): void {
    instances.clear()
    initialized = false
  }

  return { init, get, getDefault, list, resetForTests }
}
