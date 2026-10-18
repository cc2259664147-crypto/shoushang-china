import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests',timeout:30000,expect:{timeout:5000},use:{baseURL:'http://127.0.0.1:5176',channel:'msedge',headless:true},webServer:{command:'pnpm dev',url:'http://127.0.0.1:5176',reuseExistingServer:true,timeout:30000}});
