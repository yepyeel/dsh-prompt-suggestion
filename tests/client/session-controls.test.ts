import { describe, expect, it, vi } from 'vitest'
import { SessionPredictionControls } from '../../src/client/ghost/session-controls'

describe('session prediction controls', () => {
  it('persists only the disabled preference, independently for each session', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    }
    const controls = new SessionPredictionControls(storage)
    const listener = vi.fn()
    const unlisten = controls.subscribe(listener)
    expect(controls.getAutomatic('one')).toBe(true)
    controls.setAutomatic('one', false)
    expect(controls.getAutomatic('one')).toBe(false)
    expect(controls.getAutomatic('two')).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    const reopened = new SessionPredictionControls(storage)
    expect(reopened.getAutomatic('one')).toBe(false)
    reopened.setAutomatic('one', true)
    expect(values.size).toBe(0)
    unlisten()
    controls.setAutomatic('two', false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps the toggle usable when browser storage is blocked', () => {
    const fail = () => {
      throw new Error('storage blocked')
    }
    const controls = new SessionPredictionControls({
      getItem: fail,
      setItem: fail,
      removeItem: fail,
    })
    expect(controls.getAutomatic('one')).toBe(true)
    controls.setAutomatic('one', false)
    expect(controls.getAutomatic('one')).toBe(false)
    controls.setAutomatic('one', true)
    expect(controls.getAutomatic('one')).toBe(true)
  })

  it('dispatches manual commands only to the currently registered session and releases handlers', () => {
    const controls = new SessionPredictionControls()
    const old = vi.fn(() => true)
    const current = vi.fn(() => true)
    const disposeOld = controls.registerManual('one', old)
    const disposeCurrent = controls.registerManual('one', current)
    disposeOld()
    expect(controls.requestManual('two')).toBe(false)
    expect(controls.requestManual('one')).toBe(true)
    expect(old).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledTimes(1)
    disposeCurrent()
    expect(controls.requestManual('one')).toBe(false)
    controls.registerManual('two', current)
    controls.dispose()
    expect(controls.requestManual('two')).toBe(false)
  })
})
