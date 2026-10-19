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
} from '../dsh/composer'
import type { PredictionController } from './controller'

export function useComposer(
  root: RefObject<HTMLDivElement>,
  shown: boolean,
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
    if (!shown || !node || !sessionId) {
      setBox(null)
      return
    }
    const update = () => {
      const measured = measureComposer(node)
      if (!measured) {
        controller.dismiss()
        return
      }
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
      unlisten()
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [root, shown, sessionId, controller, accept])
  return box
}
