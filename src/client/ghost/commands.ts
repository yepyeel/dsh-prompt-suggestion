import type { CommandContribution, CommandSession, SettingsForm, Translate } from '../dsh/contracts'
import type { SessionPredictionControls } from './session-controls'

interface CommandDeps {
  form: SettingsForm
  controls: SessionPredictionControls
  t: Translate
}

/**
 * Client-only slash commands mirroring the composer toolbar: `/suggest` runs
 * the same manual request as the button, and `/autopredict` selects the
 * session's automatic mode. Neither submits a message.
 */
export function predictionCommands({ form, controls, t }: CommandDeps): CommandContribution[] {
  const available = () => {
    const settings = form.getSnapshot()
    return settings.status === 'ready' && settings.value?.enabled !== false
  }
  return [
    {
      name: 'suggest',
      label: () => t('commandSuggest'),
      description: () => t('commandSuggestDescription'),
      available,
      ui: {
        kind: 'action',
        run: (session: CommandSession) => {
          // Picking the command consumes its slash token in the same event as
          // this call. The controller only starts on an empty draft, so wait
          // one task for the composer store to publish the now-empty input.
          setTimeout(() => {
            controls.requestManual(session.sessionId)
          }, 0)
        },
      },
    },
    {
      name: 'autopredict',
      label: () => t('commandAutopredict'),
      description: () => t('commandAutopredictDescription'),
      available,
      ui: {
        kind: 'popupSelect',
        searchLabels: () => ({
          placeholder: t('commandAutopredictPlaceholder'),
          empty: t('commandAutopredictEmpty'),
          noResults: t('commandAutopredictNoResults'),
        }),
        options: async (session: CommandSession) => {
          const automatic = controls.getAutomatic(session.sessionId)
          return [
            {
              id: 'on',
              label: t('autoOptionOn'),
              detail: t('autoOptionOnDetail'),
              active: automatic,
            },
            {
              id: 'off',
              label: t('autoOptionOff'),
              detail: t('autoOptionOffDetail'),
              active: !automatic,
            },
          ]
        },
        onSelect: async (option, session) => {
          controls.setAutomatic(session.sessionId, option.id === 'on')
        },
      },
    },
  ]
}
