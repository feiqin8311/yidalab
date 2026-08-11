import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * PGlite-backed model tests (no DATABASE_TEST_URL).
 * Same aliases as vitest.config.server.mts but forces TEST_SERVER_DB=0.
 */
export default defineConfig({
  plugins: [
    {
      name: 'raw-md',
      transform(_, id) {
        if (id.endsWith('.md')) return { code: 'export default ""', map: null };
      },
    },
  ],
  test: {
    alias: {
      '@/const': resolve(__dirname, '../const/src'),
      '@/utils/errorResponse': resolve(__dirname, '../../src/utils/errorResponse'),
      '@/utils': resolve(__dirname, '../utils/src'),
      '@/database': resolve(__dirname, '../database/src'),
      '@/libs/model-runtime': resolve(__dirname, '../model-runtime/src'),
      '@/types': resolve(__dirname, '../types/src'),
      '@/config': resolve(__dirname, '../app-config/src'),
      '@/envs': resolve(__dirname, '../env/src'),
      '@/libs/trpc': resolve(__dirname, '../trpc/src'),
      '@/locales': resolve(__dirname, '../locales/src'),
      '@/business/server': resolve(__dirname, '../business-server/src'),
      '@/server/services': resolve(__dirname, '../../apps/server/src/services'),
      '@/server/modules': resolve(__dirname, '../../apps/server/src/modules'),
      '@': resolve(__dirname, '../../src'),
    },
    env: {
      TEST_SERVER_DB: '0',
    },
    environment: 'node',
    include: ['src/models/__tests__/taskAutomation*.test.ts'],
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    setupFiles: './tests/setup-db.ts',
    testTimeout: 120_000,
  },
});
