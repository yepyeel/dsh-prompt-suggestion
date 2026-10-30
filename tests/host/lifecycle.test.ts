import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveSettings } from '../../src/host/config'
import type { SessionEvent } from '../../src/host/dsh'
import { createModelCatalog } from '../../src/host/model-catalog'
import { createSuggestionService } from '../../src/host/suggestion-service'
import { hostFixture, sampleSession } from '../helpers/host'

afterEach(() => vi.useRealTimers())

describe('model catalog lifecycle', () => {
  it('shares in-flight work, expires its cache, and keeps plugin instances separate', async () => {
    vi.useFakeTimers()
    const llm = {
      listProviders: () => [{ id: 'one' }],
      listModels: vi.fn(async () => [{ id: 'model' }]),
    }
    const catalog = createModelCatalog(llm)
    const first = catalog.list()
    expect(catalog.list()).toBe(first)
    expect(await first).toEqual([{ provider: 'one', id: 'model', name: 'model' }])
    await catalog.list()
    expect(llm.listModels).toHaveBeenCalledTimes(1)
    await createModelCatalog(llm).list()
    expect(llm.listModels).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_001)
    await catalog.list()
    expect(llm.listModels).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds the whole provider batch and preserves successful providers', async () => {
    vi.useFakeTimers()
    const catalog = createModelCatalog({
      listProviders: () => [{ id: 'slow-one' }, { id: 'slow-two' }, { id: 'good' }],
      listModels: (provider) =>
        provider === 'good' ? Promise.resolve([{ id: 'ok' }]) : new Promise(() => {}),
    })
    const result = catalog.list()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await result).toEqual([{ provider: 'good', id: 'ok', name: 'ok' }])
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('completion lifecycle', () => {
  it.each([
    'new-message',
    'running',
    'next-completed-turn',
    'next-aborted-turn',
    'session-replaced',
    'session-removed',
  ])('discards model output after %s while the provider is pending', async (change) => {
    vi.useFakeTimers()
    const { ctx, sessions } = hostFixture()
    const events: SessionEvent[] = [
      { type: 'turn/end', seq: 0, data: { reason: { kind: 'completed' } } },
    ]
    const session = sampleSession({ events })
    sessions.set('ready', session)
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    ctx.llm.stream = async function* () {
      await pending
      yield { type: 'text-delta', text: 'stale suggestion' }
    }
    const result = createSuggestionService(ctx).suggest(
      'ready',
      resolveSettings({}),
      new AbortController().signal,
    )
    if (change === 'session-replaced') sessions.set('ready', sampleSession())
    else if (change === 'session-removed') sessions.delete('ready')
    else {
      events.push({
        type: change === 'new-message' ? 'user/message' : 'turn/start',
        seq: events.length,
      })
      if (change === 'next-completed-turn' || change === 'next-aborted-turn') {
        events.push({
          type: 'turn/end',
          seq: events.length,
          data: { reason: { kind: change === 'next-completed-turn' ? 'completed' : 'aborted' } },
        })
      }
    }
    finish()
    expect(await result).toEqual({ suggestion: null, reason: 'stale-turn' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('allows bookkeeping appended after the same completed turn', async () => {
    const { ctx, sessions } = hostFixture()
    const events: SessionEvent[] = [
      { type: 'turn/end', seq: 0, data: { reason: { kind: 'completed' } } },
    ]
    const session = sampleSession({ events })
    sessions.set('ready', session)
    ctx.llm.stream = async function* () {
      events.push({ type: 'usage', seq: events.length })
      yield { type: 'text-delta', text: 'next step' }
    }
    expect(
      await createSuggestionService(ctx).suggest(
        'ready',
        resolveSettings({}),
        new AbortController().signal,
      ),
    ).toEqual({ suggestion: 'next step', model: 'fixture/test-model', turn: 0 })
  })

  it('does not invoke the provider for an already cancelled request', async () => {
    const { ctx } = hostFixture()
    const stream = vi.spyOn(ctx.llm, 'stream')
    const controller = new AbortController()
    controller.abort()
    expect(
      await createSuggestionService(ctx).suggest('ready', resolveSettings({}), controller.signal),
    ).toEqual({ suggestion: null, reason: 'model-error' })
    expect(stream).not.toHaveBeenCalled()
  })
  it('finishes on deadline even if the provider ignores cancellation', async () => {
    vi.useFakeTimers()
    const { ctx } = hostFixture()
    ctx.llm.stream = () => ({
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    })
    const result = createSuggestionService(ctx).suggest(
      'ready',
      resolveSettings({}),
      new AbortController().signal,
    )
    await vi.advanceTimersByTimeAsync(8_000)
    expect(await result).toEqual({ suggestion: null, reason: 'model-error' })
    expect(ctx.logger?.debug).toHaveBeenCalledWith(expect.any(String), 'timeout', 8_000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports cancellation separately and releases the deadline timer', async () => {
    vi.useFakeTimers()
    const { ctx } = hostFixture()
    ctx.llm.stream = () => ({
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    })
    const controller = new AbortController()
    const result = createSuggestionService(ctx).suggest(
      'ready',
      resolveSettings({}),
      controller.signal,
    )
    controller.abort()
    expect(await result).toEqual({ suggestion: null, reason: 'model-error' })
    expect(ctx.logger?.debug).toHaveBeenCalledWith(expect.any(String), 'cancelled', 0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
