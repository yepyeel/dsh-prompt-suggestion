import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClientContext,
  CommandContribution,
  CommandOption,
  CommandUi,
  SettingsForm,
  SettingsSnapshot,
} from '../../src/client/dsh/contracts'
import { predictionCommands } from '../../src/client/ghost/commands'
import { SessionPredictionControls } from '../../src/client/ghost/session-controls'
import { apply } from '../../src/client/index'
import type { LocaleKey } from '../../src/client/locales'

describe('client commands', () => {
  let settings: SettingsSnapshot
  let controls: SessionPredictionControls
  let commands: CommandContribution[]
  const form: SettingsForm = {
    getSnapshot: () => settings,
    subscribe: () => () => {},
    set: async () => true,
    unset: async () => true,
  }
  const t = (key: LocaleKey) => key

  beforeEach(() => {
    vi.useFakeTimers()
    settings = { status: 'ready', value: { enabled: true } }
    controls = new SessionPredictionControls()
    commands = predictionCommands({ form, controls, t })
  })

  afterEach(() => {
    controls.dispose()
    vi.useRealTimers()
  })

  function command(name: string) {
    const found = commands.find((entry) => entry.name === name)
    if (!found) throw new Error(`missing /${name}`)
    return found
  }

  it('hides both commands when prediction is disabled or settings are unready', () => {
    const session = { sessionId: 'one' }
    expect(commands.every((entry) => entry.available(session))).toBe(true)
    settings = { status: 'ready', value: { enabled: false } }
    expect(commands.some((entry) => entry.available(session))).toBe(false)
    settings = { status: 'loading' }
    expect(commands.some((entry) => entry.available(session))).toBe(false)
  })

  it('runs the manual request only after the slash token is consumed', () => {
    const request = vi.fn(() => true)
    controls.registerManual('one', request)
    const suggest = command('suggest')
    expect(suggest.ui.kind).toBe('action')
    if (suggest.ui.kind !== 'action') return
    suggest.ui.run({ sessionId: 'one' })
    expect(request).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('reflects and updates the session automatic preference', async () => {
    const autopredict = command('autopredict')
    const ui = autopredict.ui
    expect(ui.kind).toBe('popupSelect')
    if (ui.kind !== 'popupSelect') return
    const options = async () => (await ui.options({ sessionId: 'one' })) as CommandOption[]
    expect((await options()).map((option) => [option.id, option.active])).toEqual([
      ['on', true],
      ['off', false],
    ])
    await ui.onSelect({ id: 'off', label: 'off' }, { sessionId: 'one' })
    expect(controls.getAutomatic('one')).toBe(false)
    expect((await options()).map((option) => [option.id, option.active])).toEqual([
      ['on', false],
      ['off', true],
    ])
  })

  it('registers the commands with the command surface when it is available', () => {
    const registered: CommandContribution[] = []
    const commandUi: CommandUi = {
      register: (contribution) => {
        registered.push(contribution)
      },
    }
    const ctx: ClientContext = {
      locale: { bind: () => t, register: () => {} },
      configForms: { get: () => form },
      slots: { inject: (_slot, register) => register(), register: () => {} },
      effect: () => {},
      inject: (deps, callback) => {
        expect(deps).toEqual(['commandUi'])
        callback({
          get: () => commandUi,
          effect: (factory: () => unknown) => factory(),
        })
      },
    }
    apply(ctx)
    expect(registered.map((entry) => entry.name)).toEqual(['suggest', 'autopredict'])
  })
})
