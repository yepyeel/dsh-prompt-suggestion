import * as React from 'react'
import { MAX_CONTEXT_MESSAGES, MIN_CONTEXT_MESSAGES } from '../../shared/defaults'
import { DropdownSelect } from '../components/dropdown-select'
import type { SettingsForm, Translate } from '../dsh/contracts'
import { SETTINGS_CSS } from '../styles/settings'
import { useModels, useSettings } from './use-settings'

export function SettingsPage({ form, t }: { form: SettingsForm; t: Translate }) {
  const state = useSettings(form, t)
  const models = useModels()
  const { snapshot, draft, saved, dirty, disabled, busy, notice, contextValid } = state
  const header = (
    <header className="dsh-pset-header">
      <h2 className="dsh-pset-title">{t('title')}</h2>
      <p className="dsh-pset-intro">{t('description')}</p>
    </header>
  )
  if (!draft || !saved || snapshot.status !== 'ready')
    return (
      <section className="dsh-pset-section">
        <style>{SETTINGS_CSS}</style>
        {header}
        <p className="dsh-pset-note">
          {t(snapshot.status === 'unavailable' ? 'unavailable' : 'loading')}
        </p>
      </section>
    )

  const setField = (key: keyof typeof draft, value: string) =>
    state.setDraft((current) => current && { ...current, [key]: value })
  const modelValue = draft.provider && draft.model ? `${draft.provider}\u0000${draft.model}` : ''
  const options = [{ value: '', label: t('followSession') }]
  if (
    modelValue &&
    !models?.some((item) => item.provider === draft.provider && item.id === draft.model)
  )
    options.push({ value: modelValue, label: `${draft.provider} / ${draft.model}` })
  for (const item of models ?? [])
    options.push({
      value: `${item.provider}\u0000${item.id}`,
      label: `${item.provider} / ${item.name}`,
    })
  return (
    <section className="dsh-pset-section">
      <style>{SETTINGS_CSS}</style>
      {header}
      <div className="dsh-pset-form">
        {snapshot.writable === false && (
          <p className="dsh-pset-note" role="status">
            {t('readOnly')}
          </p>
        )}
        <div className="dsh-pset-field dsh-pset-fieldRow">
          <div className="dsh-pset-rowText">
            <div className="dsh-pset-label" id="ps-enabled-label">
              {t('enabled')}
            </div>
            <p className="dsh-pset-hint">{t('enabledHint')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-labelledby="ps-enabled-label"
            aria-checked={snapshot.value?.enabled !== false}
            className="dsh-pset-switch"
            disabled={disabled}
            onClick={state.toggleEnabled}
          >
            <span className="dsh-pset-thumb" />
          </button>
        </div>
        <div className="dsh-pset-field">
          <div className="dsh-pset-label" id="ps-model-label">
            {t('model')}
          </div>
          {models && models.length > 0 ? (
            <DropdownSelect
              value={modelValue}
              options={options}
              disabled={disabled}
              labelledBy="ps-model-label"
              onChange={(raw) => {
                const separator = raw.indexOf('\u0000')
                state.setDraft(
                  (current) =>
                    current && {
                      ...current,
                      provider: raw ? raw.slice(0, separator) : '',
                      model: raw ? raw.slice(separator + 1) : '',
                    },
                )
              }}
            />
          ) : (
            <div className="dsh-pset-rowText">
              <input
                className="dsh-pset-input"
                aria-label={t('provider')}
                placeholder={t('provider')}
                value={draft.provider}
                disabled={disabled}
                spellCheck={false}
                onChange={(event) => setField('provider', event.target.value)}
              />
              <input
                className="dsh-pset-input"
                aria-label={t('modelId')}
                placeholder={t('modelId')}
                value={draft.model}
                disabled={disabled}
                spellCheck={false}
                onChange={(event) => setField('model', event.target.value)}
              />
            </div>
          )}
          <p className="dsh-pset-hint">{t('modelHint')}</p>
        </div>
        <div className="dsh-pset-field">
          <label className="dsh-pset-label" htmlFor="ps-context">
            {t('context')}
          </label>
          <input
            id="ps-context"
            className="dsh-pset-input dsh-pset-number"
            type="number"
            min={MIN_CONTEXT_MESSAGES}
            max={MAX_CONTEXT_MESSAGES}
            step={1}
            value={draft.maxContextMessages}
            disabled={disabled}
            onChange={(event) => setField('maxContextMessages', event.target.value)}
          />
          <p className="dsh-pset-hint">{t(contextValid ? 'contextHint' : 'invalidContext')}</p>
        </div>
        <div className="dsh-pset-field">
          <div className="dsh-pset-head">
            <label className="dsh-pset-label" htmlFor="ps-prompt">
              {t('prompt')}
            </label>
            <button
              type="button"
              className="dsh-pset-reset"
              disabled={disabled}
              onClick={state.resetPrompt}
            >
              {t('resetPrompt')}
            </button>
          </div>
          <textarea
            id="ps-prompt"
            className="dsh-pset-textarea"
            value={draft.systemPrompt}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => setField('systemPrompt', event.target.value)}
          />
          <p className="dsh-pset-hint">{t('promptHint')}</p>
        </div>
        <div className="dsh-pset-footer">
          <p
            className={
              notice?.kind === 'error' ? 'dsh-pset-status dsh-pset-statusError' : 'dsh-pset-status'
            }
            role="status"
          >
            {notice?.text ?? ''}
          </p>
          {dirty && (
            <button
              type="button"
              className="dsh-pset-reset"
              disabled={disabled}
              onClick={() => state.setDraft(saved)}
            >
              {t('discard')}
            </button>
          )}
          <button
            type="button"
            className="dsh-pset-save"
            disabled={!dirty || !contextValid || disabled}
            onClick={state.save}
          >
            {t(busy ? 'saving' : 'save')}
          </button>
        </div>
      </div>
    </section>
  )
}
