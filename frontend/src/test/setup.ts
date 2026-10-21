import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// `globals` is disabled in `vite.config.ts`, so React Testing Library's automatic cleanup
// (which relies on a global `afterEach`) does not run on its own. Registering it here keeps
// component tests isolated from each other.
afterEach(() => {
  cleanup()
})
