// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { syncSettingsNavIcon } from '../../src/client/dsh/nav-icon'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('DSH navigation DOM adapter', () => {
  it('changes only the matching settings glyph and is idempotent', () => {
    document.body.innerHTML =
      '<nav class="_navList_fixture"><button><svg class="_navIcon_fixture"></svg><span class="_navLabel_fixture">Prompt suggestion</span></button><button><svg class="_navIcon_fixture"></svg><span class="_navLabel_fixture">Other</span></button></nav>'
    expect(syncSettingsNavIcon(['Prompt suggestion'])).toBe(true)
    expect(document.querySelectorAll('[data-ps-nav-icon="sparkle"]').length).toBe(1)
    expect(syncSettingsNavIcon(['Prompt suggestion'])).toBe(false)
    expect(document.querySelectorAll('svg').length).toBe(2)
  })
  it('degrades safely when the host markup changes', () => {
    document.body.innerHTML = '<nav><button>Prompt suggestion</button></nav>'
    expect(syncSettingsNavIcon(['Prompt suggestion'])).toBe(false)
  })
})
