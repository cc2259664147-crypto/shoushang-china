import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const mock = fileURLToPath(new URL('./mock-content.ts', import.meta.url));
export default defineConfig({
  plugins: [{ name: 'explicit-legacy-mock-regression', enforce: 'pre', resolveId(source, importer) {
    if (source === './content' && importer?.replaceAll('\\', '/').endsWith('/src/app/App.tsx')) return mock;
  } }],
});
