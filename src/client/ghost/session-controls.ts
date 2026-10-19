const STORAGE_PREFIX = 'dsh:prompt-suggestion:automatic:'

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Browser-local preferences and manual commands, addressed by Session. */
export class SessionPredictionControls {
  private preferences = new Map<string, boolean>()
  private listeners = new Set<() => void>()
  private handlers = new Map<string, () => boolean>()

  constructor(private readonly storage?: PreferenceStorage) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getAutomatic = (sessionId?: string): boolean => {
    if (!sessionId) return true
    const cached = this.preferences.get(sessionId)
    if (cached !== undefined) return cached
    let automatic = true
    try {
      automatic = this.storage?.getItem(STORAGE_PREFIX + sessionId) !== 'off'
    } catch {
      /* Storage can be unavailable; keep preferences in memory. */
    }
    this.preferences.set(sessionId, automatic)
    return automatic
  }

  setAutomatic(sessionId: string, automatic: boolean) {
    if (this.getAutomatic(sessionId) === automatic) return
    this.preferences.set(sessionId, automatic)
    try {
      if (automatic) this.storage?.removeItem(STORAGE_PREFIX + sessionId)
      else this.storage?.setItem(STORAGE_PREFIX + sessionId, 'off')
    } catch {
      /* A storage failure must not block the local toggle. */
    }
    for (const listener of this.listeners) listener()
  }

  registerManual(sessionId: string, handler: () => boolean) {
    this.handlers.set(sessionId, handler)
    return () => {
      if (this.handlers.get(sessionId) === handler) this.handlers.delete(sessionId)
    }
  }

  requestManual(sessionId?: string) {
    return sessionId ? (this.handlers.get(sessionId)?.() ?? false) : false
  }

  dispose() {
    this.handlers.clear()
    this.listeners.clear()
    this.preferences.clear()
  }
}

export function createSessionControls() {
  try {
    return new SessionPredictionControls(window.localStorage)
  } catch {
    return new SessionPredictionControls()
  }
}
