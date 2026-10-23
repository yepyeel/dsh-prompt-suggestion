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
          message('assistant', 'old'),
          message('user', 'current request'),
          message('tool', 'line one\n   line two'),
          message('assistant', 'done'),
        ],
        3,
      ),
    ).toBe('用户: current request\n\n工具: [工具结果] line one line two\n\n助手: done')
  })

  it('keeps the beginning and final question of a long reply, with an explicit omission', () => {
    const transcript = buildTranscript([
      message('user', `请保留兼容性。${'需求细节'.repeat(300)}最后，请先补回归测试。`),
      message('assistant', `已经完成修复。${'中间分析'.repeat(300)}结论：测试已通过。需要提交吗？`),
    ])
    expect(transcript).toContain('用户: 请保留兼容性。')
    expect(transcript).toContain('最后，请先补回归测试。')
    expect(transcript).toContain('助手: 已经完成修复。')
    expect(transcript).toContain('…[中间内容已省略]…')
    expect(transcript).toMatch(/结论：测试已通过。需要提交吗？$/)
    expect(transcript).not.toContain('中间分析'.repeat(200))
  })

  it.each([2, 16, 64])(
    'reserves the latest request and reply within a %i-message budget',
    (limit) => {
      const transcript = buildTranscript(
        [
          message('user', 'old request'),
          message('assistant', 'old reply'),
          message('user', '当前需求：修复取消逻辑'),
          ...Array.from({ length: 70 }, (_, index) =>
            message('assistant', `${index}: ${'x'.repeat(300)}`),
          ),
          message('assistant', '修复完成，需要继续测试吗？'),
        ],
        limit,
      )
      expect(transcript).toMatch(/^用户: 当前需求：修复取消逻辑/)
      expect(transcript).toMatch(/助手: 修复完成，需要继续测试吗？$/)
      expect(transcript).not.toContain('old request')
      expect(transcript).not.toContain('old reply')
      expect(transcript.split('\n\n').length).toBeLessThanOrEqual(limit)
      expect(transcript.length).toBeLessThanOrEqual(7_000)
    },
  )

  const call = (id: string, name: string, args: unknown) => ({
    role: 'assistant',
    content: [{ type: 'tool-call', id, name, arguments: args }],
  })
  const result = (toolCallId: string, text: string, isError = false) => ({
    role: 'tool',
    toolCallId,
    isError,
    content: [{ type: 'text', text }],
  })

  it('renders tool calls next to their results so the model sees what happened', () => {
    const transcript = buildTranscript([
      message('user', '修复超时'),
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '先看一下代码。' },
          { type: 'tool-call', id: 'a', name: 'read', arguments: '{"file_path":"src/a.ts"}' },
        ],
      },
      result('a', 'export const a = 1'),
      call(
        'b',
        'edit',
        JSON.stringify({ file_path: 'src/a.ts', old_string: 'x', new_string: 'y' }),
      ),
      result('b', 'ok'),
      call('c', 'bash', { command: 'pnpm   test', description: 'Run tests' }),
      result('c', `${'log '.repeat(100)}FAIL tests/a.test.ts\n[exit code: 1]`),
      message('assistant', '测试失败了，需要我继续修吗？'),
    ])
    expect(transcript).toBe(
      [
        '用户: 修复超时',
        '助手: 先看一下代码。',
        [
          '工具: [调用 read] src/a.ts → 结果：export const a = 1',
          '[调用 edit] src/a.ts → 结果：ok',
          `[调用 bash] pnpm test → 失败：…${`${'log '.repeat(100)}FAIL tests/a.test.ts [exit code: 1]`.slice(-159)}`,
        ].join('\n'),
        '助手: 测试失败了，需要我继续修吗？',
      ].join('\n\n'),
    )
  })

  it('marks explicit tool errors, tolerates odd arguments, and keeps calls without results', () => {
    const transcript = buildTranscript([
      message('user', 'go'),
      call('a', 'fetch', 'not json'),
      result('a', 'connection refused', true),
      call('b', 'custom', { nested: { deep: true }, label: 'first string' }),
      call('c', '', null),
      message('assistant', 'done'),
    ])
    expect(transcript).toContain('[调用 fetch] not json → 失败：connection refused')
    expect(transcript).toContain('[调用 custom] first string')
    expect(transcript).toContain('[调用 工具]\n')
    expect(transcript).not.toContain('[工具结果]')
  })

  it('folds a long run of operations into one bounded entry that keeps the newest', () => {
    const messages = [
      message('user', '批量修改'),
      ...Array.from({ length: 20 }, (_, index) => [
        call(`c${index}`, 'bash', { command: `step-${index} ${'y'.repeat(200)}` }),
        result(`c${index}`, 'z'.repeat(400)),
      ]).flat(),
      message('assistant', '全部完成'),
    ]
    const transcript = buildTranscript(messages, 3)
    const entries = transcript.split('\n\n')
    expect(entries).toHaveLength(3)
    expect(entries[1]).toMatch(/^工具: （前 \d+ 项操作已省略）/)
    expect(entries[1]).toContain('step-19')
    expect(entries[1]).not.toContain('step-0 ')
    expect(entries[1].length).toBeLessThanOrEqual(1_250)
    expect(transcript).toMatch(/助手: 全部完成$/)
  })

  it('bounds individual messages and total context', () => {
    const messages = Array.from({ length: 30 }, (_, index) =>
      message('user', `${index}:${'x'.repeat(900)}`),
    )
    const transcript = buildTranscript(messages, 64)
    expect(transcript).toContain('29:')
    expect(transcript).not.toContain('用户: 0:')
    expect(transcript.length).toBeLessThanOrEqual(7_000)
    expect(transcript.split('\n\n').every((line) => line.length <= 705)).toBe(true)
  })
})

describe('suggestion parsing', () => {
  it.each(['', '  ', 'NO_SUGGESTION', '“NO_SUGGESTION”', 'null', 'NO_SUGGESTION\n无法确定下一步'])(
    'accepts abstention %j as a normal empty result',
    (raw) => expect(parseSuggestion(raw)).toBeNull(),
  )

  it.each([
    '继续',
    '请继续。',
    '好的，请继续吧！',
    '继续下一步',
    'continue',
    'Please continue.',
    'Go ahead!',
    'OK, keep going.',
  ])('discards generic continuation %j', (raw) => expect(parseSuggestion(raw)).toBeNull())

  it.each([
    '继续补齐回归测试',
    'Continue debugging the timeout',
    '采用第二个方案',
    'B',
    '不用部署',
  ])('preserves specific actions and short answers %j', (raw) =>
    expect(parseSuggestion(raw)).toBe(raw),
  )

  it('compares all user history after normalizing whitespace, quotes, case, and ending punctuation', () => {
    const messages = [
      message('user', 'Please   add regression tests.'),
      message('assistant', '完成'),
      message('user', '检查取消逻辑。'),
    ]
    expect(parseSuggestion('1. “please add regression tests”', messages)).toBeNull()
    expect(parseSuggestion('检查取消逻辑！', messages)).toBeNull()
    expect(parseSuggestion('检查新的超时路径', messages)).toBe('检查新的超时路径')
  })

  it('does not treat assistant or tool text as a previous user request', () => {
    expect(
      parseSuggestion('添加回归测试', [
        message('assistant', '添加回归测试'),
        message('tool', '添加回归测试'),
      ]),
    ).toBe('添加回归测试')
  })

  it.each([
    ['1. “继续添加测试”\n其他内容', '继续添加测试'],
    ['- next step', 'next step'],
    ['用户：先把失败的测试修好', '先把失败的测试修好'],
    ['→ 提交并发布一个新版本', '提交并发布一个新版本'],
    ['Prediction: run the tests again', 'run the tests again'],
    ['用户名校验也要补上', '用户名校验也要补上'],
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
  it('sends the transcript with the output contract as its final line', async () => {
    const requests: { messages: { content: { text: string }[] }[]; system: string }[] = []
    const llm = {
      async *stream(request: (typeof requests)[number]) {
        requests.push(request)
        yield { type: 'finish', reason: { kind: 'completed' } }
      },
    }
    await complete(
      llm as never,
      { provider: 'test', model: 'model' },
      '用户: 修复超时',
      new AbortController().signal,
      resolveSettings({}),
    )
    const text = requests[0].messages[0].content[0].text
    expect(text).toMatch(/^对话记录：\n\n用户: 修复超时\n\n---\n/)
    expect(text).toMatch(/NO_SUGGESTION。$/)
    expect(requests[0].system).toBe(DEFAULT_PROMPT)
  })

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
