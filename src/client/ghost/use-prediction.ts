import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { api } from '../api'
import type { GhostProps } from '../dsh/contracts'
import { PredictionController } from './controller'

export function usePrediction({ useInput, useSession, sessionId }: GhostProps) {
  const input = useInput((snapshot) => snapshot)
  const running = useSession((snapshot) => snapshot?.running === true)
  const blank = Boolean(input) && !input?.draft?.trim() && !input?.attachmentIds?.length
  const [controller] = useState(() => new PredictionController(api.suggest))
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useLayoutEffect(() => {
    controller.update({ sessionId, running, blank })
  }, [controller, sessionId, running, blank])
  useLayoutEffect(() => () => controller.dispose(), [controller])
  return { state, controller }
}
