import type { ModelSelection, Settings } from '../shared/contracts'
import { DEFAULT_MAX_TOKENS, DEFAULT_PROMPT, TRANSCRIPT_TRAILER } from '../shared/defaults'
import type { ContentBlock, HostContext, LLM, Message, Session } from './dsh'

const MESSAGE_CHARS = 700
const CONTEXT_CHARS = 7_000
const TOOL_ARGUMENT_CHARS = 120
const TOOL_OUTPUT_CHARS = 160
const TOOL_SUCCESS_CHARS = 80
const MAX_OPERATIONS = 6
const OPERATIONS_CHARS = 1_200
// The most telling argument per common tool; the first present key wins.
const ARGUMENT_KEYS = [
  'command',
  'cmd',
  'file_path',
  'filePath',
  'path',
  'pattern',
  'query',
  'url',
  'description',
]
const EXIT_CODE = /exit code:?\s*(-?\d+)/i

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

function oneLine(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function clipHead(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function clipTail(text: string, max: number) {
  return text.length <= max ? text : `…${text.slice(-(max - 1))}`
}

/** One salient argument (command, path, pattern…), never whole file bodies. */
function summarizeArguments(raw: unknown) {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return clipHead(oneLine(raw), TOOL_ARGUMENT_CHARS)
    }
  }
  if (typeof value === 'string') return clipHead(oneLine(value), TOOL_ARGUMENT_CHARS)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const record = value as Record<string, unknown>
  const strings = (keys: string[]) =>
    keys.map((key) => record[key]).filter((item): item is string => typeof item === 'string')
  const picked =
    strings(ARGUMENT_KEYS).find((item) => item.trim()) ??
    strings(Object.keys(record)).find((item) => item.trim()) ??
    ''
  return clipHead(oneLine(picked), TOOL_ARGUMENT_CHARS)
}

/** Failures keep the tail, where errors and test summaries usually are. */
function summarizeResult(message: Message | undefined) {
  if (!message) return ''
  const text = oneLine(textOf(message))
  const exit = EXIT_CODE.exec(text)
  const failed = message.isError === true || (exit !== null && Number(exit[1]) !== 0)
  if (failed) return text ? `失败：${clipTail(text, TOOL_OUTPUT_CHARS)}` : '失败'
  return text ? `结果：${clipHead(text, TOOL_SUCCESS_CHARS)}` : ''
}

function describeCall(block: ContentBlock, result: Message | undefined) {
  const name = typeof block.name === 'string' && block.name.trim() ? block.name.trim() : '工具'
  const args = summarizeArguments(block.arguments)
  const outcome = summarizeResult(result)
  return `[调用 ${name}]${args ? ` ${args}` : ''}${outcome ? ` → ${outcome}` : ''}`
}

/** Fold a run of operations into one bounded entry, keeping the newest. */
function foldOperations(operations: readonly string[]) {
  let kept = operations.slice(-MAX_OPERATIONS)
  while (kept.length > 1 && kept.join('\n').length > OPERATIONS_CHARS) kept = kept.slice(1)
  const omitted = operations.length - kept.length
  const body = clipHead(kept.join('\n'), OPERATIONS_CHARS)
  return omitted > 0 ? `（前 ${omitted} 项操作已省略）\n${body}` : body
}

type Entry = { label: '用户' | '助手' | '工具'; text: string }

/**
 * Flatten messages into labelled entries. Assistant tool calls are rendered with
 * their results, so the model sees which files were touched and which commands
 * failed; consecutive operations share one entry.
 */
function toEntries(messages: readonly Message[]) {
  const results = new Map<string, Message>()
  const calls = new Set<string>()
  for (const message of messages) {
    if (message?.role === 'tool' && typeof message.toolCallId === 'string')
      results.set(message.toolCallId, message)
    if (message?.role === 'assistant' && Array.isArray(message.content))
      for (const block of message.content)
        if (block?.type === 'tool-call' && typeof block.id === 'string') calls.add(block.id)
  }
  const entries: Entry[] = []
  let operations: string[] = []
  const flush = () => {
    if (!operations.length) return
    entries.push({ label: '工具', text: foldOperations(operations) })
    operations = []
  }
  for (const message of messages) {
    if (!message || message.role === 'system' || message.role === 'developer') continue
    if (message.role === 'tool') {
      // Answered calls were already rendered next to the call itself.
      if (typeof message.toolCallId === 'string' && calls.has(message.toolCallId)) continue
      const text = oneLine(textOf(message))
      if (text) operations.push(`[工具结果] ${clipHead(text, TOOL_OUTPUT_CHARS)}`)
      continue
    }
    const text = textOf(message).trim()
    if (text) {
      flush()
      const label =
        message.role === 'user' ? '用户' : message.role === 'assistant' ? '助手' : '工具'
      entries.push({ label, text: abbreviate(text) })
    }
    if (message.role === 'assistant' && Array.isArray(message.content))
      for (const block of message.content)
        if (block?.type === 'tool-call')
          operations.push(
            describeCall(block, typeof block.id === 'string' ? results.get(block.id) : undefined),
          )
  }
  flush()
  return entries
}

/** Keep the latest request and reply, then fill the remaining budget with recent context. */
export function buildTranscript(messages: readonly Message[], maxMessages = 16) {
  const lines: string[] = []
  let latestUser = -1
  let latestAssistant = -1
  for (const { label, text } of toEntries(messages)) {
    if (label === '用户') latestUser = lines.length
    if (label === '助手') latestAssistant = lines.length
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

function comparable(text: string) {
  return text
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/gu, '')
    .replace(/[.!?。！？]+$/u, '')
    .trim()
    .toLowerCase()
}

function isGenericContinuation(text: string) {
  const compact = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
  return (
    /^(?:好的?|可以)?请?继续(?:吧|下去|进行|执行|处理|下一步)?$/u.test(compact) ||
    /^(?:ok(?:ay)?|sure|yes)?(?:please)?(?:continue|proceed|goahead|keepgoing)(?:please)?$/.test(
      compact,
    )
  )
}

/** Parse a useful candidate, including explicit abstention and historical duplicate checks. */
export function parseSuggestion(raw: unknown, messages: readonly Message[] = []) {
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
    // Labels a model may copy from the transcript format or the prompt examples.
    .replace(/^(?:→|->)\s*/, '')
    .replace(/^(?:用户|预测|下一句|user|prediction)\s*[:：]\s*/i, '')
    .replace(/^["'“”‘’`]+/, '')
    .replace(/["'“”‘’`]+$/, '')
    .trim()
  if (!text || text.length > 200) return null
  const key = comparable(text)
  if (key === 'no_suggestion' || key === 'null' || isGenericContinuation(text)) return null
  if (messages.some((message) => message?.role === 'user' && comparable(textOf(message)) === key))
    return null
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
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `对话记录：\n\n${transcript}\n\n---\n${TRANSCRIPT_TRAILER}` },
        ],
      },
    ],
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
