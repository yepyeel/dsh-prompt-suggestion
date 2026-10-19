import { createElement as h } from 'react'
import { LOCALE_NS, SETTINGS_NS } from './constants.js'
import { PromptGhost } from './ghost.js'
import { en, zh } from './locales.js'
import { SettingsPage } from './settings.js'

export const inject = ['slots', 'locale', 'configForms']

export function apply(ctx) {
  const t = ctx.locale.bind(LOCALE_NS)
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'prompt-suggestion: dictionaries')

  const form = ctx.configForms.get(SETTINGS_NS)
  const SettingsEntry = props => h(SettingsPage, { ...props, form, t })

  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay',
    id: 'prompt-ghost',
    order: 4,
  }, PromptGhost))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'prompt-suggestion',
    order: 25,
    label: () => t('title'),
  }, SettingsEntry))
}
