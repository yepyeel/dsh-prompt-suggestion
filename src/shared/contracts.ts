export interface Settings {
  enabled: boolean
  systemPrompt: string
  provider: string
  model: string
  maxContextMessages: number
  maxTokens: number
}

export interface ModelSelection {
  provider: string
  model: string
}

export interface ModelEntry {
  provider: string
  id: string
  name: string
}

export interface SuggestRequest {
  sessionId: string
}

export const SUGGEST_REASONS = [
  'method-not-allowed',
  'forbidden-origin',
  'disabled',
  'bad-request',
  'missing-session',
  'no-session',
  'not-idle',
  'stale-turn',
  'empty-conversation',
  'empty-transcript',
  'no-model',
  'model-error',
  'internal-error',
] as const

export type SuggestReason = (typeof SUGGEST_REASONS)[number]

export type SuggestResponse =
  | { suggestion: string | null; model: string; reason?: never }
  | { suggestion: null; reason: SuggestReason; model?: never }

export interface ModelsResponse {
  models: ModelEntry[]
}
