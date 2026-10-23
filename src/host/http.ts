import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ModelsResponse, SuggestResponse, TurnResponse } from '../shared/contracts'
import { MODELS_ROUTE, ROUTE, TURN_ROUTE } from '../shared/defaults'
import { resolveSettings } from './config'
import type { ConfigInput, HostContext } from './dsh'
import { createModelCatalog } from './model-catalog'
import { createSuggestionService } from './suggestion-service'

const BODY_LIMIT = 64 * 1024

type ResponseBody = SuggestResponse | ModelsResponse | TurnResponse

function sendJson(res: ServerResponse, status: number, body: ResponseBody) {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > BODY_LIMIT) throw new Error('body-too-large')
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** The non-empty `sessionId` of a JSON body, or null when the body is malformed. */
async function readSessionId(req: IncomingMessage): Promise<string | null | undefined> {
  let body: unknown
  try {
    body = await readJson(req)
  } catch {
    return undefined
  }
  if (
    !body ||
    typeof body !== 'object' ||
    !('sessionId' in body) ||
    typeof body.sessionId !== 'string' ||
    !body.sessionId
  )
    return null
  return body.sessionId
}

function isSameOrigin(req: IncomingMessage) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

export function registerRoutes(ctx: HostContext, config: ConfigInput) {
  const suggestions = createSuggestionService(ctx)
  const models = createModelCatalog(ctx.llm)
  const guarded =
    (
      handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
      fallback: ResponseBody,
    ) =>
    (req: IncomingMessage, res: ServerResponse) => {
      void handler(req, res).catch(() => {
        ctx.logger?.debug('[prompt-suggestion] unexpected route failure')
        sendJson(res, 500, fallback)
      })
    }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: guarded(
          async (req, res) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { suggestion: null, reason: 'method-not-allowed' })
              return
            }
            if (!isSameOrigin(req)) {
              sendJson(res, 403, { suggestion: null, reason: 'forbidden-origin' })
              return
            }
            if (!resolveSettings(config).enabled) {
              sendJson(res, 200, { suggestion: null, reason: 'disabled' })
              return
            }
            const sessionId = await readSessionId(req)
            if (sessionId === undefined) {
              sendJson(res, 400, { suggestion: null, reason: 'bad-request' })
              return
            }
            if (sessionId === null) {
              sendJson(res, 400, { suggestion: null, reason: 'missing-session' })
              return
            }
            const controller = new AbortController()
            const onClose = () => {
              if (!res.writableEnded) controller.abort()
            }
            res.on('close', onClose)
            try {
              const result = await suggestions.suggest(
                sessionId,
                resolveSettings(config),
                controller.signal,
              )
              sendJson(
                res,
                200,
                resolveSettings(config).enabled ? result : { suggestion: null, reason: 'disabled' },
              )
            } finally {
              res.off('close', onClose)
            }
          },
          { suggestion: null, reason: 'internal-error' },
        ),
      }),
    'prompt-suggestion route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: TURN_ROUTE,
        handler: guarded(
          async (req, res) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { turn: null })
              return
            }
            if (!isSameOrigin(req)) {
              sendJson(res, 403, { turn: null })
              return
            }
            const sessionId = await readSessionId(req)
            if (!sessionId) {
              sendJson(res, 400, { turn: null })
              return
            }
            sendJson(res, 200, { turn: suggestions.turn(sessionId, resolveSettings(config)) })
          },
          { turn: null },
        ),
      }),
    'prompt-suggestion turn route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: MODELS_ROUTE,
        handler: guarded(
          async (req, res) => {
            if (req.method !== 'GET') {
              sendJson(res, 405, { models: [] })
              return
            }
            if (!isSameOrigin(req)) {
              sendJson(res, 403, { models: [] })
              return
            }
            sendJson(res, 200, { models: await models.list() })
          },
          { models: [] },
        ),
      }),
    'prompt-suggestion models route',
  )
}
