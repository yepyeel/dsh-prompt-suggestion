import type { ModelSelection, Settings } from '../shared/contracts'
import { DEFAULT_MAX_TOKENS, DEFAULT_PROMPT } from '../shared/defaults'
import type { HostContext, LLM, Message, Session } from './dsh'

const MESSAGE_CHARS = 700
const CONTEXT_CHARS = 7_000

function textOf(message: Message) {
  if (!message || !Array.isArray(message.content)) return ''
  const parts = []
  for (const block of message.content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

function abbreviate(text: string) {
  if (text.length <= MESSAGE_CHARS) return text
  const marker = '\n…[中间内容已省略]…\n'
  const head = Math.ceil((MESSAGE_CHARS - marker.length) / 2)
  const tail = MESSAGE_CHARS - marker.length - head
  return `${text.slice(0, head)}${marker}${text.slice(-tail)}`
}

/** Keep the latest request and reply, then fill the remaining budget with recent context. */
export function buildTranscript(messages: readonly Message[], maxMessages = 16) {
  const lines: string[] = []
  let latestUser = -1
  let latestAssistant = -1
  for (const message of messages) {
    if (!message || message.role === 'system' || message.role === 'developer') continue
    let text = textOf(message).trim()
    if (!text) continue
    if (message.role === 'tool') text = `[工具结果] ${text.replace(/\s+/g, ' ').slice(0, 160)}`
    text = abbreviate(text)
    const label = message.role === 'user' ? '用户' : message.role === 'assistant' ? '助手' : '工具'
    if (message.role === 'user') latestUser = lines.length
    if (message.role === 'assistant') latestAssistant = lines.length
    lines.push(`${label}: ${text}`)
  }
  const kept = new Set<number>()
  let total = 0
  const keep = (index: number) => {
    if (kept.has(index)) return true
    if (index < 0 || kept.size >= maxMessages) return false
    const size = lines[index].length + (kept.size ? 2 : 0)
    if (total + size > CONTEXT_CHARS) return false
    kept.add(index)
    total += size
    return true
  }
  keep(latestUser)
  keep(latestAssistant)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!keep(index)) break
  }
  return [...kept]
    .sort((a, b) => a - b)
    .map((index) => lines[index])
    .join('\n\n')
}

/** First usable line of the model reply, with list and quote decoration removed. */
export function parseSuggestion(raw: unknown) {
  if (typeof raw !== 'string') return null
  if (raw.includes('```')) return null
  const line = raw
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean)
  if (!line) return null
  const text = line
    .replace(/^[-*•]\s+/, '')
    .replace(/^\d+[.)、]\s+/, '')
    .replace(/^["'“”‘’`]+/, '')
    .replace(/["'“”‘’`]+$/, '')
    .trim()
  if (!text || text.length > 200) return null
  return text
}

/** Explicit override first, then the session model, then the process default. */
export function pickModel(
  ctx: Pick<HostContext, 'get'>,
  session: Pick<Session, 'requestHeader'> | undefined,
  settings?: Settings,
): ModelSelection | null {
  if (settings?.provider && settings.model) {
    return { provider: settings.provider, model: settings.model }
  }
  const config = session?.requestHeader?.()?.config
  if (config && typeof config.provider === 'string' && typeof config.model === 'string') {
    return { provider: config.provider, model: config.model }
  }
  const fallback = ctx.get('agentDefaultModel')?.currentSelection?.()
  if (fallback && typeof fallback.provider === 'string' && typeof fallback.model === 'string') {
    return { provider: fallback.provider, model: fallback.model }
  }
  return null
}

/** One bounded, non-streaming completion; text deltas are concatenated. */
export async function complete(
  llm: Pick<LLM, 'stream'>,
  model: ModelSelection,
  transcript: string,
  signal: AbortSignal,
  settings?: Settings,
) {
  let text = ''
  const stream = llm.stream({
    provider: model.provider,
    model: model.model,
    system: settings?.systemPrompt || DEFAULT_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: `对话记录：\n\n${transcript}` }] }],
    temperature: 0.5,
    maxTokens: settings?.maxTokens ?? DEFAULT_MAX_TOKENS,
    signal,
  })
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      text += chunk.text
      continue
    }
    if (chunk.type === 'finish') {
      if (chunk.reason?.kind === 'error') {
        const failure = chunk.reason.failure
        throw new Error(
          `model error: ${failure?.code ?? 'unknown'} ${failure?.message ?? ''}`.trim(),
        )
      }
      if (chunk.reason?.kind === 'aborted') throw new Error('model aborted')
      break
    }
  }
  return text
}

export function isAtRest(session: Pick<Session, 'seq' | 'eventAt'>) {
  const end = session.seq
  const floor = Math.max(0, end - 24)
  for (let seq = end - 1; seq >= floor; seq -= 1) {
    const event = session.eventAt(seq)
    if (!event) break
    if (event.type === 'turn/start' || event.type === 'user/message') return false
    if (event.type === 'turn/end') return event.data?.reason?.kind === 'completed'
  }
  return false
}
