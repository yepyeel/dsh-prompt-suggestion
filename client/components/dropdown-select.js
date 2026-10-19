import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'

const selectChevron = h('svg', {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  'aria-hidden': true,
}, h('path', {
  d: 'M3.75 6.25 8 10.5l4.25-4.25',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}))

const selectCheck = h('svg', {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  'aria-hidden': true,
}, h('path', {
  d: 'M3.25 8.5 6.5 11.75 12.75 4.75',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}))

/** Custom listbox: the native <select> popup cannot be styled to match the app. */
function DropdownSelect({ value, options, disabled, onChange }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [menuBox, setMenuBox] = useState(null)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const listboxIdRef = useRef(`dsh-pset-listbox-${Math.random().toString(36).slice(2, 9)}`)
  const listboxId = listboxIdRef.current

  const selectedIndex = options.findIndex(option => option.value === value)
  const current = selectedIndex >= 0 ? selectedIndex : 0
  const selected = options[current] ?? null

  const place = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const available = Math.max(160, window.innerWidth - 16)
    const width = Math.min(Math.max(rect.width, 220), Math.min(420, available))
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)
    setMenuBox({ top: rect.bottom + 8, left, width })
  }, [])

  const openMenu = useCallback(() => {
    if (disabled) return
    place()
    setActive(-1)
    setOpen(true)
  }, [disabled, place])

  const closeMenu = useCallback((refocus = false) => {
    setOpen(false)
    setActive(-1)
    if (refocus) triggerRef.current?.focus()
  }, [])

  const choose = useCallback(index => {
    const option = options[index]
    closeMenu(true)
    if (option && option.value !== value) onChange(option.value)
  }, [closeMenu, onChange, options, value])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onViewportChange = () => place()
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open, place])

  useEffect(() => {
    if (!open || active < 0) return
    const node = menuRef.current?.children[active]
    node?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  useEffect(() => {
    if (disabled && open) closeMenu()
  }, [disabled, open, closeMenu])

  const onKeyDown = event => {
    if (disabled) return
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        place()
        setActive(event.key === 'ArrowDown' || event.key === 'ArrowUp' ? current : -1)
        setOpen(true)
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu(true)
      return
    }
    if (event.key === 'Tab') {
      closeMenu()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActive(index => (index < 0 ? current : (index + delta + options.length) % options.length))
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActive(event.key === 'Home' ? 0 : options.length - 1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(active >= 0 ? active : current)
    }
  }

  return h('div', { className: 'dsh-pset-select', ref: rootRef },
    h('button', {
      type: 'button',
      ref: triggerRef,
      className: 'dsh-pset-selectTrigger',
      disabled,
      'aria-haspopup': 'listbox',
      'aria-expanded': open,
      'aria-controls': open ? listboxId : undefined,
      'aria-activedescendant': open && active >= 0 ? `${listboxId}-${active}` : undefined,
      onClick: () => (open ? closeMenu(true) : openMenu()),
      onKeyDown,
    },
    h('span', { className: 'dsh-pset-selectValue' }, selected?.label ?? ''),
    h('span', { className: 'dsh-pset-selectChevron' }, selectChevron),
    ),
    open && menuBox
      ? h('ul', {
        className: 'dsh-pset-selectMenu',
        id: listboxId,
        role: 'listbox',
        ref: menuRef,
        tabIndex: -1,
        style: { top: `${menuBox.top}px`, left: `${menuBox.left}px`, width: `${menuBox.width}px` },
        onKeyDown,
      }, options.map((option, index) => h('li', {
        key: option.value === '' ? '__follow__' : option.value,
        id: `${listboxId}-${index}`,
        role: 'option',
        'aria-selected': option.value === value,
        'data-active': index === active ? 'true' : 'false',
        className: 'dsh-pset-selectOption',
        onMouseEnter: () => setActive(index),
        onMouseDown: event => event.preventDefault(),
        onClick: () => choose(index),
      },
      h('span', { className: 'dsh-pset-selectOptionLabel' }, option.label),
      option.value === value
        ? h('span', { className: 'dsh-pset-selectCheck' }, selectCheck)
        : null,
      )))
      : null,
  )
}

export { DropdownSelect }
