import type { KeyboardEvent } from 'react'
import * as React from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

interface Option {
  value: string
  label: string
}
interface Props {
  value: string
  options: Option[]
  disabled: boolean
  onChange(value: string): void
  labelledBy: string
}
const selectChevron = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M3.75 6.25 8 10.5l4.25-4.25"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
const selectCheck = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M3.25 8.5 6.5 11.75 12.75 4.75"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

export function DropdownSelect({ value, options, disabled, onChange, labelledBy }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const selectedIndex = options.findIndex((option) => option.value === value)
  const current = selectedIndex >= 0 ? selectedIndex : 0
  const selected = options[current]
  const place = useCallback(() => {
    if (!trigger.current) return
    const rect = trigger.current.getBoundingClientRect()
    const width = Math.min(
      Math.max(rect.width, 220),
      Math.min(420, Math.max(160, window.innerWidth - 16)),
    )
    setBox({
      top: rect.bottom + 8,
      left: Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8),
      width,
    })
  }, [])
  const close = useCallback((refocus = false) => {
    setOpen(false)
    setActive(-1)
    if (refocus) trigger.current?.focus()
  }, [])
  const choose = (index: number) => {
    const option = options[index]
    close(true)
    if (option && option.value !== value) onChange(option.value)
  }
  useEffect(() => {
    if (!open) return
    const pointer = (event: globalThis.PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('pointerdown', pointer, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('pointerdown', pointer, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, close, place])
  useEffect(() => {
    if (open && active >= 0) menu.current?.children[active]?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active])
  useEffect(() => {
    if (disabled && open) close()
  }, [disabled, open, close])
  const onKeyDown = (event: KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        place()
        setActive(['ArrowDown', 'ArrowUp'].includes(event.key) ? current : -1)
        setOpen(true)
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') close()
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActive((index) =>
        index < 0 ? current : (index + delta + options.length) % options.length,
      )
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActive(event.key === 'Home' ? 0 : options.length - 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(active >= 0 ? active : current)
    }
  }
  return (
    <div className="dsh-pset-select" ref={root}>
      <button
        type="button"
        role="combobox"
        ref={trigger}
        className="dsh-pset-selectTrigger"
        disabled={disabled}
        aria-labelledby={labelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listboxId}-${active}` : undefined}
        onClick={() => {
          if (open) close(true)
          else if (!disabled) {
            place()
            setActive(-1)
            setOpen(true)
          }
        }}
        onKeyDown={onKeyDown}
      >
        <span className="dsh-pset-selectValue">{selected?.label ?? ''}</span>
        <span className="dsh-pset-selectChevron">{selectChevron}</span>
      </button>
      {open && box && (
        <div
          className="dsh-pset-selectMenu"
          id={listboxId}
          role="listbox"
          aria-labelledby={labelledBy}
          ref={menu}
          tabIndex={-1}
          style={{ top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px` }}
          onKeyDown={onKeyDown}
        >
          {options.map((option, index) => (
            <div
              key={option.value || '__follow__'}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              data-active={index === active ? 'true' : 'false'}
              className="dsh-pset-selectOption"
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
              onKeyDown={(event) => {
                onKeyDown(event)
                event.stopPropagation()
              }}
              tabIndex={-1}
            >
              <span className="dsh-pset-selectOptionLabel">{option.label}</span>
              {option.value === value && (
                <span className="dsh-pset-selectCheck">{selectCheck}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
