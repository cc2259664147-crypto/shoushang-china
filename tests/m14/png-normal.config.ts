import { defineConfig } from '@playwright/test';
import baseline from './performance.config';
export default defineConfig({ ...baseline, testMatch: 'acceptance.spec.ts', timeout: 60000 });
