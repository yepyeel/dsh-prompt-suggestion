/**
 * Client half of the prompt-suggestion bundle.
 *
 * Two contributions:
 *  - a gray ghost prediction inside the resident composer, accepted with
 *    Tab / ArrowRight through `inputActions.insertText` (never sends);
 *  - a settings page carrying the switch, prompt, model, and context size.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-prompt-suggestion',
  factory(require) {
    const React = require('react')
    const { useCallback, useEffect, useRef, useState } = React
    const h = React.createElement

    const ENDPOINT = 'prompt-suggestion/suggest'
    const MODELS_ENDPOINT = 'prompt-suggestion/models'
    const DEBOUNCE_MS = 250
    const REQUEST_TIMEOUT_MS = 8_000
    const PLACEHOLDER_SELECTOR = '[data-composer-placeholder]'
    const EDITOR_SELECTOR = '[contenteditable="true"]'
    const SETTINGS_NS = 'prompt-suggestion'
    const LOCALE_NS = 'settings.promptSuggestion'
    const FALLBACK_PROMPT = '你是一个输入预测器。根据对话记录，预测用户接下来最可能输入的一条消息。只输出这条消息本身。'

    const zh = {
      title: '输入预测',
      description: '每轮回复结束后，在输入框里以灰色文本提示你的下一句话。按 Tab 或 → 填入，不会自动发送。',
      enabled: '启用输入预测',
      enabledHint: '关闭后不再请求预测，输入框不会出现提示。',
      model: '预测模型',
      modelHint: '留空则跟随当前会话使用的模型；也可以固定一个更便宜、更快的模型。',
      followSession: '跟随当前会话（默认）',
      provider: 'Provider',
      modelId: 'Model',
      context: '上下文消息条数',
      contextHint: '送给模型的历史消息条数，2–64。越大越准，也越贵。',
      invalidContext: '请输入 2–64 的整数。',
      prompt: '系统提示词',
      promptHint: '决定预测的语气、长度和方向。保存后从下一个回合开始生效。',
      resetPrompt: '恢复默认',
      resetDone: '已恢复默认提示词。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存。',
      saveFailed: '保存失败，请检查后重试。',
      discard: '放弃修改',
      readOnly: '当前部署的设置为只读。',
      unavailable: '该插件当前未加载，无法配置。',
      loading: '正在读取设置…',
    }

    const en = {
      title: 'Prompt suggestion',
      description: 'After each reply, a gray prediction appears in the composer. Press Tab or → to use it; it never sends.',
      enabled: 'Enable predictions',
      enabledHint: 'Off: no prediction is requested and nothing appears in the composer.',
      model: 'Prediction model',
      modelHint: 'Leave empty to follow the model of the current session, or pin a cheaper and faster one.',
      followSession: 'Follow the current session (default)',
      provider: 'Provider',
      modelId: 'Model',
      context: 'Context messages',
      contextHint: 'How many recent messages reach the model, 2–64. More is more accurate and more expensive.',
      invalidContext: 'Enter an integer from 2 to 64.',
      prompt: 'System prompt',
      promptHint: 'Sets the tone, length, and direction of the prediction. Applies from the next turn.',
      resetPrompt: 'Reset to default',
      resetDone: 'Default prompt restored.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved.',
      saveFailed: 'The deployment refused these values. They were kept for you to correct.',
      discard: 'Discard',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      loading: 'Reading settings…',
    }

    const GHOST_CSS = `
      .dsh-ps-root {
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: 0;
        pointer-events: none;
        z-index: 6;
      }
      .dsh-ps-ghost {
        position: absolute;
        display: flex;
        align-items: flex-start;
        gap: 8px;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        pointer-events: none;
      }
      .dsh-ps-text {
        min-width: 0;
        overflow: hidden;
        opacity: .9;
      }
      .dsh-ps-keyWrap {
        flex: none;
        display: flex;
        align-items: center;
      }
      .dsh-ps-key {
        display: inline-block;
        font-family: var(--ds-font-family-code);
        font-size: 10px;
        line-height: 14px;
        padding: 0 4px;
        border: 1px solid currentColor;
        border-radius: 4px;
        opacity: .45;
      }
    `

    const SETTINGS_CSS = `
      .dsh-pset-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-width: 720px;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-pset-header {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .dsh-pset-title {
        margin: 0;
        font-size: 16px;
        font-weight: 500;
        line-height: 24px;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-pset-intro {
        margin: 0;
        font-size: 14px;
        line-height: 22px;
        color: var(--dsw-alias-label-tertiary);
      }
      .dsh-pset-note {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--dsw-alias-label-tertiary);
      }
      .dsh-pset-form {
        display: flex;
        flex-direction: column;
        margin-top: 4px;
      }
      .dsh-pset-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 12px 0;
      }
      .dsh-pset-field + .dsh-pset-field {
        border-top: .5px solid var(--dsw-alias-border-l2);
      }
      .dsh-pset-fieldRow {
        flex-direction: row;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
      }
      .dsh-pset-rowText {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
      }
      .dsh-pset-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .dsh-pset-label {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        font-weight: 500;
        line-height: 1.5;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-pset-hint {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--dsw-alias-label-tertiary);
      }
      .dsh-pset-input,
      .dsh-pset-select {
        box-sizing: border-box;
        height: 34px;
        padding: 0 12px;
        border: .5px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-l2));
        border-radius: var(--dsw-radius-md);
        background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2));
        font: inherit;
        font-size: 13px;
        line-height: 1.5;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-pset-input:focus-visible,
      .dsh-pset-select:focus-visible {
        outline: none;
        border-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary));
      }
      .dsh-pset-input:disabled,
      .dsh-pset-select:disabled {
        color: var(--dsw-alias-label-tertiary);
        cursor: default;
      }
      .dsh-pset-input::placeholder {
        color: var(--dsw-alias-label-dimmed, var(--dsw-alias-label-tertiary));
      }
      .dsh-pset-select {
        appearance: none;
        max-width: 320px;
        padding-right: 32px;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
        background-position: right 12px center;
        background-repeat: no-repeat;
        background-size: 12px 12px;
        cursor: pointer;
      }
      .dsh-pset-number {
        max-width: 120px;
      }
      .dsh-pset-textarea {
        box-sizing: border-box;
        width: 100%;
        min-height: 176px;
        padding: 8px 12px;
        border: .5px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-l2));
        border-radius: var(--dsw-radius-md);
        background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2));
        font-family: var(--ds-font-family-code);
        font-size: 12px;
        line-height: 1.65;
        color: var(--dsw-alias-label-primary);
        resize: vertical;
      }
      .dsh-pset-textarea:focus-visible {
        outline: none;
        border-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary));
      }
      .dsh-pset-textarea:disabled {
        opacity: .6;
        cursor: default;
      }
      .dsh-pset-reset {
        border: none;
        background: none;
        padding: 0;
        font: inherit;
        font-size: 12px;
        line-height: 1.5;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      .dsh-pset-reset:hover:not(:disabled) {
        color: var(--dsw-alias-label-primary);
      }
      .dsh-pset-reset:disabled {
        cursor: default;
        opacity: .5;
      }
      .dsh-pset-footer {
        display: flex;
        align-items: center;
        gap: 10px;
        padding-top: 16px;
      }
      .dsh-pset-save {
        appearance: none;
        border: 1px solid transparent;
        border-radius: var(--dsw-radius-md);
        padding: 5px 14px;
        font: inherit;
        font-size: 13px;
        line-height: 1.5;
        cursor: pointer;
        background: var(--dsw-alias-label-primary);
        color: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-base));
      }
      .dsh-pset-save:disabled {
        opacity: .4;
        cursor: default;
      }
      .dsh-pset-status {
        flex: 1;
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--dsw-alias-label-tertiary);
      }
      .dsh-pset-statusError {
        color: var(--dsw-alias-state-error-primary);
      }
      .dsh-pset-switch {
        box-sizing: border-box;
        position: relative;
        flex: 0 0 auto;
        width: 36px;
        height: 20px;
        padding: 2px;
        border: 0;
        border-radius: 999px;
        background: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
        cursor: pointer;
      }
      .dsh-pset-switch[aria-checked="true"] {
        background: var(--dsw-alias-brand-primary);
      }
      .dsh-pset-switch:disabled {
        cursor: default;
        opacity: .5;
      }
      .dsh-pset-switch:focus-visible {
        outline: var(--dsw-focus-ring-width, 1px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)));
        outline-offset: 2px;
      }
      .dsh-pset-thumb {
        display: block;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--dsw-alias-label-primary-foreground, #fff);
        transition: transform .12s ease;
      }
      .dsh-pset-switch[aria-checked="false"] .dsh-pset-thumb {
        background: var(--dsw-alias-switch-thumb, #fff);
      }
      .dsh-pset-switch[aria-checked="true"] .dsh-pset-thumb {
        transform: translate(16px);
      }
    `

    /** Nearest ancestor that owns this composer's placeholder. */
    function findCard(node) {
      let current = node
      while (current && !current.querySelector(PLACEHOLDER_SELECTOR)) {
        current = current.parentElement
      }
      return current
    }

    function isBlank(input) {
      if (!input) return false
      if (typeof input.draft === 'string' && input.draft.trim() !== '') return false
      if (Array.isArray(input.attachmentIds) && input.attachmentIds.length > 0) return false
      return true
    }

    function PromptGhost(props) {
      const { useInput, useSession, inputActions, sessionId } = props
      const input = useInput(snapshot => snapshot)
      const running = useSession(snapshot => snapshot?.running === true)

      const [suggestion, setSuggestion] = useState(null)
      const [shown, setShown] = useState(false)
      const [box, setBox] = useState(null)

      const rootRef = useRef(null)
      const hiddenPlaceholderRef = useRef(null)
      const abortRef = useRef(null)
      const timerRef = useRef(null)
      const dismissedRef = useRef(false)
      const previousRunningRef = useRef(running)
      const latestRef = useRef({ input, running, sessionId })
      latestRef.current = { input, running, sessionId }

      const cancel = useCallback(() => {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        if (abortRef.current) {
          abortRef.current.abort()
          abortRef.current = null
        }
      }, [])

      const hidePlaceholder = useCallback(() => {
        const root = rootRef.current
        const card = root ? findCard(root) : null
        const placeholder = card ? card.querySelector(PLACEHOLDER_SELECTOR) : null
        if (!placeholder) return
        placeholder.style.visibility = 'hidden'
        hiddenPlaceholderRef.current = placeholder
      }, [])

      const restorePlaceholder = useCallback(() => {
        const placeholder = hiddenPlaceholderRef.current
        if (!placeholder) return
        placeholder.style.visibility = ''
        hiddenPlaceholderRef.current = null
      }, [])

      /** Align the ghost with the composer's own placeholder box. */
      const measure = useCallback(() => {
        const root = rootRef.current
        if (!root) return false
        const card = findCard(root)
        if (!card) return false
        const placeholder = card.querySelector(PLACEHOLDER_SELECTOR)
        if (!placeholder) return false
        const rootRect = root.getBoundingClientRect()
        const rect = placeholder.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return false
        const style = getComputedStyle(placeholder)
        const lineHeight = Number.parseFloat(style.lineHeight) || 24
        // The toolbar sits right after the editor scrollport; never paint over it.
        const grow = placeholder.parentElement
        const scroll = grow ? grow.parentElement : null
        const toolbar = scroll ? scroll.nextElementSibling : null
        const limit = toolbar ? toolbar.getBoundingClientRect().top : rect.bottom
        const maxLines = Math.max(1, Math.min(3, Math.floor((limit - rect.top - 2) / lineHeight)))
        setBox({
          left: rect.left - rootRect.left,
          top: rect.top - rootRect.top,
          width: rect.width,
          font: style.font,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          color: style.color,
          maxLines,
          lineHeightPx: `${lineHeight}px`,
        })
        return true
      }, [])

      const hide = useCallback(() => {
        setShown(false)
        setSuggestion(null)
        setBox(null)
        restorePlaceholder()
      }, [restorePlaceholder])

      const isEligible = useCallback(() => {
        const current = latestRef.current
        if (!current.sessionId) return false
        if (current.running) return false
        if (dismissedRef.current) return false
        return isBlank(current.input)
      }, [])

      const accept = useCallback(() => {
        const text = suggestion
        if (!text || !inputActions) {
          hide()
          return
        }
        dismissedRef.current = true
        hide()
        try {
          const span = inputActions.captureInsertion()
          inputActions.insertText(text, span)
        } catch {
          // Revision races are handled by insertText itself; nothing to report.
        }
      }, [hide, inputActions, suggestion])

      const request = useCallback(async (attempt = 0) => {
        if (!isEligible()) return
        const controller = new AbortController()
        abortRef.current = controller
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        try {
          const url = new URL(ENDPOINT, document.baseURI)
          const response = await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: latestRef.current.sessionId }),
            signal: controller.signal,
          })
          if (!response.ok) return
          const data = await response.json()
          if (controller.signal.aborted || !isEligible()) return
          if (data?.reason === 'not-idle' && attempt < 2) {
            // The idle status can beat the turn/end commit by a few milliseconds.
            timerRef.current = setTimeout(() => {
              timerRef.current = null
              void request(attempt + 1)
            }, 500)
            return
          }
          const text = typeof data?.suggestion === 'string' ? data.suggestion.trim() : ''
          if (!text) return
          if (!measure()) return
          setSuggestion(text)
          setShown(true)
        } catch {
          // Abort, timeout, and transport errors all degrade to "no suggestion".
        } finally {
          clearTimeout(timeout)
          if (abortRef.current === controller) abortRef.current = null
        }
      }, [isEligible, measure])

      // A turn ended: wait out the "about to start typing" window, then ask.
      useEffect(() => {
        const was = previousRunningRef.current
        previousRunningRef.current = running
        if (running) {
          dismissedRef.current = false
          cancel()
          hide()
          return
        }
        if (!was) return
        dismissedRef.current = false
        cancel()
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          void request()
        }, DEBOUNCE_MS)
      }, [running, cancel, hide, request])

      // Any draft content cancels the pending request and clears the ghost.
      useEffect(() => {
        if (isBlank(input)) return
        cancel()
        hide()
      }, [input?.draft, input?.attachmentIds?.length, cancel, hide])

      // Keep the ghost aligned while the composer or the window resizes.
      useEffect(() => {
        if (!shown) return undefined
        hidePlaceholder()
        const update = () => {
          if (!measure()) {
            hide()
            return
          }
          hidePlaceholder()
        }
        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, true)
        return () => {
          window.removeEventListener('resize', update)
          window.removeEventListener('scroll', update, true)
          restorePlaceholder()
        }
      }, [shown, measure, hide, hidePlaceholder, restorePlaceholder])

      // Tab / ArrowRight accept, Escape dismisses, typing gets out of the way.
      useEffect(() => {
        if (!shown) return undefined
        const onKeyDown = event => {
          if (event.isComposing || event.keyCode === 229) return
          if (event.metaKey || event.ctrlKey || event.altKey) return
          const root = rootRef.current
          const card = root ? findCard(root) : null
          if (!card) return
          const editor = card.querySelector(EDITOR_SELECTOR)
          const active = document.activeElement
          if (!editor || !active || !(active === editor || editor.contains(active))) return

          if ((event.key === 'Tab' || event.key === 'ArrowRight') && !event.shiftKey) {
            event.preventDefault()
            event.stopPropagation()
            accept()
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            dismissedRef.current = true
            hide()
            return
          }
          if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter') {
            hide()
          }
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => window.removeEventListener('keydown', onKeyDown, true)
      }, [shown, accept, hide])

      // An IME composition replaces the draft before the published state does.
      useEffect(() => {
        if (!shown) return undefined
        const root = rootRef.current
        const card = root ? findCard(root) : null
        if (!card) return undefined
        const onComposition = () => hide()
        card.addEventListener('compositionstart', onComposition, true)
        return () => card.removeEventListener('compositionstart', onComposition, true)
      }, [shown, hide])

      useEffect(() => () => {
        cancel()
        restorePlaceholder()
      }, [cancel, restorePlaceholder])

      return h(
        'div',
        { ref: rootRef, className: 'dsh-ps-root' },
        h('style', null, GHOST_CSS),
        shown && suggestion && box
          ? h(
            'div',
            {
              className: 'dsh-ps-ghost',
              'aria-hidden': true,
              style: {
                left: `${box.left}px`,
                top: `${box.top}px`,
                width: `${box.width}px`,
                font: box.font,
                lineHeight: box.lineHeight,
                letterSpacing: box.letterSpacing,
                color: box.color,
              },
            },
            h('span', {
              className: 'dsh-ps-text',
              style: {
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: box.maxLines,
                whiteSpace: 'normal',
                wordBreak: 'break-word',
                overflow: 'hidden',
              },
            }, suggestion),
            h('span', {
              className: 'dsh-ps-keyWrap',
              style: { height: box.lineHeightPx },
            }, h('span', { className: 'dsh-ps-key' }, 'Tab')),
          )
          : null,
      )
    }

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
        modelField = h('select', {
          className: 'dsh-pset-select',
          value: modelValue,
          disabled,
          onChange: event => {
            const raw = event.target.value
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
        },
        h('option', { value: '' }, t('followSession')),
        known || modelValue === ''
          ? null
          : h('option', { value: modelValue }, `${draft.provider} / ${draft.model}`),
        models.map(item => h('option', {
          key: `${item.provider}\u0000${item.id}`,
          value: `${item.provider}\u0000${item.id}`,
        }, `${item.provider} / ${item.name ?? item.id}`)),
        )
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

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
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
      },
    }
  },
})
