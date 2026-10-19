// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../src/client/api'

beforeEach(() => {
  document.head.innerHTML = '<base href="http://localhost/prefix/">'
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.head.innerHTML = ''
})

describe('browser API boundary', () => {
  it('uses document-relative paths and sends only the session ID with same-origin credentials', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ suggestion: 'next', model: 'fixture/model' })),
      )
    vi.stubGlobal('fetch', fetcher)
    expect(await api.suggest('one', new AbortController().signal)).toEqual({
      suggestion: 'next',
      model: 'fixture/model',
    })
    expect(fetcher.mock.calls[0][0].href).toBe('http://localhost/prefix/prompt-suggestion/suggest')
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: 'same-origin',
      body: '{"sessionId":"one"}',
    })
  })

  it.each([{ suggestion: 5 }, { suggestion: null, reason: 'unknown' }, { models: [] }])(
    'rejects a malformed suggestion %j',
    async (data) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(data))))
      await expect(api.suggest('one', new AbortController().signal)).rejects.toThrow(
        'Invalid suggestion response',
      )
    },
  )

  it('validates model entries and fills absent display names', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ models: [{ provider: 'fixture', id: 'model' }] })),
        ),
    )
    expect(await api.models(new AbortController().signal)).toEqual([
      { provider: 'fixture', id: 'model', name: 'model' },
    ])
  })

  it('propagates cancellation and clears request deadlines', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            requestSignal = options.signal ?? undefined
            options.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            })
          }),
      ),
    )
    const controller = new AbortController()
    const result = expect(api.suggest('one', controller.signal)).rejects.toThrow('aborted')
    controller.abort()
    await result
    expect(requestSignal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts stalled requests after the client transport budget', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => reject(new Error('deadline')), {
              once: true,
            })
          }),
      ),
    )
    const result = expect(api.suggest('one', new AbortController().signal)).rejects.toThrow(
      'deadline',
    )
    await vi.advanceTimersByTimeAsync(10_000)
    await result
    expect(vi.getTimerCount()).toBe(0)
  })
})
