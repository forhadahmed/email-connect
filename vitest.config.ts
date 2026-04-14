import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@email-connect/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@email-connect/core/server': fileURLToPath(new URL('./packages/core/src/server/index.ts', import.meta.url)),
      '@email-connect/gmail': fileURLToPath(new URL('./packages/gmail/src/index.ts', import.meta.url)),
      '@email-connect/graph': fileURLToPath(new URL('./packages/graph/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
