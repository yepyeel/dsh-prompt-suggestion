import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PredictionController } from '../../src/client/ghost/controller'
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
  const update = (running: boolean, sessionId = 'one', blank = true, enabled = true) =>
    controller.update({ sessionId, running, blank, enabled })
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

  it('drops an old session response even when the transport ignores abort', async () => {
    const pending = deferred<SuggestResponse>()
    suggest.mockReturnValue(pending.promise)
    update(true)
    update(false)
    await vi.advanceTimersByTimeAsync(250)
    const signal = suggest.mock.calls[0][1]
    update(false, 'two')
    pending.resolve({ suggestion: 'stale', model: 'fixture/test' })
    await vi.advanceTimersByTimeAsync(0)
    expect(signal.aborted).toBe(true)
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
      expect(signal.aborted).toBe(true)
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
})
