import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PredictionController } from '../../src/client/ghost/controller'
import { PredictionCache } from '../../src/client/ghost/prediction-cache'
import type { SuggestResponse } from '../../src/shared/contracts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('prediction lifecycle', () => {
  let controller: PredictionController
  let suggest: ReturnType<
    typeof vi.fn<(id: string, signal: AbortSignal) => Promise<SuggestResponse>>
  >
  const update = (
    running: boolean,
    sessionId = 'one',
    blank = true,
    enabled = true,
    automatic = true,
  ) => controller.update({ sessionId, running, blank, enabled, automatic })
  beforeEach(() => {
    vi.useFakeTimers()
    suggest = vi.fn().mockResolvedValue({ suggestion: '继续测试', model: 'fixture/test' })
    controller = new PredictionController(suggest)
  })
  afterEach(() => {
    controller.dispose()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it('only requests after a running-to-idle transition and debounces once', async () => {
    update(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(suggest).not.toHaveBeenCalled()
    update(true)
    update(false)
    await vi.advanceTimersByTimeAsync(249)
    expect(suggest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(suggest).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot()).toEqual({ kind: 'shown', text: '继续测试' })
  })

  it('allows an explicit request on an idle mount while automatic prediction is paused', async () => {
    update(false, 'one', true, true, false)
    await vi.advanceTimersByTimeAsync(500)
    expect(suggest).not.toHaveBeenCalled()
    expect(controller.requestManual()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot()).toEqual({ kind: 'shown', text: '继续测试' })
    controller.dismiss()
    expect(controller.requestManual()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(suggest).toHaveBeenCalledTimes(2)
    update(true, 'one', true, true, false)
    update(false, 'one', true, true, false)
    await vi.advanceTimersByTimeAsync(500)
    expect(suggest).toHaveBeenCalledTimes(2)
  })

  it.each(['running', 'draft', 'disabled', 'composition'] as const)(
    'refuses manual requests during %s',
    (condition) => {
      update(condition === 'running', 'one', condition !== 'draft', condition !== 'disabled', false)
      if (condition === 'composition') controller.startComposition()
      expect(controller.requestManual()).toBe(false)
      expect(suggest).not.toHaveBeenCalled()
    },
  )

  it('runs a manual request immediately in place of a scheduled automatic request', async () => {
    update(true)
    update(false)
    expect(controller.requestManual()).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(suggest).toHaveBeenCalledTimes(1)
  })

  it('ignores repeated manual commands while a request is pending', async () => {
    const pending = deferred<SuggestResponse>()
    suggest.mockReturnValueOnce(pending.promise)
    update(false)
    expect(controller.requestManual()).toBe(true)
    expect(controller.requestManual()).toBe(false)
    expect(suggest).toHaveBeenCalledTimes(1)
    pending.resolve({ suggestion: 'next', model: 'fixture/test' })
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot()).toEqual({ kind: 'shown', text: 'next' })
  })

  it('invalidates pending automatic results when this conversation is paused', async () => {
    const pending = deferred<SuggestResponse>()
    suggest.mockReturnValueOnce(pending.promise)
    update(true)
    update(false)
    await vi.advanceTimersByTimeAsync(250)
    const signal = suggest.mock.calls[0][1]
    update(false, 'one', true, true, false)
    pending.resolve({ suggestion: 'stale', model: 'fixture/test' })
    await vi.advanceTimersByTimeAsync(0)
    expect(signal.aborted).toBe(true)
    expect(controller.getSnapshot().kind).toBe('idle')
    expect(controller.requestManual()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot()).toEqual({ kind: 'shown', text: '继续测试' })
  })

  it('never shows an old session response in the new session', async () => {
    const pending = deferred<SuggestResponse>()
    suggest.mockReturnValue(pending.promise)
    update(true)
    update(false)
    await vi.advanceTimersByTimeAsync(250)
    update(false, 'two')
    pending.resolve({ suggestion: 'stale', model: 'fixture/test', turn: 3 })
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot()).toEqual({ kind: 'idle' })
  })

  it('drops an old turn response when the same session starts another turn', async () => {
    const pending = deferred<SuggestResponse>()
    suggest.mockReturnValueOnce(pending.promise)
    update(true)
    update(false)
    await vi.advanceTimersByTimeAsync(250)
    update(true)
    update(false)
    await vi.advanceTimersByTimeAsync(250)
    expect(controller.getSnapshot()).toEqual({ kind: 'shown', text: '继续测试' })
    pending.resolve({ suggestion: 'old turn', model: 'fixture/test' })
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot()).toEqual({ kind: 'shown', text: '继续测试' })
  })

  it.each(['typing', 'composition', 'disabled', 'session-switch'] as const)(
    'discards pending results after %s even when the original conditions return',
    async (change) => {
      const pending = deferred<SuggestResponse>()
      suggest.mockReturnValueOnce(pending.promise)
      update(true)
      update(false)
      await vi.advanceTimersByTimeAsync(250)
      const signal = suggest.mock.calls[0][1]
      if (change === 'typing') {
        update(false, 'one', false)
        update(false)
      } else if (change === 'composition') {
        controller.startComposition()
        controller.endComposition()
      } else if (change === 'disabled') {
        update(false, 'one', true, false)
        update(false)
      } else {
        update(false, 'two')
        update(false)
      }
      pending.resolve({ suggestion: 'stale', model: 'fixture/test' })
      await vi.advanceTimersByTimeAsync(2_000)
      // A session switch detaches the model call so it can finish into the cache.
      expect(signal.aborted).toBe(change !== 'session-switch')
      expect(controller.getSnapshot().kind).not.toBe('shown')
      expect(suggest).toHaveBeenCalledTimes(1)
      update(true)
      update(false)
      await vi.advanceTimersByTimeAsync(250)
      expect(controller.getSnapshot()).toEqual({ kind: 'shown', text: '继续测试' })
    },
  )

  it.each(['debounce', 'retry'] as const)('cancels a scheduled %s when disabled', async (phase) => {
    suggest.mockResolvedValue({ suggestion: null, reason: 'not-idle' })
    update(true)
    update(false)
    if (phase === 'retry') await vi.advanceTimersByTimeAsync(250)
    update(false, 'one', true, false)
    update(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(suggest).toHaveBeenCalledTimes(phase === 'retry' ? 1 : 0)
    expect(controller.getSnapshot().kind).toBe('idle')
  })

  it('keeps composition ineligible across a new turn until composition ends', async () => {
    update(false)
    controller.startComposition()
    update(true)
    update(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(suggest).not.toHaveBeenCalled()
    controller.endComposition()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(suggest).not.toHaveBeenCalled()
    update(true)
    update(false)
    await vi.advanceTimersByTimeAsync(250)
    expect(suggest).toHaveBeenCalledTimes(1)
  })

  it('hides and refuses a shown suggestion immediately when disabled', async () => {
    update(true)
    update(false)
    await vi.advanceTimersByTimeAsync(250)
    update(false, 'one', true, false)
    const insert = vi.fn(() => true)
    expect(controller.getSnapshot().kind).toBe('idle')
    expect(controller.accept(insert)).toBe(false)
    expect(insert).not.toHaveBeenCalled()
  })

  it('cancels typing and does not retry after the draft is erased', async () => {
    suggest.mockResolvedValue({ suggestion: null, reason: 'not-idle' })
    update(true)
    update(false)
    await vi.advanceTimersByTimeAsync(250)
    update(false, 'one', false)
    update(false, 'one', true)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(suggest).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().kind).toBe('dismissed')
  })

  it('bounds idle-boundary retries to three attempts', async () => {
    suggest.mockResolvedValue({ suggestion: null, reason: 'not-idle' })
    update(true)
    update(false)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(suggest).toHaveBeenCalledTimes(3)
    expect(controller.getSnapshot().kind).toBe('idle')
  })

  it('does not retry a suggestion from a superseded Host turn', async () => {
    suggest.mockResolvedValue({ suggestion: null, reason: 'stale-turn' })
    update(true)
    update(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(suggest).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().kind).toBe('idle')
  })

  it('accepts once through the insertion callback and handles a stale editor revision', async () => {
    update(true)
    update(false)
    await vi.advanceTimersByTimeAsync(250)
    const insert = vi.fn(() => true)
    expect(controller.accept(insert)).toBe(true)
    expect(controller.accept(insert)).toBe(false)
    expect(insert).toHaveBeenCalledExactlyOnceWith('继续测试')
    expect(controller.getSnapshot().kind).toBe('accepted')
    update(true)
    update(false)
    await vi.advanceTimersByTimeAsync(250)
    expect(controller.accept(() => false)).toBe(false)
    expect(controller.getSnapshot().kind).toBe('dismissed')
  })

  it('dismisses an in-flight request and ignores its eventual result', async () => {
    const pending = deferred<SuggestResponse>()
    suggest.mockReturnValue(pending.promise)
    update(true)
    update(false)
    await vi.advanceTimersByTimeAsync(250)
    controller.dismiss()
    pending.resolve({ suggestion: 'late', model: 'fixture/test' })
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot().kind).toBe('dismissed')
  })

  it('degrades failed requests and cancels pending work on disposal', async () => {
    suggest.mockRejectedValue(new Error('offline'))
    update(true)
    update(false)
    await vi.advanceTimersByTimeAsync(250)
    expect(controller.getSnapshot().kind).toBe('idle')
    update(true)
    update(false)
    controller.dispose()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(suggest).toHaveBeenCalledTimes(1)
  })

  it('stays idle without retrying when the model declines to provide a candidate', async () => {
    suggest.mockResolvedValue({ suggestion: null, model: 'fixture/test' })
    update(true)
    update(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(suggest).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().kind).toBe('idle')
  })
})

describe('prediction cache across session switches', () => {
  let cache: PredictionCache
  let turns: Map<string, number | null>
  let suggest: ReturnType<
    typeof vi.fn<(id: string, signal: AbortSignal) => Promise<SuggestResponse>>
  >
  let checkTurn: ReturnType<
    typeof vi.fn<(id: string, signal: AbortSignal) => Promise<number | null>>
  >
  let controller: PredictionController
  const update = (sessionId: string, running = false, blank = true, enabled = true) =>
    controller.update({ sessionId, running, blank, enabled, automatic: true })
  const finishTurn = async (sessionId: string) => {
    update(sessionId, true)
    update(sessionId)
    await vi.advanceTimersByTimeAsync(250)
  }
  beforeEach(() => {
    vi.useFakeTimers()
    cache = new PredictionCache()
    turns = new Map([
      ['one', 5],
      ['two', 9],
    ])
    suggest = vi.fn(async (id: string) => ({
      suggestion: `next for ${id}`,
      model: 'fixture/test',
      turn: turns.get(id) ?? 0,
    }))
    checkTurn = vi.fn(async (id: string) => turns.get(id) ?? null)
    controller = new PredictionController(suggest, { cache, checkTurn })
  })
  afterEach(() => {
    controller.dispose()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it('restores a shown prediction after switching away and back on the same turn', async () => {
    update('one')
    await finishTurn('one')
    expect(controller.getSnapshot()).toEqual({ kind: 'shown', text: 'next for one' })
    update('two')
    expect(controller.getSnapshot()).toEqual({ kind: 'idle' })
    update('one')
    await vi.advanceTimersByTimeAsync(0)
    expect(checkTurn).toHaveBeenCalledWith('one', expect.any(AbortSignal))
    expect(controller.getSnapshot()).toEqual({ kind: 'shown', text: 'next for one' })
    expect(suggest).toHaveBeenCalledTimes(1)
    const insert = vi.fn(() => true)
    expect(controller.accept(insert)).toBe(true)
    expect(insert).toHaveBeenCalledWith('next for one')
  })

  it('drops the cached prediction when the session advanced in the background', async () => {
    update('one')
    await finishTurn('one')
    update('two')
    turns.set('one', 8)
    update('one')
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot()).toEqual({ kind: 'idle' })
    expect(cache.get('one')).toBeUndefined()
  })

  it.each(['running', 'draft'] as const)(
    'does not restore into a session that is %s',
    async (condition) => {
      update('one')
      await finishTurn('one')
      update('two')
      update('one', condition === 'running', condition !== 'draft')
      await vi.advanceTimersByTimeAsync(0)
      expect(checkTurn).not.toHaveBeenCalled()
      expect(controller.getSnapshot().kind).not.toBe('shown')
      expect(cache.get('one')).toBeUndefined()
    },
  )

  it('does not cache consumed predictions', async () => {
    update('one')
    await finishTurn('one')
    controller.dismiss()
    update('two')
    update('one')
    await vi.advanceTimersByTimeAsync(0)
    expect(checkTurn).not.toHaveBeenCalled()
    expect(controller.getSnapshot().kind).toBe('idle')
  })

  it('lets an in-flight request finish into the cache after a switch', async () => {
    const pending = deferred<SuggestResponse>()
    suggest.mockReturnValueOnce(pending.promise)
    update('one')
    await finishTurn('one')
    expect(controller.getSnapshot().kind).toBe('requesting')
    const signal = suggest.mock.calls[0][1]
    update('two')
    expect(signal.aborted).toBe(false)
    pending.resolve({ suggestion: 'late for one', model: 'fixture/test', turn: 5 })
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot()).toEqual({ kind: 'idle' })
    update('one')
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot()).toEqual({ kind: 'shown', text: 'late for one' })
  })

  it('shows a detached result once it lands if the user already switched back', async () => {
    const pending = deferred<SuggestResponse>()
    suggest.mockReturnValueOnce(pending.promise)
    update('one')
    await finishTurn('one')
    update('two')
    update('one')
    pending.resolve({ suggestion: 'late for one', model: 'fixture/test', turn: 5 })
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot()).toEqual({ kind: 'shown', text: 'late for one' })
  })

  it('ignores a turn check that resolves after the user started typing', async () => {
    const check = deferred<number | null>()
    update('one')
    await finishTurn('one')
    update('two')
    checkTurn.mockReturnValueOnce(check.promise)
    update('one')
    update('one', false, false)
    check.resolve(5)
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot().kind).toBe('dismissed')
    expect(cache.get('one')).toBeUndefined()
  })

  it('clears the cache and aborts detached work when disabled', async () => {
    const pending = deferred<SuggestResponse>()
    update('one')
    await finishTurn('one')
    suggest.mockReturnValueOnce(pending.promise)
    update('two')
    await finishTurn('two')
    const signal = suggest.mock.calls[1][1]
    update('three')
    expect(cache.size).toBe(1)
    update('three', false, true, false)
    expect(cache.size).toBe(0)
    expect(signal.aborted).toBe(true)
    pending.resolve({ suggestion: 'late', model: 'fixture/test', turn: 9 })
    await vi.advanceTimersByTimeAsync(0)
    expect(cache.size).toBe(0)
  })

  it('stashes on disposal so a remounted composer restores the prediction', async () => {
    update('one')
    await finishTurn('one')
    controller.dispose()
    controller = new PredictionController(suggest, { cache, checkTurn })
    update('one')
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot()).toEqual({ kind: 'shown', text: 'next for one' })
  })

  it('does not cache candidates without a Host turn and evicts the oldest session', async () => {
    suggest.mockResolvedValueOnce({ suggestion: 'legacy', model: 'fixture/test' })
    update('one')
    await finishTurn('one')
    update('two')
    expect(cache.get('one')).toBeUndefined()
    const small = new PredictionCache(2)
    small.set('a', { text: 'a', turn: 1 })
    small.set('b', { text: 'b', turn: 1 })
    small.set('a', { text: 'a2', turn: 2 })
    small.set('c', { text: 'c', turn: 1 })
    expect(small.get('b')).toBeUndefined()
    expect(small.get('a')).toEqual({ text: 'a2', turn: 2 })
  })
})
