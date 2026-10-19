// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../src/client/api'
import type { SettingsForm, SettingsSnapshot } from '../../src/client/dsh/contracts'
import { en } from '../../src/client/locales'
import { SettingsPage } from '../../src/client/settings/settings-page'
import { resolveSettings } from '../../src/host/config'

function settingsFixture(writable = true) {
  let snapshot: SettingsSnapshot = {
    status: 'ready',
    writable,
    value: resolveSettings({ systemPrompt: 'original' }),
    base: { systemPrompt: 'base prompt' },
  }
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const form: SettingsForm = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: vi.fn(async (key, value) => {
      snapshot = { ...snapshot, value: { ...snapshot.value, [key]: value } }
      notify()
      return true
    }),
    unset: vi.fn(async () => {
      snapshot = { ...snapshot, value: { ...snapshot.value, systemPrompt: 'base prompt' } }
      notify()
      return true
    }),
  }
  return { form, listeners }
}

beforeEach(() => {
  vi.spyOn(api, 'models').mockResolvedValue([])
})
afterEach(() => cleanup())

describe('settings form integration', () => {
  it('saves typed fields through configForms and normalizes model selection', async () => {
    const { form } = settingsFixture()
    const view = render(<SettingsPage form={form} t={(key) => en[key]} />)
    fireEvent.change(view.getByLabelText('Provider'), { target: { value: ' provider ' } })
    fireEvent.change(view.getByLabelText('Model'), { target: { value: ' model ' } })
    fireEvent.change(view.getByLabelText('Context messages'), { target: { value: '12' } })
    await act(async () => {
      fireEvent.click(view.getByText('Save', { selector: 'button' }))
    })
    expect(form.set).toHaveBeenCalledWith('provider', 'provider')
    expect(form.set).toHaveBeenCalledWith('model', 'model')
    expect(form.set).toHaveBeenCalledWith('maxContextMessages', 12)
    expect(view.getByRole('status').textContent).toBe(en.saved)
    expect((view.getByLabelText('Provider') as HTMLInputElement).value).toBe('provider')
    expect((view.getByText('Save', { selector: 'button' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('recovers from a rejected save and preserves the draft for retry', async () => {
    const { form } = settingsFixture()
    vi.mocked(form.set).mockRejectedValueOnce(new Error('offline'))
    const view = render(<SettingsPage form={form} t={(key) => en[key]} />)
    fireEvent.change(view.getByLabelText('System prompt'), { target: { value: 'edited' } })
    await act(async () => {
      fireEvent.click(view.getByText('Save', { selector: 'button' }))
    })
    expect(view.getByRole('status').textContent).toBe(en.saveFailed)
    expect((view.getByLabelText('System prompt') as HTMLTextAreaElement).value).toBe('edited')
    expect((view.getByText('Save', { selector: 'button' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
    await act(async () => {
      fireEvent.click(view.getByText('Save', { selector: 'button' }))
    })
    expect(view.getByRole('status').textContent).toBe(en.saved)
  })

  it('validates context bounds and restores the inherited prompt', async () => {
    const { form } = settingsFixture()
    const view = render(<SettingsPage form={form} t={(key) => en[key]} />)
    fireEvent.change(view.getByLabelText('Context messages'), { target: { value: '65' } })
    expect((view.getByText('Save', { selector: 'button' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(view.getByText(en.invalidContext)).toBeDefined()
    await act(async () => {
      fireEvent.click(view.getByText('Reset to default'))
    })
    expect(form.unset).toHaveBeenCalledWith('systemPrompt')
    expect((view.getByLabelText('System prompt') as HTMLTextAreaElement).value).toBe('base prompt')
  })

  it('keeps every write action disabled for a read-only deployment and unsubscribes', () => {
    const { form, listeners } = settingsFixture(false)
    const view = render(<SettingsPage form={form} t={(key) => en[key]} />)
    fireEvent.click(view.getByText('Reset to default'))
    fireEvent.click(view.getByRole('switch'))
    expect((view.getByText('Reset to default') as HTMLButtonElement).disabled).toBe(true)
    expect(form.unset).not.toHaveBeenCalled()
    expect(form.set).not.toHaveBeenCalled()
    view.unmount()
    expect(listeners.size).toBe(0)
  })

  it('supports model selection with the keyboard and saves the provider/model pair', async () => {
    vi.mocked(api.models).mockResolvedValue([
      { provider: 'fixture', id: 'model', name: 'Fixture model' },
    ])
    const { form } = settingsFixture()
    const view = render(<SettingsPage form={form} t={(key) => en[key]} />)
    await act(async () => {})
    const trigger = view.getByRole('combobox')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    await act(async () => {
      fireEvent.click(view.getByText('Save', { selector: 'button' }))
    })
    expect(form.set).toHaveBeenCalledWith('provider', 'fixture')
    expect(form.set).toHaveBeenCalledWith('model', 'model')
  })
})
