import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const mockContent = fileURLToPath(new URL('./mock-content.ts', import.meta.url));
const testProfiles = fileURLToPath(new URL('./m15-7d-profiles.ts', import.meta.url));

export default defineConfig({
  plugins: [{
    name: 'm15-7d-testing-composition',
    enforce: 'pre',
    resolveId(source, importer) {
      const normalized = importer?.replaceAll('\\', '/');
      if (source === './content' && normalized?.endsWith('/src/app/App.tsx')) return mockContent;
      if (source === './editor/profiles' && normalized?.includes('/src/features/workshop/')) return testProfiles;
    },
  }],
});
