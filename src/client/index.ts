import { createElement as h } from 'react'
import { LOCALE_NS, SETTINGS_NS } from '../shared/defaults'
import type { ClientContext, CommandUi, GhostProps } from './dsh/contracts'
import { installSettingsNavIcon } from './dsh/nav-icon'
import { predictionCommands } from './ghost/commands'
import { ConfiguredPromptGhost } from './ghost/prompt-ghost'
import { createSessionControls } from './ghost/session-controls'
import { en, zh } from './locales'
import { SettingsPage } from './settings/settings-page'

export const inject = ['slots', 'locale', 'configForms']

export function apply(ctx: ClientContext) {
  const t = ctx.locale.bind(LOCALE_NS)
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'prompt-suggestion: dictionaries')
  ctx.effect(
    () => installSettingsNavIcon(() => [zh.title, en.title]),
    'prompt-suggestion: settings nav icon',
  )
  const form = ctx.configForms.get(SETTINGS_NS)
  const controls = createSessionControls()
  ctx.effect(() => () => controls.dispose(), 'prompt-suggestion: session controls')
  const SettingsEntry = () => h(SettingsPage, { form, t })
  const GhostEntry = (props: GhostProps) => h(ConfiguredPromptGhost, { ...props, form, controls })
  ctx.slots.inject('conversation.input.overlay', () =>
    ctx.slots.register(
      { name: 'conversation.input.overlay', id: 'prompt-ghost', order: 4 },
      GhostEntry,
    ),
  )
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: 'prompt-suggestion', order: 25, label: () => t('title') },
      SettingsEntry,
    ),
  )
  const commands = predictionCommands({ form, controls, t })
  ctx.inject?.(['commandUi'], (scope) => {
    const commandUi = scope.get('commandUi') as CommandUi | undefined
    if (!commandUi) return
    for (const command of commands) {
      scope.effect(() => commandUi.register(command), `prompt-suggestion: /${command.name} command`)
    }
  })
}
