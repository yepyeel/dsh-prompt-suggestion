import { describe, expect, it } from 'vitest'
import {
  buildTranscript,
  complete,
  DEFAULT_PROMPT,
  isAtRest,
  parseSuggestion,
  pickModel,
  resolveSettings,
} from '../../src/host/index'

const message = (role: string, text: string) => ({ role, content: [{ type: 'text', text }] })
const session = (events: { type: string; data?: { reason: { kind: string } } }[]) => ({
  seq: events.length,
  eventAt: (seq: number) => events[seq],
})

describe('transcript budget', () => {
  it('excludes instruction messages and preserves user/assistant order', () => {
    expect(
      buildTranscript([
        message('system', 'private instructions'),
        message('developer', 'more instructions'),
        message('user', '  帮我修复问题  '),
        message('assistant', '已经完成'),
      ]),
    ).toBe('用户: 帮我修复问题\n\n助手: 已经完成')
  })

  it('keeps the newest messages and abbreviates tool output', () => {
    expect(
      buildTranscript(
        [
          message('user', 'old'),
          message('tool', 'line one\n   line two'),
          message('assistant', 'done'),
        ],
        2,
      ),
    ).toBe('工具: [工具结果] line one line two\n\n助手: done')
  })

  it('bounds individual messages and total context', () => {
    const messages = Array.from({ length: 30 }, (_, index) =>
      message('user', `${index}:${'x'.repeat(900)}`),
    )
    const transcript = buildTranscript(messages, 64)
    expect(transcript).toContain('29:')
    expect(transcript).not.toContain('用户: 0:')
    expect(transcript.length).toBeLessThan(7_100)
    expect(transcript.split('\n\n').every((line) => line.length <= 705)).toBe(true)
  })
})

describe('suggestion parsing', () => {
  it.each([
    ['1. “继续添加测试”\n其他内容', '继续添加测试'],
    ['- next step', 'next step'],
    ['\n\n  plain text  ', 'plain text'],
    ['```code```', null],
    ['', null],
    ['x'.repeat(201), null],
    [null, null],
  ])('normalizes %j', (raw, expected) => {
    expect(parseSuggestion(raw)).toBe(expected)
  })
})

describe('completed turn detection', () => {
  it.each(['completed', 'error', 'aborted'])('handles turn end reason %s', (kind) => {
    const value = session([{ type: 'turn/end', data: { reason: { kind } } }])
    expect(isAtRest(value)).toBe(kind === 'completed')
  })

  it('ignores trailing bookkeeping but rejects a newer turn or user message', () => {
    const completed = { type: 'turn/end', data: { reason: { kind: 'completed' } } }
    expect(isAtRest(session([completed, { type: 'usage' }]))).toBe(true)
    expect(isAtRest(session([completed, { type: 'turn/start' }]))).toBe(false)
    expect(isAtRest(session([completed, { type: 'user/message' }]))).toBe(false)
    expect(isAtRest(session([]))).toBe(false)
  })
})

describe('volatile settings and model selection', () => {
  it('reads accessors on each request and falls back when a field is unavailable', () => {
    let enabled = true
    const config = {
      enabled: { get: () => enabled },
      systemPrompt: {
        get: () => {
          throw new Error('unavailable')
        },
      },
      provider: ' provider ',
      model: ' model ',
    }
    expect(resolveSettings(config)).toMatchObject({
      enabled: true,
      systemPrompt: DEFAULT_PROMPT,
      provider: 'provider',
      model: 'model',
    })
    enabled = false
    expect(resolveSettings(config).enabled).toBe(false)
  })

  it('prefers a complete override, then the session, then the process default', () => {
    const fallback = { provider: 'default', model: 'default-model' }
    const ctx = { get: () => ({ currentSelection: () => fallback }) }
    const current = {
      requestHeader: () => ({ config: { provider: 'session', model: 'session-model' } }),
    }
    expect(
      pickModel(ctx, current, resolveSettings({ provider: 'fixed', model: 'fixed-model' })),
    ).toEqual({ provider: 'fixed', model: 'fixed-model' })
    expect(pickModel(ctx, current, resolveSettings({ provider: 'incomplete' }))).toEqual({
      provider: 'session',
      model: 'session-model',
    })
    expect(pickModel(ctx, {}, resolveSettings({}))).toEqual(fallback)
  })
})

describe('stream completion', () => {
  it('joins text deltas and stops at finish', async () => {
    const llm = {
      async *stream() {
        yield { type: 'text-delta', text: '继续' }
        yield { type: 'reasoning-delta', text: 'hidden' }
        yield { type: 'text-delta', text: '测试' }
        yield { type: 'finish', reason: { kind: 'completed' } }
        yield { type: 'text-delta', text: 'ignored' }
      },
    }
    await expect(
      complete(
        llm,
        { provider: 'test', model: 'model' },
        'transcript',
        new AbortController().signal,
        resolveSettings({}),
      ),
    ).resolves.toBe('继续测试')
  })

  it.each(['error', 'aborted'])('rejects a %s finish', async (kind) => {
    const llm = {
      async *stream() {
        yield { type: 'finish', reason: { kind } }
      },
    }
    await expect(
      complete(
        llm,
        { provider: 'test', model: 'model' },
        '',
        new AbortController().signal,
        resolveSettings({}),
      ),
    ).rejects.toThrow()
  })
})
