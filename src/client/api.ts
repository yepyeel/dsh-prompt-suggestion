import type {
  ModelEntry,
  SuggestReason,
  SuggestRequest,
  SuggestResponse,
} from '../shared/contracts'
import { SUGGEST_REASONS } from '../shared/contracts'
import { CLIENT_REQUEST_TIMEOUT_MS, MODELS_ROUTE, ROUTE, TURN_ROUTE } from '../shared/defaults'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function turnOf(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function sessionBody(sessionId: string): RequestInit {
  const body: SuggestRequest = { sessionId }
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

async function request(path: string, options: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, CLIENT_REQUEST_TIMEOUT_MS)
  try {
    if (signal?.aborted) controller.abort()
    const response = await fetch(new URL(path.replace(/^\//, ''), document.baseURI), {
      ...options,
      credentials: 'same-origin',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`prompt-suggestion HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

export const api = {
  async suggest(sessionId: string, signal: AbortSignal): Promise<SuggestResponse> {
    const data = await request(ROUTE, sessionBody(sessionId), signal)
    if (record(data) && (data.suggestion === null || typeof data.suggestion === 'string')) {
      if (typeof data.model === 'string') {
        const turn = turnOf(data.turn)
        return turn === undefined
          ? { suggestion: data.suggestion, model: data.model }
          : { suggestion: data.suggestion, model: data.model, turn }
      }
      if (
        data.suggestion === null &&
        (SUGGEST_REASONS as readonly unknown[]).includes(data.reason)
      ) {
        return { suggestion: null, reason: data.reason as SuggestReason }
      }
    }
    throw new Error('Invalid suggestion response')
  },
  /** The Session's latest completed turn, used to revalidate a cached candidate. */
  async turn(sessionId: string, signal: AbortSignal): Promise<number | null> {
    const data = await request(TURN_ROUTE, sessionBody(sessionId), signal)
    if (!record(data) || (data.turn !== null && turnOf(data.turn) === undefined))
      throw new Error('Invalid turn response')
    return data.turn === null ? null : (turnOf(data.turn) ?? null)
  },
  async models(signal: AbortSignal): Promise<ModelEntry[]> {
    const data = await request(MODELS_ROUTE, {}, signal)
    if (!record(data) || !Array.isArray(data.models)) throw new Error('Invalid model catalog')
    return data.models.map((model: unknown) => {
      if (!record(model) || typeof model.provider !== 'string' || typeof model.id !== 'string')
        throw new Error('Invalid model entry')
      return {
        provider: model.provider,
        id: model.id,
        name: typeof model.name === 'string' ? model.name : model.id,
      }
    })
  },
}
