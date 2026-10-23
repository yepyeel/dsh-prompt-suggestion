import type { SuggestResponse } from '../../shared/contracts'
import { DEBOUNCE_MS, IDLE_RETRY_MS, MAX_IDLE_RETRIES } from '../../shared/defaults'
import { PredictionCache } from './prediction-cache'

export interface PredictionContext {
  sessionId?: string
  running: boolean
  blank: boolean
  enabled: boolean
  automatic: boolean
}
export type PredictionState =
  | { kind: 'idle' | 'requesting' | 'accepted' | 'dismissed' }
  | { kind: 'shown'; text: string }
export type Suggest = (sessionId: string, signal: AbortSignal) => Promise<SuggestResponse>
/** Latest completed Host turn of a Session; null while busy or unknown. */
export type CheckTurn = (sessionId: string, signal: AbortSignal) => Promise<number | null>

export interface PredictionControllerOptions {
  /** Shared across composers so a remount can restore a stashed candidate. */
  cache?: PredictionCache
  /** Without it, stashed candidates cannot be revalidated and are never shown. */
  checkTurn?: CheckTurn
}

interface ActiveRequest {
  controller: AbortController
  /** Model requests may finish into the cache after a switch; turn checks may not. */
  detachable: boolean
}

// React and DOM independent. Every scheduled request captures its session,
// turn generation and request ID; cancellation is also checked after await.
export class PredictionController {
  private context?: PredictionContext
  private generation = 0
  private requestId = 0
  private dismissed = false
  private composing = false
  private timer?: ReturnType<typeof setTimeout>
  private active?: ActiveRequest
  private detached = new Set<AbortController>()
  private disposed = false
  private state: PredictionState = { kind: 'idle' }
  private shownTurn?: number
  private listeners = new Set<() => void>()
  private readonly cache: PredictionCache
  private readonly checkTurn?: CheckTurn

  constructor(
    private readonly suggest: Suggest,
    options: PredictionControllerOptions = {},
  ) {
    this.cache = options.cache ?? new PredictionCache()
    this.checkTurn = options.checkTurn
  }

  getSnapshot = (): PredictionState => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private publish(state: PredictionState, turn?: number) {
    this.state = state
    this.shownTurn = state.kind === 'shown' ? turn : undefined
    for (const listener of this.listeners) listener()
  }

  private cancel() {
    this.requestId += 1
    clearTimeout(this.timer)
    this.timer = undefined
    this.active?.controller.abort()
    this.active = undefined
  }

  private abortDetached() {
    for (const controller of this.detached) controller.abort()
    this.detached.clear()
  }

  /**
   * Leaving a Session: keep its unconsumed candidate, and let an in-flight model
   * request finish into the cache instead of throwing the paid call away.
   */
  private stash(sessionId: string | undefined) {
    if (!sessionId) return
    if (this.state.kind === 'shown' && this.shownTurn !== undefined)
      this.cache.set(sessionId, { text: this.state.text, turn: this.shownTurn })
    if (this.active?.detachable) {
      this.detached.add(this.active.controller)
      this.active = undefined
    }
  }

  private eligible(ignoreDismissed = false) {
    return Boolean(
      this.context?.sessionId &&
        this.context.enabled &&
        !this.context.running &&
        this.context.blank &&
        !this.composing &&
        (!this.dismissed || ignoreDismissed),
    )
  }

  update(context: PredictionContext) {
    const previous = this.context
    this.context = context
    if (!previous || previous.sessionId !== context.sessionId) {
      this.stash(previous?.sessionId)
      this.cancel()
      this.generation += 1
      this.dismissed = false
      this.composing = false
      this.publish({ kind: 'idle' })
      this.restore()
      return
    }
    if (previous.enabled !== context.enabled || previous.automatic !== context.automatic) {
      if (!context.enabled) {
        this.cache.clear()
        this.abortDetached()
      } else if (context.sessionId) {
        this.cache.delete(context.sessionId)
      }
      this.cancel()
      this.generation += 1
      this.dismissed = false
      this.publish({ kind: 'idle' })
      return
    }
    if (!context.enabled) return
    if (context.running) {
      if (!previous.running) {
        if (context.sessionId) this.cache.delete(context.sessionId)
        this.cancel()
        this.generation += 1
        this.dismissed = false
        this.publish({ kind: 'idle' })
      }
      return
    }
    if (!context.blank) {
      this.dismiss()
      return
    }
    if (previous.running && context.automatic && this.eligible()) {
      this.schedule(0, DEBOUNCE_MS)
    }
  }

  /** Show a stashed candidate again only if its turn is still the latest one. */
  private restore() {
    const sessionId = this.context?.sessionId
    if (!sessionId) return
    const entry = this.cache.get(sessionId)
    if (!entry) return
    const checkTurn = this.checkTurn
    if (!checkTurn || !this.eligible()) {
      this.cache.delete(sessionId)
      return
    }
    const generation = this.generation
    const id = ++this.requestId
    const controller = new AbortController()
    this.active = { controller, detachable: false }
    void (async () => {
      let turn: number | null = null
      try {
        turn = await checkTurn(sessionId, controller.signal)
      } catch {
        /* An unverifiable candidate is simply not shown. */
      } finally {
        if (this.active?.controller === controller) this.active = undefined
      }
      const current =
        this.eligible() &&
        !controller.signal.aborted &&
        this.requestId === id &&
        this.generation === generation &&
        this.context?.sessionId === sessionId
      if (!current) {
        // A switch away keeps the entry for the next visit; anything else consumes it.
        if (this.context?.sessionId === sessionId) this.cache.delete(sessionId)
        return
      }
      this.cache.delete(sessionId)
      if (turn === entry.turn && this.state.kind === 'idle')
        this.publish({ kind: 'shown', text: entry.text }, entry.turn)
    })()
  }

  requestManual = () => {
    if (this.state.kind === 'requesting' || !this.eligible(true)) return false
    this.cancel()
    this.dismissed = false
    void this.run(0)
    return true
  }

  startComposition = () => {
    this.composing = true
    this.dismiss()
  }

  endComposition = () => {
    this.composing = false
  }

  dismiss = () => {
    this.dismissed = true
    this.cancel()
    this.publish({ kind: 'dismissed' })
  }

  accept(insert: (text: string) => boolean): boolean {
    if (this.state.kind !== 'shown' || !this.eligible()) return false
    const text = this.state.text
    this.dismissed = true
    this.cancel()
    let accepted = false
    try {
      accepted = insert(text)
    } catch {
      /* A stale editor revision is a normal rejection. */
    }
    this.publish({ kind: accepted ? 'accepted' : 'dismissed' })
    return accepted
  }

  private schedule(attempt: number, delay: number) {
    const sessionId = this.context?.sessionId
    const generation = this.generation
    const id = ++this.requestId
    this.timer = setTimeout(() => {
      if (
        this.requestId !== id ||
        this.generation !== generation ||
        this.context?.sessionId !== sessionId
      )
        return
      this.timer = undefined
      void this.run(attempt)
    }, delay)
  }

  /** A detached request finished after its Session lost focus. */
  private keep(sessionId: string, response: SuggestResponse, signal: AbortSignal) {
    const text = response.suggestion?.trim()
    if (signal.aborted || !text || response.turn === undefined) return
    if (this.context && !this.context.enabled) return
    this.cache.set(sessionId, { text, turn: response.turn })
    if (
      !this.disposed &&
      this.context?.sessionId === sessionId &&
      this.state.kind === 'idle' &&
      !this.timer &&
      !this.active
    )
      this.restore()
  }

  private async run(attempt: number) {
    this.timer = undefined
    const sessionId = this.context?.sessionId
    if (!sessionId || !this.eligible()) return
    const generation = this.generation
    const id = ++this.requestId
    const controller = new AbortController()
    this.active = { controller, detachable: true }
    const current = () =>
      this.eligible() &&
      !controller.signal.aborted &&
      this.requestId === id &&
      this.generation === generation &&
      this.context?.sessionId === sessionId
    this.publish({ kind: 'requesting' })
    try {
      const response = await this.suggest(sessionId, controller.signal)
      if (this.detached.delete(controller)) {
        this.keep(sessionId, response, controller.signal)
        return
      }
      if (!current()) return
      if (response.reason === 'not-idle' && attempt < MAX_IDLE_RETRIES) {
        this.schedule(attempt + 1, IDLE_RETRY_MS)
        return
      }
      const text = response.suggestion?.trim()
      this.publish(text ? { kind: 'shown', text } : { kind: 'idle' }, response.turn)
    } catch {
      this.detached.delete(controller)
      if (current()) this.publish({ kind: 'idle' })
    } finally {
      if (this.active?.controller === controller) this.active = undefined
    }
  }

  dispose() {
    // A remount of the same composer restores from the shared cache.
    this.stash(this.context?.sessionId)
    this.disposed = true
    this.cancel()
    this.context = undefined
    this.composing = false
    this.state = { kind: 'idle' }
    this.shownTurn = undefined
    this.listeners.clear()
  }
}
