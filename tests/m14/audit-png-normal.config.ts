import { defineConfig } from '@playwright/test';
import baseline from './png-normal.config';
export default defineConfig({ ...baseline, testMatch: 'audit-png-normal.spec.ts' });
