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
  private readonly unsubscribeCache: () => void

  constructor(
    private readonly suggest: Suggest,
    options: PredictionControllerOptions = {},
  ) {
    this.cache = options.cache ?? new PredictionCache()
    this.checkTurn = options.checkTurn
    this.unsubscribeCache = this.cache.subscribe((sessionId) => {
      if (sessionId === this.context?.sessionId) this.restore()
    })
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
      // A running Session will end on a newer turn, so its entry is already stale.
      if (context.running && context.sessionId) this.cache.delete(context.sessionId)
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
      // Dismiss on the edit itself (or over a live candidate), not on every
      // snapshot while a draft exists, so a lagging snapshot keeps the cache.
      if (previous.blank || this.state.kind === 'shown' || this.state.kind === 'requesting')
        this.dismiss()
      return
    }
    if (previous.running && context.automatic && this.eligible()) {
      this.schedule(0, DEBOUNCE_MS)
      return
    }
    // The input snapshot can lag a Session switch; retry once it settles.
    this.restore()
  }

  /**
   * Show a stashed candidate again only if its turn is still the latest one.
   * Safe to call repeatedly: it only acts while idle with nothing pending, and
   * an ineligible moment (snapshot not settled yet) leaves the entry for later.
   */
  private restore() {
    const sessionId = this.context?.sessionId
    const checkTurn = this.checkTurn
    if (
      this.disposed ||
      !sessionId ||
      !checkTurn ||
      this.state.kind !== 'idle' ||
      this.timer ||
      this.active ||
      !this.eligible()
    )
      return
    const entry = this.cache.get(sessionId)
    if (!entry) return
    const generation = this.generation
    const id = ++this.requestId
    const controller = new AbortController()
    this.active = { controller, detachable: false }
    void (async () => {
      let turn: number | null | undefined
      try {
        turn = await checkTurn(sessionId, controller.signal)
      } catch {
        /* An unverifiable candidate is simply not shown this time. */
      } finally {
        if (this.active?.controller === controller) this.active = undefined
      }
      // A newer turn makes the entry worthless; anything else may be retried.
      if (typeof turn === 'number' && turn !== entry.turn && this.cache.get(sessionId) === entry)
        this.cache.delete(sessionId)
      const current =
        this.eligible() &&
        !controller.signal.aborted &&
        this.requestId === id &&
        this.generation === generation &&
        this.context?.sessionId === sessionId &&
        this.state.kind === 'idle'
      if (!current || turn !== entry.turn) return
      if (this.cache.get(sessionId) === entry) this.cache.delete(sessionId)
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
    this.consume()
    // Every keystroke fires several input events; republishing an unchanged
    // dismissed state would only re-render the overlay for nothing.
    if (this.dismissed && this.state.kind === 'dismissed' && !this.timer && !this.active) return
    this.dismissed = true
    this.cancel()
    this.publish({ kind: 'dismissed' })
  }

  accept(insert: (text: string) => boolean): boolean {
    if (this.state.kind !== 'shown' || !this.eligible()) return false
    const text = this.state.text
    this.consume()
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

  /** The user acted on this Session's input; a stashed candidate no longer applies. */
  private consume() {
    if (this.context?.sessionId) this.cache.delete(this.context.sessionId)
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
    // Notifies every composer; the one showing this Session restores it.
    this.cache.set(sessionId, { text, turn: response.turn })
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
    this.unsubscribeCache()
  }
}
