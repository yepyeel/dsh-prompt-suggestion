import type { Session, SessionEvent, SessionProjections, TurnState } from './dsh'

/** Host-only projection key. Distinct from the agent loop's `turnBoundary`. */
export const TURN_KEY = 'prompt-suggestion.turn'

const IDLE: TurnState = { seq: null }

/**
 * Fold one committed event into the latest completed-turn identity.
 * Bookkeeping keeps the previous reference; a new user message, a new turn,
 * or any non-completed `turn/end` (error, aborted, blocked) clears it.
 */
export function applyTurn(state: TurnState, event: SessionEvent): TurnState {
  if (event.type === 'turn/start' || event.type === 'user/message') {
    return state.seq === null ? state : IDLE
  }
  if (event.type !== 'turn/end') return state
  const seq = event.data?.reason?.kind === 'completed' ? event.seq : undefined
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) {
    return state.seq === null ? state : IDLE
  }
  return state.seq === seq ? state : { seq }
}

export function completedTurnSeq(events: readonly SessionEvent[]): number | null {
  let state: TurnState = IDLE
  for (const event of events) state = applyTurn(state, event)
  return state.seq
}

export function isAtRest(events: readonly SessionEvent[]) {
  return completedTurnSeq(events) !== null
}

/** Schema used when a checkpoint is restored. Live folds do not call it. */
export const turnStateSchema = {
  parse(value: unknown): TurnState {
    if (!value || typeof value !== 'object' || !('seq' in value)) {
      throw new Error('invalid prompt-suggestion turn state')
    }
    const seq = value.seq
    if (seq === null) return IDLE
    if (typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0) return { seq }
    throw new Error('invalid prompt-suggestion turn state')
  },
}

export const turnProjection = {
  key: TURN_KEY,
  stateVersion: 1,
  stateSchema: turnStateSchema,
  init: (): TurnState => IDLE,
  apply: applyTurn,
}

/** Read the projection. An unregistered key is not idle, so prediction waits. */
export function completedTurn(projections: SessionProjections, session: Session): number | null {
  return projections.stateOf(session, TURN_KEY)?.seq ?? null
}
