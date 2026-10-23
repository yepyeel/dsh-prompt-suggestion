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

export const MAX_GHOST_LINES = 3
// Fallback width of the trailing "Tab" badge plus the flex gap.
const KEY_RESERVE_PX = 40

/** Lines `text` wraps to at `width`, measured with an invisible probe. */
export function countLines(
  text: string,
  width: number,
  style: Pick<CSSStyleDeclaration, 'font' | 'letterSpacing' | 'lineHeight'>,
  lineHeight: number,
) {
  if (!text || width <= 0) return 1
  const probe = document.createElement('div')
  Object.assign(probe.style, {
    position: 'absolute',
    visibility: 'hidden',
    pointerEvents: 'none',
    left: '-10000px',
    top: '0',
    width: `${width}px`,
    font: style.font,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    whiteSpace: 'normal',
    wordBreak: 'break-word',
  })
  probe.textContent = text
  document.body.appendChild(probe)
  const height = probe.getBoundingClientRect().height
  probe.remove()
  return Math.max(1, Math.min(MAX_GHOST_LINES, Math.round(height / lineHeight)))
}

function px(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Lines that fit the host's scroll cap (`--dsh-composer-text-max-height`). */
function scrollCapLines(placeholder: HTMLElement, top: number, lineHeight: number) {
  const scroll = placeholder.closest<HTMLElement>('[data-input-scroll]')
  if (!scroll) return MAX_GHOST_LINES
  const cap = px(getComputedStyle(scroll).maxHeight)
  if (!cap) return MAX_GHOST_LINES
  return Math.max(1, Math.floor((cap - top) / lineHeight))
}

export function measureComposer(root: HTMLElement, text = ''): GhostBox | null {
  const card = findComposer(root)
  const placeholder = card?.querySelector<HTMLElement>(PLACEHOLDER_SELECTOR)
  if (!placeholder) return null
  const origin = root.getBoundingClientRect()
  const rect = placeholder.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  const style = getComputedStyle(placeholder)
  const lineHeight = Number.parseFloat(style.lineHeight) || 24
  const key = root.querySelector<HTMLElement>('.dsh-ps-keyWrap')?.getBoundingClientRect().width
  const reserve = key ? key + 8 : KEY_RESERVE_PX
  const offset = rect.top - (placeholder.parentElement?.getBoundingClientRect().top ?? rect.top)
  const lines = Math.min(
    countLines(text, rect.width - reserve, style, lineHeight),
    scrollCapLines(placeholder, offset, lineHeight),
  )
  return {
    left: rect.left - origin.left,
    top: rect.top - origin.top,
    width: rect.width,
    font: style.font,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    color: style.color,
    maxLines: lines,
    lineHeightPx: `${lineHeight}px`,
  }
}

/**
 * The ghost is an overlay and cannot push the composer open by itself. While it
 * is visible, raise the editor's min-height so the card (and toolbar) make room
 * for every wrapped line; the original inline value comes back on cleanup.
 */
export function reserveEditorLines(root: HTMLElement) {
  const editor = findComposer(root)?.querySelector<HTMLElement>(EDITOR_SELECTOR)
  if (!editor) return { apply: (_lines: number, _lineHeight: number) => {}, restore: () => {} }
  const original = editor.style.minHeight
  const computed = getComputedStyle(editor)
  const base = px(computed.minHeight)
  const padding = px(computed.paddingTop) + px(computed.paddingBottom)
  return {
    apply(lines: number, lineHeight: number) {
      const needed = Math.ceil(padding + lines * lineHeight)
      const next = needed > base ? `${needed}px` : original
      if (editor.style.minHeight !== next) editor.style.minHeight = next
    },
    restore() {
      editor.style.minHeight = original
    },
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

export function listenComposerKeys(
  root: HTMLElement,
  accept: () => void,
  dismiss: () => void,
  visible: () => boolean = () => true,
) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      !visible() ||
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
