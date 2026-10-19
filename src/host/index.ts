import type { ConfigInput, HostContext } from './dsh'
import { registerRoutes } from './http'

export { DEFAULT_PROMPT, MODELS_ROUTE, ROUTE, SETTINGS_NS } from '../shared/defaults'
export { Config, resolveSettings } from './config'
export { buildTranscript, complete, isAtRest, parseSuggestion, pickModel } from './domain'

export const inject = ['webServer', 'sessions', 'llm']

export function apply(ctx: HostContext, config: ConfigInput) {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  registerRoutes(ctx, config)
}
