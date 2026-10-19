export const PLACEHOLDER_SELECTOR = '[data-composer-placeholder]'
export const EDITOR_SELECTOR = '[contenteditable="true"]'

export interface GhostBox {
  left: number
  top: number
  width: number
  font: string
  lineHeight: string
  letterSpacing: string
  color: string
  maxLines: number
  lineHeightPx: string
}

export function findComposer(node: HTMLElement | null): HTMLElement | null {
  let current = node
  while (current && !current.querySelector(PLACEHOLDER_SELECTOR)) current = current.parentElement
  return current
}

export function measureComposer(root: HTMLElement): GhostBox | null {
  const card = findComposer(root)
  const placeholder = card?.querySelector<HTMLElement>(PLACEHOLDER_SELECTOR)
  if (!placeholder) return null
  const origin = root.getBoundingClientRect()
  const rect = placeholder.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  const style = getComputedStyle(placeholder)
  const lineHeight = Number.parseFloat(style.lineHeight) || 24
  const toolbar = placeholder.parentElement?.parentElement?.nextElementSibling
  const limit = toolbar ? toolbar.getBoundingClientRect().top : rect.bottom
  return {
    left: rect.left - origin.left,
    top: rect.top - origin.top,
    width: rect.width,
    font: style.font,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    color: style.color,
    maxLines: Math.max(1, Math.min(3, Math.floor((limit - rect.top - 2) / lineHeight))),
    lineHeightPx: `${lineHeight}px`,
  }
}

export function concealPlaceholder(root: HTMLElement) {
  const placeholder = findComposer(root)?.querySelector<HTMLElement>(PLACEHOLDER_SELECTOR)
  if (!placeholder) return () => {}
  const original = placeholder.style.visibility
  placeholder.style.visibility = 'hidden'
  return () => {
    placeholder.style.visibility = original
  }
}

export function listenComposerKeys(root: HTMLElement, accept: () => void, dismiss: () => void) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return
    const editor = findComposer(root)?.querySelector(EDITOR_SELECTOR)
    const active = document.activeElement
    if (!editor || !active || !(active === editor || editor.contains(active))) return
    if ((event.key === 'Tab' || event.key === 'ArrowRight') && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      accept()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      dismiss()
    } else if (event.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(event.key)) {
      dismiss()
    }
  }
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}

export function listenComposerInput(
  root: HTMLElement,
  activity: { dismiss: () => void; startComposition: () => void; endComposition: () => void },
) {
  const card = findComposer(root)
  // Invalidate pending requests before the input snapshot catches up, including IME.
  card?.addEventListener('compositionstart', activity.startComposition, true)
  card?.addEventListener('compositionend', activity.endComposition, true)
  card?.addEventListener('beforeinput', activity.dismiss, true)
  card?.addEventListener('input', activity.dismiss, true)
  return () => {
    card?.removeEventListener('compositionstart', activity.startComposition, true)
    card?.removeEventListener('compositionend', activity.endComposition, true)
    card?.removeEventListener('beforeinput', activity.dismiss, true)
    card?.removeEventListener('input', activity.dismiss, true)
  }
}

export function listenPredictionShortcut(root: HTMLElement, request: () => boolean) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      event.keyCode === 229 ||
      !event.altKey ||
      !event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      (event.code !== 'KeyP' && event.key.toLowerCase() !== 'p')
    )
      return
    const editor = findComposer(root)?.querySelector(EDITOR_SELECTOR)
    const active = document.activeElement
    if (!editor || !active || !(active === editor || editor.contains(active))) return
    if (!request()) return
    event.preventDefault()
    event.stopPropagation()
  }
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
