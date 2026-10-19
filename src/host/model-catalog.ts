import type { ModelEntry } from '../shared/contracts'
import type { LLM } from './dsh'

const CACHE_MS = 60_000
const TIMEOUT_MS = 5_000

// Cache and in-flight work belong to one plugin instance, including on reload.
export function createModelCatalog(llm: Pick<LLM, 'listProviders' | 'listModels'>) {
  let cache: { at: number; value: ModelEntry[] } | undefined
  let pending: Promise<ModelEntry[]> | undefined

  async function loadProvider(provider: string): Promise<ModelEntry[]> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const models = await Promise.race([
        llm.listModels(provider),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('model-list-timeout')), TIMEOUT_MS)
        }),
      ])
      return models.map((item) => ({ provider, id: item.id, name: item.name || item.id }))
    } catch {
      return []
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    list(): Promise<ModelEntry[]> {
      if (cache && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.value)
      if (pending) return pending
      pending = Promise.resolve()
        .then(() => llm.listProviders())
        .then((providers) => Promise.all(providers.map((provider) => loadProvider(provider.id))))
        .then((groups) => groups.flat())
        .catch(() => [])
        .then((value) => {
          cache = { at: Date.now(), value }
          return value
        })
        .finally(() => {
          pending = undefined
        })
      return pending
    },
  }
}
