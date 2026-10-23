import type { RefObject } from 'react'
import { useLayoutEffect, useState } from 'react'
import type { GhostBox } from '../dsh/composer'
import {
  concealPlaceholder,
  findComposer,
  listenComposerInput,
  listenComposerKeys,
  listenPredictionShortcut,
  measureComposer,
  reserveEditorLines,
} from '../dsh/composer'
import type { PredictionController } from './controller'

export function useComposer(
  root: RefObject<HTMLDivElement>,
  text: string | undefined,
  sessionId: string | undefined,
  controller: PredictionController,
  accept: () => void,
) {
  const [box, setBox] = useState<GhostBox | null>(null)
  useLayoutEffect(() => {
    if (!root.current || !sessionId) return
    const unlistenInput = listenComposerInput(root.current, controller)
    const unlistenShortcut = listenPredictionShortcut(root.current, controller.requestManual)
    return () => {
      unlistenInput()
      unlistenShortcut()
    }
  }, [root, sessionId, controller])

  useLayoutEffect(() => {
    const node = root.current
    if (text === undefined || !node || !sessionId) {
      setBox(null)
      return
    }
    const reservation = reserveEditorLines(node)
    const update = () => {
      const measured = measureComposer(node, text)
      if (!measured) {
        controller.dismiss()
        return
      }
      reservation.apply(measured.maxLines, Number.parseFloat(measured.lineHeightPx))
      setBox(measured)
    }
    update()
    const restore = concealPlaceholder(node)
    const unlisten = listenComposerKeys(node, accept, controller.dismiss)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    const card = findComposer(node)
    if (card) observer?.observe(card)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      restore()
      reservation.restore()
      unlisten()
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [root, text, sessionId, controller, accept])
  return box
}
