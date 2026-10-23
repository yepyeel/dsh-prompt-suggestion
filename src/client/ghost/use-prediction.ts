import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { api } from '../api'
import type { GhostProps } from '../dsh/contracts'
import { PredictionController } from './controller'
import type { PredictionCache } from './prediction-cache'
import type { SessionPredictionControls } from './session-controls'

export interface PredictionOptions {
  enabled?: boolean
  automatic?: boolean
  controls?: SessionPredictionControls
  cache?: PredictionCache
}

export function usePrediction(
  { useInput, useSession, sessionId }: GhostProps,
  { enabled = true, automatic = true, controls, cache }: PredictionOptions = {},
) {
  const input = useInput((snapshot) => snapshot)
  const running = useSession((snapshot) => snapshot?.running === true)
  const blank = Boolean(input) && !input?.draft?.trim() && !input?.attachmentIds?.length
  const [controller] = useState(
    () => new PredictionController(api.suggest, { cache, checkTurn: api.turn }),
  )
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useLayoutEffect(() => {
    controller.update({ sessionId, running, blank, enabled, automatic })
  }, [controller, sessionId, running, blank, enabled, automatic])
  useLayoutEffect(() => {
    if (!sessionId) return
    return controls?.registerManual(sessionId, controller.requestManual)
  }, [controls, controller, sessionId])
  useLayoutEffect(() => () => controller.dispose(), [controller])
  return { state, controller }
}
