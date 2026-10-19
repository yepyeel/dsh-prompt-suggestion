import z from '@deepseek-ai/schemastery'
import type { Settings } from '../shared/contracts'
import {
  DEFAULT_CONTEXT_MESSAGES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_PROMPT,
  MAX_CONTEXT_MESSAGES,
  MIN_CONTEXT_MESSAGES,
} from '../shared/defaults'
import type { ConfigInput } from './dsh'

export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  systemPrompt: z.string().default(DEFAULT_PROMPT).volatile(),
  provider: z.string().default('').volatile(),
  model: z.string().default('').volatile(),
  maxContextMessages: z
    .number()
    .step(1)
    .min(MIN_CONTEXT_MESSAGES)
    .max(MAX_CONTEXT_MESSAGES)
    .default(DEFAULT_CONTEXT_MESSAGES)
    .volatile(),
  maxTokens: z.number().step(1).min(16).max(512).default(DEFAULT_MAX_TOKENS).volatile(),
})

function fieldValue(config: ConfigInput | undefined, key: keyof Settings): unknown {
  const value = config?.[key]
  if (
    value !== null &&
    typeof value === 'object' &&
    'get' in value &&
    typeof value.get === 'function'
  ) {
    try {
      return value.get()
    } catch {
      return undefined
    }
  }
  return value
}

export function resolveSettings(config?: ConfigInput): Settings {
  const enabled = fieldValue(config, 'enabled')
  const systemPrompt = fieldValue(config, 'systemPrompt')
  const provider = fieldValue(config, 'provider')
  const model = fieldValue(config, 'model')
  const maxContextMessages = fieldValue(config, 'maxContextMessages')
  const maxTokens = fieldValue(config, 'maxTokens')
  return {
    enabled: enabled !== false,
    systemPrompt:
      typeof systemPrompt === 'string' && systemPrompt.trim() ? systemPrompt : DEFAULT_PROMPT,
    provider: typeof provider === 'string' ? provider.trim() : '',
    model: typeof model === 'string' ? model.trim() : '',
    maxContextMessages:
      typeof maxContextMessages === 'number' &&
      Number.isInteger(maxContextMessages) &&
      maxContextMessages >= MIN_CONTEXT_MESSAGES &&
      maxContextMessages <= MAX_CONTEXT_MESSAGES
        ? maxContextMessages
        : DEFAULT_CONTEXT_MESSAGES,
    maxTokens:
      typeof maxTokens === 'number' &&
      Number.isInteger(maxTokens) &&
      maxTokens >= 16 &&
      maxTokens <= 512
        ? maxTokens
        : DEFAULT_MAX_TOKENS,
  }
}
