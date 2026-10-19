import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment' },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    clearMocks: true,
    maxWorkers: 2,
  },
})
