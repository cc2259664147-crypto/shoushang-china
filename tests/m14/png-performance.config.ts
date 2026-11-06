import { defineConfig } from '@playwright/test';
import baseline from './performance.config';
export default defineConfig({ ...baseline, testMatch: 'png-performance.spec.ts', timeout: 240000 });
