// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { DropdownSelect } from '../../src/client/components/dropdown-select'

afterEach(() => cleanup())

it('handles keys from a focused option once without also advancing its parent listbox', () => {
  const change = vi.fn()
  const view = render(
    <>
      <span id="model-label">Model</span>
      <DropdownSelect
        value="a"
        labelledBy="model-label"
        disabled={false}
        onChange={change}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
          { value: 'c', label: 'C' },
        ]}
      />
    </>,
  )
  const trigger = view.getByRole('combobox')
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  const option = view.getByRole('option', { name: 'A' })
  fireEvent.keyDown(option, { key: 'ArrowDown' })
  expect(view.getByRole('option', { name: 'B' }).getAttribute('data-active')).toBe('true')
  fireEvent.keyDown(option, { key: 'Enter' })
  expect(change).toHaveBeenCalledExactlyOnceWith('b')
})
