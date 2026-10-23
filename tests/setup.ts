/**
 * Node 22.4+ ships an experimental Web Storage global that resolves to
 * `undefined` unless the process was started with `--localstorage-file`.
 * Vitest's jsdom environment uses `globalThis` as `window`, so that accessor
 * shadows the real jsdom `localStorage` and browser code fails with
 * "Cannot read properties of undefined (reading 'clear')".
 *
 * Install an in-memory Storage only when the environment did not provide a
 * usable one, so jsdom's own implementation stays in place everywhere else.
 */
function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key: string) {
      return values.get(key) ?? null
    },
    key(index: number) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key: string) {
      values.delete(key)
    },
    setItem(key: string, value: string) {
      values.set(String(key), String(value))
    },
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    enumerable: true,
    writable: false,
    value: createMemoryStorage(),
  })
}
