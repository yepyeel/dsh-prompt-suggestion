// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../src/client/api'
import type { GhostProps } from '../../src/client/dsh/contracts'
import { PromptGhost } from '../../src/client/ghost/prompt-ghost'
import type { SuggestResponse } from '../../src/shared/contracts'

describe('composer integration', () => {
  let running: boolean
  let draft: string
  let sessionId: string
  const actions = {
    captureInsertion: vi.fn(() => ({ revision: 7 })),
    insertText: vi.fn(() => true),
    submit: vi.fn(),
  }
  const props = (): GhostProps => ({
    sessionId,
    inputActions: actions,
    useInput: (selector) => selector({ draft, attachmentIds: [] }),
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
        <div data-toolbar="" />
        {/* biome-ignore lint/a11y/useSemanticElements: Match DSH's contenteditable composer in this integration fixture. */}
        <div
          contentEditable
          suppressContentEditableWarning
          tabIndex={0}
          role="textbox"
          aria-label="Composer"
        />
        <PromptGhost {...props()} />
      </div>
    )
  }
  beforeEach(() => {
    vi.useFakeTimers()
    running = true
    draft = ''
    sessionId = 'one'
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
    vi.useRealTimers()
  })

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

  it('cancels on IME composition before an in-flight request returns', async () => {
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
    fireEvent.compositionStart(view.getByRole('textbox'))
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
})
