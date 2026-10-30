import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ModelSelection, Settings } from '../shared/contracts'

// Only the public Host capabilities this plugin actually consumes. Keep SDK
// adaptation here so core rules and tests do not depend on Harness internals.
export interface ContentBlock {
  type: string
  text?: string
  /** `tool-call` blocks: call id, tool name, and JSON-encoded arguments. */
  id?: string
  name?: string
  arguments?: unknown
}

export interface Message {
  role: string
  content?: readonly ContentBlock[]
  /** `tool` messages: the call they answer and whether the tool failed. */
  toolCallId?: string
  isError?: boolean
}

export interface SessionEvent {
  type: string
  /** Log position. Present on committed events; absent means the event cannot identify a turn. */
  seq?: number
  data?: { reason?: { kind: string } }
}

export interface Session {
  deriveMessages(): readonly Message[]
  requestHeader?(): { config?: Partial<ModelSelection> } | null
}

/** Latest completed `turn/end` sequence, or null while the session is not at rest. */
export interface TurnState {
  seq: number | null
}

export interface TurnProjection {
  key: string
  stateVersion: number
  stateSchema: { parse(value: unknown): TurnState }
  init(): TurnState
  apply(state: TurnState, event: SessionEvent): TurnState
}

export interface SessionProjections {
  register(definition: TurnProjection): () => void
  stateOf(session: Session, key: string): TurnState | undefined
}

export interface CompletionRequest extends ModelSelection {
  system: string
  messages: Message[]
  temperature: number
  maxTokens: number
  signal: AbortSignal
}

export interface LLMChunk {
  type: string
  text?: string
  reason?: { kind: string; failure?: { code?: string; message?: string } }
}

export interface LLM {
  stream(request: CompletionRequest): AsyncIterable<LLMChunk>
  listProviders(): readonly { id: string }[]
  listModels(provider: string): Promise<readonly { id: string; name?: string }[]>
}

export interface HostContext {
  sessions: { get(id: string): Session | undefined }
  sessionProjections: SessionProjections
  llm: LLM
  get(name: 'agentDefaultModel'): { currentSelection?(): ModelSelection | null } | undefined
  logger?: { debug(message: string, ...values: unknown[]): void }
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler(req: IncomingMessage, res: ServerResponse): void
    }): () => void
  }
  fiber: unknown
  settings: { configure(options: { auto: boolean }, fiber: unknown): () => void }
  inject(names: string[], apply: (child: HostContext) => void): void
  effect(factory: () => () => void, label?: string): void
}

export type ConfigInput = Partial<Record<keyof Settings, unknown>>
