import { createElement as h, useEffect, useState } from 'react'
import { DropdownSelect } from './components/dropdown-select.js'
import { FALLBACK_PROMPT, MODELS_ENDPOINT } from './constants.js'
import { SETTINGS_CSS } from './styles/settings.js'

function SettingsPage({ form, t }) {
  const [snapshot, setSnapshot] = useState(() => form.getSnapshot())
  const [draft, setDraft] = useState(null)
  const [models, setModels] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => form.subscribe(() => setSnapshot(form.getSnapshot())), [form])

  useEffect(() => {
    let alive = true
    fetch(new URL(MODELS_ENDPOINT, document.baseURI), { credentials: 'same-origin' })
      .then(response => (response.ok ? response.json() : null))
      .then(data => { if (alive) setModels(Array.isArray(data?.models) ? data.models : []) })
      .catch(() => { if (alive) setModels([]) })
    return () => { alive = false }
  }, [])

  const ready = snapshot.status === 'ready' && snapshot.value !== undefined
  const value = ready ? snapshot.value : null

  useEffect(() => {
    if (!ready || draft !== null) return
    setDraft({
      systemPrompt: typeof value.systemPrompt === 'string' ? value.systemPrompt : '',
      provider: typeof value.provider === 'string' ? value.provider : '',
      model: typeof value.model === 'string' ? value.model : '',
      maxContextMessages: String(value.maxContextMessages ?? 16),
    })
  }, [ready, value, draft])

  const header = h('header', { className: 'dsh-pset-header' },
    h('h2', { className: 'dsh-pset-title' }, t('title')),
    h('p', { className: 'dsh-pset-intro' }, t('description')),
  )

  if (snapshot.status === 'unavailable') {
    return h('section', { className: 'dsh-pset-section' },
      h('style', null, SETTINGS_CSS),
      header,
      h('p', { className: 'dsh-pset-note' }, t('unavailable')))
  }
  if (!ready || draft === null) {
    return h('section', { className: 'dsh-pset-section' },
      h('style', null, SETTINGS_CSS),
      header,
      h('p', { className: 'dsh-pset-note' }, t('loading')))
  }

  const saved = {
    systemPrompt: typeof value.systemPrompt === 'string' ? value.systemPrompt : '',
    provider: typeof value.provider === 'string' ? value.provider : '',
    model: typeof value.model === 'string' ? value.model : '',
    maxContextMessages: String(value.maxContextMessages ?? 16),
  }
  const dirty = draft.systemPrompt !== saved.systemPrompt
    || draft.provider !== saved.provider
    || draft.model !== saved.model
    || draft.maxContextMessages !== saved.maxContextMessages
  const contextNumber = Number(draft.maxContextMessages)
  const contextValid = Number.isInteger(contextNumber) && contextNumber >= 2 && contextNumber <= 64
  const disabled = snapshot.writable === false || busy
  const enabled = value.enabled !== false

  const save = async () => {
    if (!dirty || !contextValid || busy) return
    setBusy(true)
    setNotice(null)
    let ok = true
    if (draft.systemPrompt !== saved.systemPrompt) {
      ok = (await form.set('systemPrompt', draft.systemPrompt)) && ok
    }
    if (ok && draft.provider !== saved.provider) {
      ok = (await form.set('provider', draft.provider.trim())) && ok
    }
    if (ok && draft.model !== saved.model) {
      ok = (await form.set('model', draft.model.trim())) && ok
    }
    if (ok && draft.maxContextMessages !== saved.maxContextMessages) {
      ok = (await form.set('maxContextMessages', contextNumber)) && ok
    }
    setBusy(false)
    setNotice(ok ? { kind: 'ok', text: t('saved') } : { kind: 'error', text: t('saveFailed') })
  }

  const resetPrompt = async () => {
    if (busy) return
    setBusy(true)
    const ok = await form.unset('systemPrompt')
    const base = form.getSnapshot().base?.systemPrompt
    if (ok) {
      setDraft(current => ({
        ...current,
        systemPrompt: typeof base === 'string' ? base : FALLBACK_PROMPT,
      }))
    }
    setBusy(false)
    setNotice(ok ? { kind: 'ok', text: t('resetDone') } : { kind: 'error', text: t('saveFailed') })
  }

  const toggleEnabled = async () => {
    if (disabled) return
    const ok = await form.set('enabled', !enabled)
    setNotice(ok ? null : { kind: 'error', text: t('saveFailed') })
  }

  let modelField
  const modelValue = draft.provider !== '' && draft.model !== ''
    ? `${draft.provider}\u0000${draft.model}`
    : ''
  if (models !== null && models.length > 0) {
    const known = models.some(item => item.provider === draft.provider && item.id === draft.model)
    const modelOptions = [{ value: '', label: t('followSession') }]
    if (modelValue !== '' && !known) {
      modelOptions.push({
        value: modelValue,
        label: `${draft.provider} / ${draft.model}`,
      })
    }
    for (const item of models) {
      modelOptions.push({
        value: `${item.provider}\u0000${item.id}`,
        label: `${item.provider} / ${item.name ?? item.id}`,
      })
    }
    modelField = h(DropdownSelect, {
      value: modelValue,
      options: modelOptions,
      disabled,
      onChange: raw => {
        if (raw === '') {
          setDraft(current => ({ ...current, provider: '', model: '' }))
          return
        }
        const separator = raw.indexOf('\u0000')
        setDraft(current => ({
          ...current,
          provider: raw.slice(0, separator),
          model: raw.slice(separator + 1),
        }))
      },
    })
  } else {
    modelField = h('div', { className: 'dsh-pset-rowText' },
      h('input', {
        className: 'dsh-pset-input',
        placeholder: t('provider'),
        value: draft.provider,
        disabled,
        spellCheck: false,
        onChange: event => setDraft(current => ({ ...current, provider: event.target.value })),
      }),
      h('input', {
        className: 'dsh-pset-input',
        placeholder: t('modelId'),
        value: draft.model,
        disabled,
        spellCheck: false,
        onChange: event => setDraft(current => ({ ...current, model: event.target.value })),
      }),
    )
  }

  return h('section', { className: 'dsh-pset-section' },
    h('style', null, SETTINGS_CSS),
    header,
    h('div', { className: 'dsh-pset-form' },
      snapshot.writable === false
        ? h('p', { className: 'dsh-pset-note', role: 'status' }, t('readOnly'))
        : null,
      h('div', { className: 'dsh-pset-field dsh-pset-fieldRow' },
        h('div', { className: 'dsh-pset-rowText' },
          h('div', { className: 'dsh-pset-label' }, t('enabled')),
          h('p', { className: 'dsh-pset-hint' }, t('enabledHint')),
        ),
        h('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': enabled,
          className: 'dsh-pset-switch',
          disabled,
          onClick: toggleEnabled,
        }, h('span', { className: 'dsh-pset-thumb' })),
      ),
      h('div', { className: 'dsh-pset-field' },
        h('label', { className: 'dsh-pset-label' }, t('model')),
        modelField,
        h('p', { className: 'dsh-pset-hint' }, t('modelHint')),
      ),
      h('div', { className: 'dsh-pset-field' },
        h('label', { className: 'dsh-pset-label' }, t('context')),
        h('input', {
          className: 'dsh-pset-input dsh-pset-number',
          type: 'number',
          min: 2,
          max: 64,
          step: 1,
          value: draft.maxContextMessages,
          disabled,
          onChange: event => setDraft(current => ({ ...current, maxContextMessages: event.target.value })),
        }),
        h('p', { className: 'dsh-pset-hint' }, contextValid ? t('contextHint') : t('invalidContext')),
      ),
      h('div', { className: 'dsh-pset-field' },
        h('div', { className: 'dsh-pset-head' },
          h('label', { className: 'dsh-pset-label' }, t('prompt')),
          h('button', {
            type: 'button',
            className: 'dsh-pset-reset',
            disabled: busy,
            onClick: resetPrompt,
          }, t('resetPrompt')),
        ),
        h('textarea', {
          className: 'dsh-pset-textarea',
          value: draft.systemPrompt,
          disabled,
          spellCheck: false,
          onChange: event => setDraft(current => ({ ...current, systemPrompt: event.target.value })),
        }),
        h('p', { className: 'dsh-pset-hint' }, t('promptHint')),
      ),
      h('div', { className: 'dsh-pset-footer' },
        h('p', {
          className: notice?.kind === 'error'
            ? 'dsh-pset-status dsh-pset-statusError'
            : 'dsh-pset-status',
          role: 'status',
        }, notice?.text ?? ''),
        dirty
          ? h('button', {
            type: 'button',
            className: 'dsh-pset-reset',
            disabled,
            onClick: () => setDraft({ ...saved }),
          }, t('discard'))
          : null,
        h('button', {
          type: 'button',
          className: 'dsh-pset-save',
          disabled: !dirty || !contextValid || disabled,
          onClick: save,
        }, busy ? t('saving') : t('save')),
      ),
    ),
  )
}

export { SettingsPage }
