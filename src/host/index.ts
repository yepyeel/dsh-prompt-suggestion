import type { ConfigInput, HostContext } from './dsh'
import { registerRoutes } from './http'
import { turnProjection } from './turn'

export { DEFAULT_PROMPT, MODELS_ROUTE, ROUTE, SETTINGS_NS } from '../shared/defaults'
export { Config, resolveSettings } from './config'
export { buildTranscript, complete, parseSuggestion, pickModel } from './domain'
export { isAtRest } from './turn'

export const inject = ['webServer', 'sessions', 'llm', 'sessionProjections']

export function apply(ctx: HostContext, config: ConfigInput) {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  // The registry drives this fold. Callers read it instead of session.eventAt(),
  // which DSH 0.2.1 deprecates for production plugins.
  ctx.effect(
    () => ctx.sessionProjections.register(turnProjection),
    'prompt-suggestion: turn projection',
  )
  registerRoutes(ctx, config)
}
