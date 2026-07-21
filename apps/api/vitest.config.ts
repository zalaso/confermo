import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    setupFiles: ['./test/setup-env.ts'],
    fileParallelism: false, // i test di integrazione condividono lo stesso DB
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
