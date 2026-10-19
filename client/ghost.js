import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import {
  DEBOUNCE_MS,
  EDITOR_SELECTOR,
  ENDPOINT,
  PLACEHOLDER_SELECTOR,
  REQUEST_TIMEOUT_MS,
} from './constants.js'
import { GHOST_CSS } from './styles/ghost.js'

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

export { PromptGhost }
