import * as React from 'react'
import { useSyncExternalStore } from 'react'
import { findComposer } from '../dsh/composer'
import type { GhostProps, SettingsForm, Translate } from '../dsh/contracts'
import { CONTROLS_CSS } from '../styles/controls'
import type { SessionPredictionControls } from './session-controls'

export function PredictionControls({
  form,
  controls,
  t,
  sessionId,
  useInput,
  useSession,
}: GhostProps & { form: SettingsForm; controls: SessionPredictionControls; t: Translate }) {
  const settings = useSyncExternalStore(
    (listener) => form.subscribe(listener),
    () => form.getSnapshot(),
  )
  const automatic = useSyncExternalStore(controls.subscribe, () => controls.getAutomatic(sessionId))
  const input = useInput((snapshot) => snapshot)
  const running = useSession((snapshot) => snapshot?.running === true)
  const blank = Boolean(input) && !input?.draft?.trim() && !input?.attachmentIds?.length
  if (!sessionId || settings.status !== 'ready' || settings.value?.enabled === false) return null
  return (
    <fieldset className="dsh-ps-controls" aria-label={t('sessionControls')}>
      <style>{CONTROLS_CSS}</style>
      <button
        type="button"
        aria-pressed={automatic}
        title={t(automatic ? 'pauseAutomatic' : 'resumeAutomatic')}
        onClick={() => controls.setAutomatic(sessionId, !automatic)}
      >
        {t(automatic ? 'automaticOn' : 'automaticOff')}
      </button>
      <button
        type="button"
        disabled={running || !blank}
        title={`${t('generateSuggestion')} (Alt+Shift+P)`}
        onClick={(event) => {
          if (controls.requestManual(sessionId)) {
            findComposer(event.currentTarget)
              ?.querySelector<HTMLElement>('[contenteditable="true"]')
              ?.focus()
          }
        }}
      >
        {t('generateSuggestion')}
      </button>
    </fieldset>
  )
}
