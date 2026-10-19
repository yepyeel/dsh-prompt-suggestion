// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../src/client/api'
import type { ClientContext, GhostProps, SettingsSnapshot } from '../../src/client/dsh/contracts'
import { apply } from '../../src/client/index'
import { zh } from '../../src/client/locales'
import type { SuggestResponse } from '../../src/shared/contracts'

describe('composer integration', () => {
  let running: boolean
  let draft: string
  let sessionId: string
  let attachmentIds: unknown[]
  let settings: SettingsSnapshot
  let settingsListeners: Set<() => void>
  let Ghost: React.ComponentType<GhostProps>
  let Controls: React.ComponentType<GhostProps>
  const actions = {
    captureInsertion: vi.fn(() => ({ revision: 7 })),
    insertText: vi.fn(() => true),
    submit: vi.fn(),
  }
  const props = (): GhostProps => ({
    sessionId,
    inputActions: actions,
    useInput: (selector) => selector({ draft, attachmentIds }),
    useSession: (selector) => selector({ running }),
  })
  function Composer() {
    return (
      <div>
        <div>
          <div>
            <span data-composer-placeholder="" style={{ visibility: 'visible' }}>
              placeholder
            </span>
          </div>
        </div>
        <div data-toolbar="">
          <Controls {...props()} />
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: Match DSH's contenteditable composer in this integration fixture. */}
        <div
          contentEditable
          suppressContentEditableWarning
          tabIndex={0}
          role="textbox"
          aria-label="Composer"
        />
        <Ghost {...props()} />
      </div>
    )
  }
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    running = true
    draft = ''
    sessionId = 'one'
    attachmentIds = []
    settings = { status: 'ready', value: { enabled: true } }
    settingsListeners = new Set()
    const components = new Map<string, unknown>()
    const ctx: ClientContext = {
      locale: { bind: () => (key) => zh[key], register: () => {} },
      configForms: {
        get: () => ({
          getSnapshot: () => settings,
          subscribe: (listener) => {
            settingsListeners.add(listener)
            return () => {
              settingsListeners.delete(listener)
            }
          },
          set: async () => true,
          unset: async () => true,
        }),
      },
      slots: {
        inject: (_slot, register) => register(),
        register: (entry, component) => components.set(entry.id, component),
      },
      effect: () => {},
    }
    apply(ctx)
    Ghost = components.get('prompt-ghost') as React.ComponentType<GhostProps>
    Controls = components.get('prompt-suggestion-controls') as React.ComponentType<GhostProps>
    vi.spyOn(api, 'suggest').mockResolvedValue({ suggestion: '继续测试', model: 'fixture/model' })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const top = this.hasAttribute('data-toolbar') ? 100 : 10
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        right: 500,
        bottom: top + 24,
        width: 500,
        height: 24,
        toJSON: () => ({}),
      }
    })
  })
  afterEach(async () => {
    cleanup()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(settingsListeners.size).toBe(0)
    vi.useRealTimers()
  })

  function setEnabled(enabled: boolean) {
    act(() => {
      settings = { status: 'ready', value: { enabled } }
      for (const listener of settingsListeners) listener()
    })
  }

  async function show() {
    const view = render(
      <StrictMode>
        <Composer />
      </StrictMode>,
    )
    running = false
    view.rerender(
      <StrictMode>
        <Composer />
      </StrictMode>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(view.container.querySelector('.dsh-ps-text')?.textContent).toBe('继续测试')
    return view
  }

  it.each(['Tab', 'ArrowRight'])(
    '%s inserts a draft exactly once without submitting',
    async (key) => {
      const view = await show()
      const editor = view.getByRole('textbox', { name: 'Composer' })
      editor.focus()
      expect(fireEvent.keyDown(editor, { key })).toBe(false)
      expect(actions.insertText).toHaveBeenCalledExactlyOnceWith('继续测试', { revision: 7 })
      expect(actions.submit).not.toHaveBeenCalled()
      expect(view.container.querySelector('.dsh-ps-text')).toBeNull()
      expect(
        view.container.querySelector<HTMLElement>('[data-composer-placeholder]')?.style.visibility,
      ).toBe('visible')
    },
  )

  it('ignores modified keys and IME key events, and restores the placeholder on Escape', async () => {
    const view = await show()
    const editor = view.getByRole('textbox', { name: 'Composer' })
    editor.focus()
    fireEvent.keyDown(editor, { key: 'Tab', ctrlKey: true })
    fireEvent.keyDown(editor, { key: 'Tab', shiftKey: true })
    fireEvent.keyDown(editor, { key: 'ArrowRight', isComposing: true })
    expect(actions.insertText).not.toHaveBeenCalled()
    expect(
      view.container.querySelector<HTMLElement>('[data-composer-placeholder]')?.style.visibility,
    ).toBe('hidden')
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(view.container.querySelector('.dsh-ps-text')).toBeNull()
    expect(
      view.container.querySelector<HTMLElement>('[data-composer-placeholder]')?.style.visibility,
    ).toBe('visible')
  })

  it.each(['compositionstart', 'beforeinput', 'input'])(
    'cancels on %s before an in-flight request returns or the draft updates',
    async (event) => {
      let resolve!: (response: SuggestResponse) => void
      vi.mocked(api.suggest).mockReturnValue(
        new Promise((done) => {
          resolve = done
        }),
      )
      const view = render(<Composer />)
      running = false
      view.rerender(<Composer />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250)
      })
      fireEvent(view.getByRole('textbox'), new Event(event, { bubbles: true }))
      await act(async () => {
        resolve({ suggestion: 'stale', model: 'fixture/model' })
      })
      expect(vi.mocked(api.suggest).mock.calls[0][1].aborted).toBe(true)
      expect(view.container.querySelector('.dsh-ps-text')).toBeNull()
    },
  )

  it('subscribes to enablement, cancels pending work, and does not revive it when re-enabled', async () => {
    let resolve!: (response: SuggestResponse) => void
    vi.mocked(api.suggest).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const view = render(<Composer />)
    running = false
    view.rerender(<Composer />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    setEnabled(false)
    expect(vi.mocked(api.suggest).mock.calls[0][1].aborted).toBe(true)
    setEnabled(true)
    await act(async () => {
      resolve({ suggestion: 'stale', model: 'fixture/model' })
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(view.container.querySelector('.dsh-ps-text')).toBeNull()
    expect(api.suggest).toHaveBeenCalledTimes(1)
    running = true
    view.rerender(<Composer />)
    running = false
    view.rerender(<Composer />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(view.container.querySelector('.dsh-ps-text')?.textContent).toBe('继续测试')
  })

  it('hides a shown suggestion and restores the placeholder when disabled', async () => {
    const view = await show()
    setEnabled(false)
    expect(view.container.querySelector('.dsh-ps-text')).toBeNull()
    expect(
      view.container.querySelector<HTMLElement>('[data-composer-placeholder]')?.style.visibility,
    ).toBe('visible')
    const editor = view.getByRole('textbox')
    editor.focus()
    expect(fireEvent.keyDown(editor, { key: 'Tab' })).toBe(true)
    expect(actions.insertText).not.toHaveBeenCalled()
  })

  it('cancels pending suggestions when an attachment is added, even if later removed', async () => {
    let resolve!: (response: SuggestResponse) => void
    vi.mocked(api.suggest).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const view = render(<Composer />)
    running = false
    view.rerender(<Composer />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    attachmentIds = ['attachment']
    view.rerender(<Composer />)
    attachmentIds = []
    view.rerender(<Composer />)
    await act(async () => {
      resolve({ suggestion: 'stale', model: 'fixture/model' })
    })
    expect(vi.mocked(api.suggest).mock.calls[0][1].aborted).toBe(true)
    expect(view.container.querySelector('.dsh-ps-text')).toBeNull()
  })

  it('invalidates a shown suggestion when the session changes and detaches on unmount', async () => {
    const view = await show()
    sessionId = 'two'
    view.rerender(
      <StrictMode>
        <Composer />
      </StrictMode>,
    )
    expect(view.container.querySelector('.dsh-ps-text')).toBeNull()
    view.unmount()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(actions.insertText).not.toHaveBeenCalled()
  })

  it('does not capture keys outside the active composer', async () => {
    await show()
    const other = document.createElement('input')
    document.body.append(other)
    other.focus()
    expect(fireEvent.keyDown(other, { key: 'Tab' })).toBe(true)
    expect(actions.insertText).not.toHaveBeenCalled()
    other.remove()
  })

  it('pauses automatic prediction per session and generates manually without sending', async () => {
    const view = render(<Composer />)
    fireEvent.click(view.getByRole('button', { name: '自动预测：开' }))
    running = false
    view.rerender(<Composer />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(api.suggest).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: '生成建议' }))
    })
    expect(api.suggest).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('.dsh-ps-text')?.textContent).toBe('继续测试')
    expect(actions.submit).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(view.getByRole('textbox'))
    sessionId = 'two'
    view.rerender(<Composer />)
    expect(view.getByRole('button', { name: '自动预测：开' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    sessionId = 'one'
    view.rerender(<Composer />)
    expect(view.getByRole('button', { name: '自动预测：关' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
    expect(api.suggest).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('.dsh-ps-text')).toBeNull()
  })

  it('generates from Alt+Shift+P only when the idle composer owns focus', async () => {
    running = false
    const view = render(<Composer />)
    const key = { key: 'P', code: 'KeyP', altKey: true, shiftKey: true }
    const other = document.createElement('input')
    document.body.append(other)
    other.focus()
    expect(fireEvent.keyDown(other, key)).toBe(true)
    expect(api.suggest).not.toHaveBeenCalled()
    other.remove()
    const editor = view.getByRole('textbox')
    editor.focus()
    expect(fireEvent.keyDown(editor, { ...key, isComposing: true })).toBe(true)
    expect(fireEvent.keyDown(editor, { ...key, repeat: true })).toBe(true)
    expect(api.suggest).not.toHaveBeenCalled()
    await act(async () => {
      expect(fireEvent.keyDown(editor, key)).toBe(false)
    })
    expect(api.suggest).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('.dsh-ps-text')?.textContent).toBe('继续测试')
    expect(actions.insertText).not.toHaveBeenCalled()
    expect(actions.submit).not.toHaveBeenCalled()
    setEnabled(false)
    expect(view.queryByRole('group', { name: '本会话的输入预测' })).toBeNull()
    expect(fireEvent.keyDown(editor, key)).toBe(true)
    expect(api.suggest).toHaveBeenCalledTimes(1)
  })

  it('disables manual generation while running or while a draft or attachment exists', () => {
    const view = render(<Composer />)
    const disabled = () =>
      (view.getByRole('button', { name: '生成建议' }) as HTMLButtonElement).disabled
    expect(disabled()).toBe(true)
    running = false
    draft = 'draft'
    view.rerender(<Composer />)
    expect(disabled()).toBe(true)
    draft = ''
    attachmentIds = ['file']
    view.rerender(<Composer />)
    expect(disabled()).toBe(true)
    expect(api.suggest).not.toHaveBeenCalled()
  })
})
