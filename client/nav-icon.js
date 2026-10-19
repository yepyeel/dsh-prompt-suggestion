/**
 * Settings-nav glyph for the prompt-suggestion section.
 *
 * The settings shell in DSH 0.2.x picks a nav glyph from a hard-coded map keyed
 * by section id and falls back to the generic gear for ids it does not know, so
 * `settings.section` has no icon option yet. This module swaps that one glyph
 * for the prediction sparkle.
 *
 * The patch is deliberately defensive: it only touches the nav row whose label
 * matches our section, leaves every other row alone, and does nothing when the
 * shell markup changes, so an unknown future shell keeps the generic gear
 * instead of breaking the settings page.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'
const NAV_LIST = '[class*="_navList"]'
const NAV_LABEL = '[class*="_navLabel"]'
const NAV_ICON = '[class*="_navIcon"]'
const PATCHED = 'sparkle'

/** The three four-point stars of DSH's sparkle glyph, on a 16px grid. */
const SPARKLE_PATHS = [
  'M5.875 3C5.875 6.33333 7.54167 8 10.875 8C7.54167 8 5.875 9.66667 5.875 13C5.875 9.66667 4.20833 8 0.875 8C4.20833 8 5.875 6.33333 5.875 3Z',
  'M12.375 1.55823C12.375 3.39156 13.2917 4.30823 15.125 4.30823C13.2917 4.30823 12.375 5.22489 12.375 7.05823C12.375 5.22489 11.4583 4.30823 9.625 4.30823C11.4583 4.30823 12.375 3.39156 12.375 1.55823Z',
  'M12.375 10.4418C12.375 11.7751 13.0417 12.4418 14.375 12.4418C13.0417 12.4418 12.375 13.1084 12.375 14.4418C12.375 13.1084 11.7083 12.4418 10.375 12.4418C11.7083 12.4418 12.375 11.7751 12.375 10.4418Z',
]

function createSparkle(className) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('xmlns', SVG_NS)
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  // Same glyph metrics as the shell's medium nav icons.
  svg.setAttribute('stroke-width', '1.3')
  if (className) svg.setAttribute('class', className)
  svg.dataset.psNavIcon = PATCHED
  for (const d of SPARKLE_PATHS) {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    path.setAttribute('stroke', 'currentColor')
    svg.append(path)
  }
  return svg
}

/**
 * Replace the shell-rendered glyph of the matching nav row, if it is present.
 * @param {readonly string[]} labels - Current and alternate labels of our section.
 * @returns {boolean} Whether a glyph was replaced on this pass.
 */
export function syncSettingsNavIcon(labels) {
  if (typeof document === 'undefined') return false
  const list = document.querySelector(NAV_LIST)
  if (!list) return false
  const wanted = new Set(labels)
  let patched = false
  for (const button of list.querySelectorAll('button')) {
    const label = button.querySelector(NAV_LABEL)?.textContent?.trim()
    if (!label || !wanted.has(label)) continue
    const icon = button.querySelector(`svg${NAV_ICON}`)
    if (!icon || icon.dataset.psNavIcon === PATCHED) continue
    icon.replaceWith(createSparkle(icon.getAttribute('class')))
    patched = true
  }
  return patched
}

/**
 * Keep the nav glyph patched while the settings panel is mounted.
 * @param {() => readonly string[]} getLabels - Resolves the labels to match.
 * @returns {() => void} Disposer that stops observing.
 */
export function installSettingsNavIcon(getLabels) {
  if (typeof document === 'undefined' || !document.body) return () => {}
  let frame = 0
  const run = () => {
    frame = 0
    syncSettingsNavIcon(getLabels())
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(run)
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  schedule()
  return () => {
    observer.disconnect()
    if (frame) cancelAnimationFrame(frame)
  }
}
