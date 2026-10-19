import type { SuggestResponse } from '../../shared/contracts'
import { DEBOUNCE_MS, IDLE_RETRY_MS, MAX_IDLE_RETRIES } from '../../shared/defaults'

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

// React and DOM independent. Every scheduled request captures its session,
// turn generation and request ID; cancellation is also checked after await.
export class PredictionController {
  private context?: PredictionContext
  private generation = 0
  private requestId = 0
  private dismissed = false
  private composing = false
  private timer?: ReturnType<typeof setTimeout>
  private active?: AbortController
  private state: PredictionState = { kind: 'idle' }
  private listeners = new Set<() => void>()

  constructor(private readonly suggest: Suggest) {}

  getSnapshot = (): PredictionState => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private publish(state: PredictionState) {
    this.state = state
    for (const listener of this.listeners) listener()
  }

  private cancel() {
    this.requestId += 1
    clearTimeout(this.timer)
    this.timer = undefined
    this.active?.abort()
    this.active = undefined
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
      this.cancel()
      this.generation += 1
      this.dismissed = false
      this.composing = false
      this.publish({ kind: 'idle' })
      return
    }
    if (previous.enabled !== context.enabled || previous.automatic !== context.automatic) {
      this.cancel()
      this.generation += 1
      this.dismissed = false
      this.publish({ kind: 'idle' })
      return
    }
    if (!context.enabled) return
    if (context.running) {
      if (!previous.running) {
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

  private async run(attempt: number) {
    this.timer = undefined
    const sessionId = this.context?.sessionId
    if (!sessionId || !this.eligible()) return
    const generation = this.generation
    const id = ++this.requestId
    const controller = new AbortController()
    this.active = controller
    const current = () =>
      this.eligible() &&
      !controller.signal.aborted &&
      this.requestId === id &&
      this.generation === generation &&
      this.context?.sessionId === sessionId
    this.publish({ kind: 'requesting' })
    try {
      const response = await this.suggest(sessionId, controller.signal)
      if (!current()) return
      if (response.reason === 'not-idle' && attempt < MAX_IDLE_RETRIES) {
        this.schedule(attempt + 1, IDLE_RETRY_MS)
        return
      }
      const text = response.suggestion?.trim()
      this.publish(text ? { kind: 'shown', text } : { kind: 'idle' })
    } catch {
      if (current()) this.publish({ kind: 'idle' })
    } finally {
      if (this.active === controller) this.active = undefined
    }
  }

  dispose() {
    this.cancel()
    this.context = undefined
    this.composing = false
    this.state = { kind: 'idle' }
    this.listeners.clear()
  }
}
