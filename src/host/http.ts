import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ModelsResponse, SuggestResponse } from '../shared/contracts'
import { MODELS_ROUTE, ROUTE } from '../shared/defaults'
import { resolveSettings } from './config'
import type { ConfigInput, HostContext } from './dsh'
import { createModelCatalog } from './model-catalog'
import { createSuggestionService } from './suggestion-service'

const BODY_LIMIT = 64 * 1024

function sendJson(res: ServerResponse, status: number, body: SuggestResponse | ModelsResponse) {
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
      fallback: SuggestResponse | ModelsResponse,
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
            const settings = resolveSettings(config)
            if (!settings.enabled) {
              sendJson(res, 200, { suggestion: null, reason: 'disabled' })
              return
            }
            let body: unknown
            try {
              body = await readJson(req)
            } catch {
              sendJson(res, 400, { suggestion: null, reason: 'bad-request' })
              return
            }
            if (
              !body ||
              typeof body !== 'object' ||
              !('sessionId' in body) ||
              typeof body.sessionId !== 'string' ||
              !body.sessionId
            ) {
              sendJson(res, 400, { suggestion: null, reason: 'missing-session' })
              return
            }
            const controller = new AbortController()
            const onClose = () => {
              if (!res.writableEnded) controller.abort()
            }
            res.on('close', onClose)
            try {
              sendJson(
                res,
                200,
                await suggestions.suggest(body.sessionId, settings, controller.signal),
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
