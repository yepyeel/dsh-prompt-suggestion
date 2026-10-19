import * as React from 'react'
import { useCallback, useRef } from 'react'
import type { GhostProps } from '../dsh/contracts'
import { GHOST_CSS } from '../styles/ghost'
import { useComposer } from './use-composer'
import { usePrediction } from './use-prediction'

export function PromptGhost(props: GhostProps) {
  const root = useRef<HTMLDivElement>(null)
  const { state, controller } = usePrediction(props)
  const accept = useCallback(() => {
    controller.accept((text) => {
      const span = props.inputActions.captureInsertion()
      return props.inputActions.insertText(text, span)
    })
  }, [controller, props.inputActions])
  const shown = state.kind === 'shown'
  const box = useComposer(root, shown, props.sessionId, controller, accept)
  return (
    <div ref={root} className="dsh-ps-root">
      <style>{GHOST_CSS}</style>
      {state.kind === 'shown' && box && (
        <div
          className="dsh-ps-ghost"
          aria-hidden="true"
          style={{
            left: `${box.left}px`,
            top: `${box.top}px`,
            width: `${box.width}px`,
            font: box.font,
            lineHeight: box.lineHeight,
            letterSpacing: box.letterSpacing,
            color: box.color,
          }}
        >
          <span
            className="dsh-ps-text"
            style={{
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: box.maxLines,
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              overflow: 'hidden',
            }}
          >
            {state.text}
          </span>
          <span className="dsh-ps-keyWrap" style={{ height: box.lineHeightPx }}>
            <span className="dsh-ps-key">Tab</span>
          </span>
        </div>
      )}
    </div>
  )
}
