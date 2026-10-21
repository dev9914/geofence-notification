import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // The geolocation hook and the pages need a DOM.
    environment: 'jsdom',
    // Tests import `describe`/`it`/`expect` from 'vitest' explicitly, so no globals are
    // injected into the source tree.
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
