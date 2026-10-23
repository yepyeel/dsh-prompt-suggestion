import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hostFixture, sampleSession } from '../helpers/host'

describe('Host HTTP boundary', () => {
  let fixture: ReturnType<typeof hostFixture>
  let origin: string
  beforeEach(async () => {
    fixture = hostFixture()
    origin = await fixture.start()
  })
  afterEach(async () => {
    await fixture.stop()
  })
  const post = (body: unknown, headers = {}) =>
    fetch(`${origin}/prompt-suggestion/suggest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })

  it('runs a completed conversation through transcript, model stream, and response parsing', async () => {
    const stream = vi.spyOn(fixture.ctx.llm, 'stream')
    const response = await post({ sessionId: 'ready' })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      suggestion: '继续添加测试',
      model: 'fixture/test-model',
      turn: 0,
    })
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'user', content: [{ type: 'text', text: expect.stringContaining('修复完成') }] },
        ],
      }),
    )
  })

  it.each(['NO_SUGGESTION', '', '请继续吧！'])(
    'returns a normal empty candidate for model output %j',
    async (text) => {
      fixture.ctx.llm.stream = async function* () {
        yield { type: 'text-delta', text }
        yield { type: 'finish', reason: { kind: 'completed' } }
      }
      const response = await post({ sessionId: 'ready' })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        suggestion: null,
        model: 'fixture/test-model',
        turn: 0,
      })
      expect(fixture.ctx.logger?.debug).not.toHaveBeenCalled()
    },
  )

  it('filters duplicates outside the transmitted context even with a custom prompt', async () => {
    fixture.config.maxContextMessages = 2
    fixture.config.systemPrompt = 'custom prompt'
    const messages = [
      { role: 'user', content: [{ type: 'text', text: '请先补齐回归测试。' }] },
      { role: 'assistant', content: [{ type: 'text', text: '已经补齐' }] },
      { role: 'user', content: [{ type: 'text', text: '现在修复取消逻辑' }] },
      { role: 'assistant', content: [{ type: 'text', text: '修复完成' }] },
    ]
    fixture.sessions.set('ready', sampleSession({ deriveMessages: () => messages }))
    const stream = vi.fn(async function* () {
      yield { type: 'text-delta', text: '请先补齐回归测试' }
    })
    fixture.ctx.llm.stream = stream
    expect(await (await post({ sessionId: 'ready' })).json()).toEqual({
      suggestion: null,
      model: 'fixture/test-model',
      turn: 0,
    })
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'custom prompt',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: expect.not.stringContaining('请先补齐回归测试') }],
          },
        ],
      }),
    )
  })

  it('rejects unsupported methods, cross-origin calls, malformed JSON, and missing IDs', async () => {
    expect((await fetch(`${origin}/prompt-suggestion/suggest`)).status).toBe(405)
    expect((await post({}, { origin: 'https://example.invalid' })).status).toBe(403)
    expect(
      (await fetch(`${origin}/prompt-suggestion/suggest`, { method: 'POST', body: '{' })).status,
    ).toBe(400)
    expect((await post({ sessionId: 42 })).status).toBe(400)
  })

  it('reads volatile enablement for every request without remounting', async () => {
    let enabled = false
    fixture.config.enabled = { get: () => enabled }
    expect(await (await post({})).json()).toEqual({ suggestion: null, reason: 'disabled' })
    enabled = true
    expect(await (await post({ sessionId: 'ready' })).json()).toMatchObject({
      suggestion: '继续添加测试',
    })
  })

  it('rechecks volatile enablement before returning an in-flight suggestion', async () => {
    let enabled = true
    fixture.config.enabled = { get: () => enabled }
    let finish!: () => void
    let started!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const streaming = new Promise<void>((resolve) => {
      started = resolve
    })
    fixture.ctx.llm.stream = async function* () {
      started()
      await pending
      yield { type: 'text-delta', text: 'stale suggestion' }
    }
    const response = post({ sessionId: 'ready' })
    await streaming
    enabled = false
    finish()
    expect(await (await response).json()).toEqual({ suggestion: null, reason: 'disabled' })
  })

  it('skips missing, running, empty, and model-less sessions', async () => {
    fixture.sessions.set('running', sampleSession({ eventAt: () => ({ type: 'turn/start' }) }))
    fixture.sessions.set('empty', sampleSession({ deriveMessages: () => [] }))
    fixture.sessions.set('no-model', sampleSession({ requestHeader: () => ({}) }))
    for (const [id, reason] of [
      ['missing', 'no-session'],
      ['running', 'not-idle'],
      ['empty', 'empty-conversation'],
      ['no-model', 'no-model'],
    ]) {
      expect(await (await post({ sessionId: id })).json()).toEqual({ suggestion: null, reason })
    }
  })

  it('degrades model failures and catches unexpected SDK errors at the route boundary', async () => {
    fixture.ctx.llm.stream = () => {
      throw new Error('provider unavailable')
    }
    expect(await (await post({ sessionId: 'ready' })).json()).toEqual({
      suggestion: null,
      reason: 'model-error',
    })
    fixture.ctx.sessions.get = () => {
      throw new Error('storage unavailable')
    }
    const response = await post({ sessionId: 'ready' })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ suggestion: null, reason: 'internal-error' })
  })

  it('serves a model catalog and fences its method and origin', async () => {
    expect(await (await fetch(`${origin}/prompt-suggestion/models`)).json()).toEqual({
      models: [{ provider: 'fixture', id: 'test-model', name: 'Test model' }],
    })
    expect((await fetch(`${origin}/prompt-suggestion/models`, { method: 'POST' })).status).toBe(405)
    expect(
      (
        await fetch(`${origin}/prompt-suggestion/models`, {
          headers: { origin: 'https://example.invalid' },
        })
      ).status,
    ).toBe(403)
  })

  it('reports the latest completed turn without calling a model', async () => {
    const stream = vi.spyOn(fixture.ctx.llm, 'stream')
    fixture.sessions.set('running', sampleSession({ eventAt: () => ({ type: 'turn/start' }) }))
    const turn = (body: unknown, init: RequestInit = {}) =>
      fetch(`${origin}/prompt-suggestion/turn`, {
        method: 'POST',
        body: JSON.stringify(body),
        ...init,
      })
    expect(await (await turn({ sessionId: 'ready' })).json()).toEqual({ turn: 0 })
    expect(await (await turn({ sessionId: 'running' })).json()).toEqual({ turn: null })
    expect(await (await turn({ sessionId: 'missing' })).json()).toEqual({ turn: null })
    expect((await turn({})).status).toBe(400)
    expect((await fetch(`${origin}/prompt-suggestion/turn`)).status).toBe(405)
    expect(
      (await turn({ sessionId: 'ready' }, { headers: { origin: 'https://example.invalid' } }))
        .status,
    ).toBe(403)
    fixture.config.enabled = false
    expect(await (await turn({ sessionId: 'ready' })).json()).toEqual({ turn: null })
    expect(stream).not.toHaveBeenCalled()
  })

  it('propagates client disconnects to an in-flight completion', async () => {
    let started!: (signal: AbortSignal) => void
    const startedPromise = new Promise<AbortSignal>((resolve) => {
      started = resolve
    })
    fixture.ctx.llm.stream = async function* (request) {
      started(request.signal)
      await new Promise<void>((resolve) =>
        request.signal.addEventListener('abort', () => resolve(), { once: true }),
      )
      yield { type: 'finish', reason: { kind: 'aborted' } }
    }
    const client = new AbortController()
    const response = fetch(`${origin}/prompt-suggestion/suggest`, {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'ready' }),
      signal: client.signal,
    }).catch(() => null)
    const providerSignal = await startedPromise
    client.abort()
    await response
    await vi.waitFor(() => expect(providerSignal.aborted).toBe(true))
  })
})
