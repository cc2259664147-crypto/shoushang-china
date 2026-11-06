import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: { alias: {
    '@shoushang/contracts': resolve('packages/contracts/src/index.ts'),
    '@shoushang/papercut-core': resolve('packages/papercut-core/src/index.ts'),
    '@shoushang/artwork-renderer': resolve('packages/artwork-renderer/src/index.ts'),
  } },
  test: { include: ['tests/m14/template-core.case.ts'], fileParallelism: false, maxWorkers: 1, testTimeout: 90000 },
});
