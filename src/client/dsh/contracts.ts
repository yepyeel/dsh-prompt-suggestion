import type { ComponentType } from 'react'
import type { Settings } from '../../shared/contracts'
import type { LocaleKey } from '../locales'

export type Translate = (key: LocaleKey) => string
export interface InputSnapshot {
  draft?: string
  attachmentIds?: readonly unknown[]
}
export interface SessionSnapshot {
  running?: boolean
}
export type SnapshotHook<T> = <R>(selector: (snapshot: T | undefined) => R) => R

export interface InputActions {
  captureInsertion(): unknown
  insertText(text: string, span: unknown): boolean
}

export interface GhostProps {
  useInput: SnapshotHook<InputSnapshot>
  useSession: SnapshotHook<SessionSnapshot>
  inputActions: InputActions
  sessionId?: string
}

export interface SettingsSnapshot {
  status: 'ready' | 'loading' | 'unavailable' | 'error'
  value?: Partial<Settings>
  base?: Partial<Settings>
  writable?: boolean
}

export interface SettingsForm {
  getSnapshot(): SettingsSnapshot
  subscribe(listener: () => void): () => void
  set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<boolean>
  unset(key: keyof Settings): Promise<boolean>
}

export interface ClientContext {
  locale: {
    bind(namespace: string): Translate
    register(
      namespace: string,
      dictionaries: { zh: Record<LocaleKey, string>; en: Record<LocaleKey, string> },
    ): unknown
  }
  configForms: { get(namespace: string): SettingsForm }
  slots: {
    inject(slot: string, register: () => unknown): unknown
    register<P>(
      entry: { name: string; id: string; order: number; label?: () => string },
      component: ComponentType<P>,
    ): unknown
  }
  effect(factory: () => unknown, label: string): unknown
}
