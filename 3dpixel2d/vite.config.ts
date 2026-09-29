import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 30000 },
});
