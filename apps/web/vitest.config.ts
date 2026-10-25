import { defineConfig } from 'vitest/config';

export default defineConfig({
  // саундфонт гитарного раздела и WASM-ядро высоты импортируются как ?inline (data URI), как и в vite.config.ts
  assetsInclude: ['**/*.wasm', '**/*.sf3'],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
