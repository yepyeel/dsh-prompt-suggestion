import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Settings } from '../../shared/contracts'
import {
  DEFAULT_CONTEXT_MESSAGES,
  DEFAULT_PROMPT,
  MAX_CONTEXT_MESSAGES,
  MIN_CONTEXT_MESSAGES,
} from '../../shared/defaults'
import { api } from '../api'
import type { SettingsForm, Translate } from '../dsh/contracts'

interface Draft {
  systemPrompt: string
  provider: string
  model: string
  maxContextMessages: string
}
interface Notice {
  kind: 'ok' | 'error'
  text: string
}

function asDraft(value: Partial<Settings>): Draft {
  return {
    systemPrompt: value.systemPrompt ?? DEFAULT_PROMPT,
    provider: value.provider ?? '',
    model: value.model ?? '',
    maxContextMessages: String(value.maxContextMessages ?? DEFAULT_CONTEXT_MESSAGES),
  }
}

export function useSettings(form: SettingsForm, t: Translate) {
  const snapshot = useSyncExternalStore(
    (listener) => form.subscribe(listener),
    () => form.getSnapshot(),
  )
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const ready = snapshot.status === 'ready' && snapshot.value !== undefined
  const saved = useMemo(
    () => (ready && snapshot.value ? asDraft(snapshot.value) : null),
    [ready, snapshot.value],
  )
  const dirty = Boolean(
    draft &&
      saved &&
      Object.keys(draft).some((key) => draft[key as keyof Draft] !== saved[key as keyof Draft]),
  )
  useEffect(() => {
    if (saved && (!draft || !dirty)) setDraft(saved)
  }, [saved, draft, dirty])
  const contextNumber = Number(draft?.maxContextMessages)
  const contextValid =
    Number.isInteger(contextNumber) &&
    contextNumber >= MIN_CONTEXT_MESSAGES &&
    contextNumber <= MAX_CONTEXT_MESSAGES
  const disabled = snapshot.writable === false || busy

  const save = async () => {
    if (!draft || !saved || !dirty || !contextValid || disabled) return
    setBusy(true)
    setNotice(null)
    try {
      const values = {
        systemPrompt: draft.systemPrompt,
        provider: draft.provider.trim(),
        model: draft.model.trim(),
        maxContextMessages: contextNumber,
      }
      let ok = true
      for (const key of ['systemPrompt', 'provider', 'model', 'maxContextMessages'] as const) {
        if (String(values[key]) !== saved[key]) {
          ok = await form.set(key, values[key])
          if (!ok) break
        }
      }
      if (ok) setDraft(asDraft(values))
      setNotice({ kind: ok ? 'ok' : 'error', text: t(ok ? 'saved' : 'saveFailed') })
    } catch {
      setNotice({ kind: 'error', text: t('saveFailed') })
    } finally {
      setBusy(false)
    }
  }

  const resetPrompt = async () => {
    if (disabled) return
    setBusy(true)
    try {
      const ok = await form.unset('systemPrompt')
      if (ok)
        setDraft(
          (current) =>
            current && {
              ...current,
              systemPrompt: form.getSnapshot().base?.systemPrompt ?? DEFAULT_PROMPT,
            },
        )
      setNotice({ kind: ok ? 'ok' : 'error', text: t(ok ? 'resetDone' : 'saveFailed') })
    } catch {
      setNotice({ kind: 'error', text: t('saveFailed') })
    } finally {
      setBusy(false)
    }
  }

  const toggleEnabled = async () => {
    if (disabled) return
    setBusy(true)
    try {
      const ok = await form.set('enabled', snapshot.value?.enabled === false)
      setNotice(ok ? null : { kind: 'error', text: t('saveFailed') })
    } catch {
      setNotice({ kind: 'error', text: t('saveFailed') })
    } finally {
      setBusy(false)
    }
  }

  return {
    snapshot,
    draft,
    setDraft,
    saved,
    dirty,
    busy,
    disabled,
    notice,
    contextValid,
    save,
    resetPrompt,
    toggleEnabled,
  }
}

export function useModels() {
  const [models, setModels] = useState<Awaited<ReturnType<typeof api.models>> | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void api
      .models(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setModels(value)
      })
      .catch(() => {
        if (!controller.signal.aborted) setModels([])
      })
    return () => controller.abort()
  }, [])
  return models
}
