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
  data?: { reason?: { kind: string } }
}

export interface Session {
  seq: number
  eventAt(seq: number): SessionEvent | undefined
  deriveMessages(): readonly Message[]
  requestHeader?(): { config?: Partial<ModelSelection> } | null
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
