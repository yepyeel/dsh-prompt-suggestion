/**
 * Host half of the prompt-suggestion bundle.
 *
 * Serves the JSON endpoint the Client half calls after an assistant turn
 * settles, plus the model catalog its settings page offers. Both settings and
 * the model call belong to the Host: the browser never ships the transcript.
 */
import z from '@deepseek-ai/schemastery'

/** Built-in prediction rules; the settings page edits a copy of this text. */
export const DEFAULT_PROMPT = `你是一个输入预测器。下面是用户与编码 Agent 的对话记录。
请预测用户接下来最可能输入的一条消息。

规则：
- 只输出这一条消息本身，不要解释、不要引号、不要编号。
- 使用对话的主语言。
- 不超过 70 个汉字，或 40 个英文单词。
- 具体、可执行，优先“推进当前任务”的下一步动作。
- 如果助手最后一句是在向用户提问，直接给出用户最可能的回答。
- 不要重复对话中已经出现过的用户消息。`

/** Settings namespace: the bundle patch row id. */
export const SETTINGS_NS = 'prompt-suggestion'

export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  systemPrompt: z.string().default(DEFAULT_PROMPT).volatile(),
  provider: z.string().default('').volatile(),
  model: z.string().default('').volatile(),
  maxContextMessages: z.number().step(1).min(2).max(64).default(16).volatile(),
  maxTokens: z.number().step(1).min(16).max(512).default(256).volatile(),
})

const MESSAGE_CHARS = 700
const CONTEXT_CHARS = 7_000
const REQUEST_TIMEOUT_MS = 8_000
const BODY_LIMIT = 64 * 1024
const MODEL_LIST_TIMEOUT_MS = 5_000
const MODEL_CACHE_MS = 60_000

/** Text blocks of one message, joined. */
function textOf(message) {
  if (!message || !Array.isArray(message.content)) return ''
  const parts = []
  for (const block of message.content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/** Render recent messages as one plain transcript, newest kept when over budget. */
export function buildTranscript(messages, maxMessages = 16) {
  const lines = []
  for (const message of messages) {
    if (!message || message.role === 'system' || message.role === 'developer') continue
    let text = textOf(message).trim()
    if (!text) continue
    if (message.role === 'tool') text = `[工具结果] ${text.replace(/\s+/g, ' ').slice(0, 160)}`
    if (text.length > MESSAGE_CHARS) text = `${text.slice(0, MESSAGE_CHARS)}…`
    const label = message.role === 'user' ? '用户' : message.role === 'assistant' ? '助手' : '工具'
    lines.push(`${label}: ${text}`)
  }
  const kept = []
  let total = 0
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (kept.length >= maxMessages || total + line.length > CONTEXT_CHARS) break
    kept.unshift(line)
    total += line.length
  }
  return kept.join('\n\n')
}

/** First usable line of the model reply, with list and quote decoration removed. */
export function parseSuggestion(raw) {
  if (typeof raw !== 'string') return null
  if (raw.includes('```')) return null
  const line = raw.split(/\r?\n/).map(part => part.trim()).find(Boolean)
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

/** Routes the browser calls. */
export const ROUTE = '/prompt-suggestion/suggest'
export const MODELS_ROUTE = '/prompt-suggestion/models'

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(payload)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_LIMIT) throw new Error('body-too-large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Read one config field, which a volatile Loader field exposes as an accessor. */
function fieldValue(config, key) {
  const value = config?.[key]
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get()
    } catch {
      return undefined
    }
  }
  return value
}

/** Normalize the Loader-supplied config; tolerant of a missing document. */
export function resolveSettings(config) {
  const enabled = fieldValue(config, 'enabled')
  const systemPrompt = fieldValue(config, 'systemPrompt')
  const provider = fieldValue(config, 'provider')
  const model = fieldValue(config, 'model')
  const maxContextMessages = fieldValue(config, 'maxContextMessages')
  const maxTokens = fieldValue(config, 'maxTokens')
  return {
    enabled: enabled !== false,
    systemPrompt: typeof systemPrompt === 'string' && systemPrompt.trim() !== ''
      ? systemPrompt
      : DEFAULT_PROMPT,
    provider: typeof provider === 'string' ? provider.trim() : '',
    model: typeof model === 'string' ? model.trim() : '',
    maxContextMessages: Number.isInteger(maxContextMessages) ? maxContextMessages : 16,
    maxTokens: Number.isInteger(maxTokens) ? maxTokens : 256,
  }
}

/** Explicit override first, then the session model, then the process default. */
export function pickModel(ctx, session, settings) {
  if (settings && settings.provider && settings.model) {
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
export async function complete(llm, model, transcript, signal, settings) {
  let text = ''
  const stream = llm.stream({
    provider: model.provider,
    model: model.model,
    system: settings?.systemPrompt || DEFAULT_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: `对话记录：\n\n${transcript}` }] }],
    temperature: 0.5,
    maxTokens: settings?.maxTokens ?? 256,
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
        throw new Error(`model error: ${failure?.code ?? 'unknown'} ${failure?.message ?? ''}`.trim())
      }
      if (chunk.reason?.kind === 'aborted') throw new Error('model aborted')
      break
    }
  }
  return text
}

/**
 * Same-origin guard for the JSON endpoints. Cross-origin JSON posts first need
 * a CORS preflight, which these routes never answer; this also rejects a forged
 * Origin that somehow skipped it.
 */
function isSameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  const host = req.headers.host
  if (!host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * Whether the session is resting right after a normally completed turn.
 * Scans a bounded tail so trailing bookkeeping events do not hide the boundary.
 */
export function isAtRest(session) {
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

/** Provider/model catalog for the settings page, cached briefly. */
let modelCache = { at: 0, value: [] }

async function listModels(ctx) {
  if (Date.now() - modelCache.at < MODEL_CACHE_MS) return modelCache.value
  const models = []
  let providers = []
  try {
    providers = ctx.llm.listProviders()
  } catch {
    providers = []
  }
  for (const provider of providers) {
    try {
      const listed = await Promise.race([
        ctx.llm.listModels(provider.id),
        new Promise(resolve => setTimeout(() => resolve([]), MODEL_LIST_TIMEOUT_MS)),
      ])
      for (const item of listed ?? []) {
        models.push({
          provider: provider.id,
          id: item.id,
          name: typeof item.name === 'string' && item.name !== '' ? item.name : item.id,
        })
      }
    } catch {
      // One unreachable provider must not hide the rest of the catalog.
    }
  }
  modelCache = { at: Date.now(), value: models }
  return models
}

async function handleSuggest(ctx, settings, req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { suggestion: null, reason: 'method-not-allowed' })
    return
  }
  if (!isSameOrigin(req)) {
    sendJson(res, 403, { suggestion: null, reason: 'forbidden-origin' })
    return
  }
  if (!settings.enabled) {
    sendJson(res, 200, { suggestion: null, reason: 'disabled' })
    return
  }
  let body
  try {
    body = await readJson(req)
  } catch {
    sendJson(res, 400, { suggestion: null, reason: 'bad-request' })
    return
  }
  const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId : null
  if (!sessionId) {
    sendJson(res, 400, { suggestion: null, reason: 'missing-session' })
    return
  }
  const session = ctx.sessions.get(sessionId)
  if (!session) {
    sendJson(res, 200, { suggestion: null, reason: 'no-session' })
    return
  }

  // Only predict when the tail belongs to a normally closed turn.
  if (!isAtRest(session)) {
    sendJson(res, 200, { suggestion: null, reason: 'not-idle' })
    return
  }

  const messages = session.deriveMessages()
  if (!messages.some(message => message.role === 'user')) {
    sendJson(res, 200, { suggestion: null, reason: 'empty-conversation' })
    return
  }
  const transcript = buildTranscript(messages, settings.maxContextMessages)
  if (!transcript) {
    sendJson(res, 200, { suggestion: null, reason: 'empty-transcript' })
    return
  }
  const model = pickModel(ctx, session, settings)
  if (!model) {
    sendJson(res, 200, { suggestion: null, reason: 'no-model' })
    return
  }

  const controller = new AbortController()
  const onClose = () => {
    if (!res.writableEnded) controller.abort()
  }
  res.on('close', onClose)
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const raw = await complete(ctx.llm, model, transcript, controller.signal, settings)
    sendJson(res, 200, {
      suggestion: parseSuggestion(raw),
      model: `${model.provider}/${model.model}`,
    })
  } catch (error) {
    console.warn('[prompt-suggestion] model call failed:', error?.message ?? error)
    sendJson(res, 200, { suggestion: null, reason: 'model-error' })
  } finally {
    clearTimeout(timer)
    res.off('close', onClose)
  }
}

async function handleModels(ctx, req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { models: [] })
    return
  }
  if (!isSameOrigin(req)) {
    sendJson(res, 403, { models: [] })
    return
  }
  try {
    sendJson(res, 200, { models: await listModels(ctx) })
  } catch {
    sendJson(res, 200, { models: [] })
  }
}

export const inject = ['webServer', 'sessions', 'llm']

export function apply(ctx, config) {
  // Our own page replaces the automatic Plugins-page form.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: (req, res) => { void handleSuggest(ctx, resolveSettings(config), req, res) },
    }),
    'prompt-suggestion route',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: MODELS_ROUTE,
      handler: (req, res) => { void handleModels(ctx, req, res) },
    }),
    'prompt-suggestion models route',
  )
}
