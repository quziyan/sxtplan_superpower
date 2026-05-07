/**
 * DispatchTask state machine.
 *
 * The 9 states mirror the `dispatch_state` Postgres enum in
 * src/db/schema/dispatch.ts. Keep these two definitions in sync —
 * the type below is treated as the source of truth at the TS layer
 * and `canTransition` enforces the legal directed graph.
 *
 * Terminal states: COMPLETED, FAILED, REJECTED_BY_ADAPTER, CANCELLED, TIMED_OUT.
 * Once a task lands in a terminal state, no further transitions are allowed.
 */
export type DispatchState =
  | 'QUEUED'
  | 'SENT'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED_BY_ADAPTER'
  | 'CANCEL_PENDING'
  | 'CANCELLED'
  | 'TIMED_OUT'

const TRANSITIONS: Record<DispatchState, readonly DispatchState[]> = {
  QUEUED: ['SENT', 'REJECTED_BY_ADAPTER', 'CANCEL_PENDING', 'TIMED_OUT'],
  SENT: ['IN_PROGRESS', 'FAILED', 'CANCEL_PENDING', 'TIMED_OUT', 'COMPLETED'],
  IN_PROGRESS: ['COMPLETED', 'FAILED', 'CANCEL_PENDING', 'TIMED_OUT'],
  CANCEL_PENDING: ['CANCELLED', 'TIMED_OUT'],
  COMPLETED: [],
  FAILED: [],
  REJECTED_BY_ADAPTER: [],
  CANCELLED: [],
  TIMED_OUT: [],
}

/** Return true iff `from -> to` is a legal transition. */
export function canTransition(from: DispatchState, to: DispatchState): boolean {
  return TRANSITIONS[from].includes(to)
}
