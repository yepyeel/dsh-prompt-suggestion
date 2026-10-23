import { PREDICTION_CACHE_SIZE } from '../../shared/defaults'

export interface CachedPrediction {
  text: string
  /** Host seq of the completed turn the candidate was generated for. */
  turn: number
}

/**
 * Last unconsumed prediction per Session, kept while the user looks at another
 * Session. Entries are only hints: the controller revalidates the turn with the
 * Host before showing one. Shared by every composer of this client instance.
 */
export class PredictionCache {
  private entries = new Map<string, CachedPrediction>()

  constructor(private readonly limit = PREDICTION_CACHE_SIZE) {}

  get(sessionId: string) {
    return this.entries.get(sessionId)
  }

  set(sessionId: string, entry: CachedPrediction) {
    this.entries.delete(sessionId)
    this.entries.set(sessionId, entry)
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  delete(sessionId: string) {
    this.entries.delete(sessionId)
  }

  clear() {
    this.entries.clear()
  }

  get size() {
    return this.entries.size
  }
}
