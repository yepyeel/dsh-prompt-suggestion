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

/** The session handle a command contribution receives. */
export interface CommandSession {
  sessionId: string
}

/** One row inside a command's popupSelect; `active` marks the current value. */
export interface CommandOption {
  id: string
  label: string
  detail?: string
  active?: boolean
}

/**
 * Command UI body: a bare action that never submits, or a popup selector over
 * session-derived options. Mirrors `@deepseek-ai/dsh-client-ui-commands`.
 */
export type CommandUiSpec =
  | { kind: 'action'; run(session: CommandSession): void }
  | {
      kind: 'popupSelect'
      searchLabels?: () => { placeholder: string; empty: string; noResults: string }
      options(session: CommandSession): Promise<readonly CommandOption[]>
      onSelect(option: CommandOption, session: CommandSession): Promise<void>
    }

/** A client-only slash command; it never becomes a model message. */
export interface CommandContribution {
  name: string
  label?: () => string
  description?: () => string
  icon?: unknown
  available(session: CommandSession): boolean
  ui: CommandUiSpec
}

export interface CommandUi {
  register(contribution: CommandContribution): unknown
}

/** Scoped context handed to `ctx.inject` once its services are available. */
export interface ClientScope {
  get(name: string): unknown
  effect(factory: () => unknown, label: string): unknown
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
  /** Optional so the plugin still mounts where the command surface is absent. */
  inject?<T>(deps: string[], callback: (scope: ClientScope) => T): unknown
}
