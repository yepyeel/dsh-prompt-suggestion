import type { Settings, SuggestResponse } from '../shared/contracts'
import { HOST_REQUEST_TIMEOUT_MS } from '../shared/defaults'
import { buildTranscript, complete, isAtRest, parseSuggestion, pickModel } from './domain'
import type { HostContext } from './dsh'

export function createSuggestionService(
  ctx: Pick<HostContext, 'sessions' | 'llm' | 'get' | 'logger'>,
) {
  return {
    async suggest(
      sessionId: string,
      settings: Settings,
      signal: AbortSignal,
    ): Promise<SuggestResponse> {
      if (!settings.enabled) return { suggestion: null, reason: 'disabled' }
      const session = ctx.sessions.get(sessionId)
      if (!session) return { suggestion: null, reason: 'no-session' }
      if (!isAtRest(session)) return { suggestion: null, reason: 'not-idle' }
      const messages = session.deriveMessages()
      if (!messages.some((message) => message.role === 'user'))
        return { suggestion: null, reason: 'empty-conversation' }
      const transcript = buildTranscript(messages, settings.maxContextMessages)
      if (!transcript) return { suggestion: null, reason: 'empty-transcript' }
      const model = pickModel(ctx, session, settings)
      if (!model) return { suggestion: null, reason: 'no-model' }
      if (signal.aborted) return { suggestion: null, reason: 'model-error' }

      const started = Date.now()
      const controller = new AbortController()
      let timedOut = false
      const onClose = () => controller.abort()
      signal.addEventListener('abort', onClose, { once: true })
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, HOST_REQUEST_TIMEOUT_MS)
      let onAbort = () => {}
      try {
        if (signal.aborted) controller.abort()
        const cancelled = new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error('model-aborted'))
          controller.signal.addEventListener('abort', onAbort, { once: true })
          if (controller.signal.aborted) onAbort()
        })
        const raw = await Promise.race([
          complete(ctx.llm, model, transcript, controller.signal, settings),
          cancelled,
        ])
        return { suggestion: parseSuggestion(raw), model: `${model.provider}/${model.model}` }
      } catch {
        const reason = timedOut ? 'timeout' : signal.aborted ? 'cancelled' : 'upstream-error'
        // Reasons and timing only: no transcript, model output, or credentials.
        ctx.logger?.debug('[prompt-suggestion] %s (%d ms)', reason, Date.now() - started)
        return { suggestion: null, reason: 'model-error' }
      } finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', onClose)
        controller.signal.removeEventListener('abort', onAbort)
      }
    },
  }
}
