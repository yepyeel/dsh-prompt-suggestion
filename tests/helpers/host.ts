import { once } from 'node:events'
import { createServer } from 'node:http'
import { vi } from 'vitest'
import type { ConfigInput, HostContext, Session, SessionEvent } from '../../src/host/dsh'
import { apply } from '../../src/host/index'
import { applyTurn, TURN_KEY } from '../../src/host/turn'

export interface FixtureSession extends Session {
  /** Mutable log the fixture projection folds on each read. */
  events: SessionEvent[]
}

const completedTurn = (): SessionEvent => ({
  type: 'turn/end',
  seq: 0,
  data: { reason: { kind: 'completed' } },
})

export function sampleSession(overrides: Partial<FixtureSession> = {}): FixtureSession {
  const events = overrides.events ?? [completedTurn()]
  return {
    deriveMessages: () => [
      { role: 'user', content: [{ type: 'text', text: '请修复这个问题' }] },
      { role: 'assistant', content: [{ type: 'text', text: '修复完成' }] },
    ],
    requestHeader: () => ({ config: { provider: 'fixture', model: 'test-model' } }),
    ...overrides,
    events,
  }
}

export function hostFixture() {
  const sessions = new Map<string, FixtureSession>([['ready', sampleSession()]])
  const routes = new Map<string, Parameters<HostContext['webServer']['register']>[0]['handler']>()
  const disposers: (() => void)[] = []
  const config: ConfigInput = {}
  const ctx: HostContext = {
    sessions: { get: (id) => sessions.get(id) },
    sessionProjections: {
      register: () => () => {},
      stateOf: (session, key) => {
        if (key !== TURN_KEY) return undefined
        let state = { seq: null as number | null }
        for (const event of (session as FixtureSession).events ?? [])
          state = applyTurn(state, event)
        return state
      },
    },
    llm: {
      async *stream() {
        yield { type: 'text-delta', text: '1. “继续添加测试”' }
        yield { type: 'finish', reason: { kind: 'completed' } }
      },
      listProviders: () => [{ id: 'fixture' }],
      listModels: async () => [{ id: 'test-model', name: 'Test model' }],
    },
    get: () => undefined,
    logger: { debug: vi.fn() },
    fiber: undefined,
    settings: { configure: () => () => {} },
    webServer: {
      register: (route) => {
        routes.set(route.path, route.handler)
        return () => {
          routes.delete(route.path)
        }
      },
    },
    effect: (factory) => {
      disposers.push(factory())
    },
    inject: (_, callback) => callback(ctx),
  }
  const server = createServer((req, res) => {
    const handler = routes.get(new URL(req.url ?? '/', 'http://fixture').pathname)
    if (handler) handler(req, res)
    else {
      res.writeHead(404)
      res.end()
    }
  })
  return {
    ctx,
    sessions,
    config,
    async start() {
      apply(ctx, config)
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing server address')
      return `http://127.0.0.1:${address.port}`
    },
    async stop() {
      for (const dispose of disposers.reverse()) dispose()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}
