import * as React from 'react'
import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { GhostProps, SettingsForm } from '../dsh/contracts'
import { GHOST_CSS } from '../styles/ghost'
import type { PredictionCache } from './prediction-cache'
import type { SessionPredictionControls } from './session-controls'
import { useComposer } from './use-composer'
import type { PredictionOptions } from './use-prediction'
import { usePrediction } from './use-prediction'

export function ConfiguredPromptGhost({
  form,
  controls,
  cache,
  ...props
}: GhostProps & {
  form: SettingsForm
  controls: SessionPredictionControls
  cache?: PredictionCache
}) {
  const snapshot = useSyncExternalStore(
    (listener) => form.subscribe(listener),
    () => form.getSnapshot(),
  )
  const enabled = snapshot.status === 'ready' && snapshot.value?.enabled !== false
  const automatic = useSyncExternalStore(controls.subscribe, () =>
    controls.getAutomatic(props.sessionId),
  )
  return (
    <PromptGhost
      {...props}
      enabled={enabled}
      automatic={automatic}
      controls={controls}
      cache={cache}
    />
  )
}

export function PromptGhost(props: GhostProps & PredictionOptions) {
  const root = useRef<HTMLDivElement>(null)
  const { state, controller } = usePrediction(props, props)
  const accept = useCallback(() => {
    controller.accept((text) => {
      const span = props.inputActions.captureInsertion()
      return props.inputActions.insertText(text, span)
    })
  }, [controller, props.inputActions])
  const text = state.kind === 'shown' ? state.text : undefined
  const box = useComposer(root, text, props.sessionId, controller, accept)
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
