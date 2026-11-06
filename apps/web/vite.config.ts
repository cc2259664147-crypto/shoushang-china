import { defineConfig } from 'vite';
export default defineConfig(() => {
  const target = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3001';
  const proxy = { '/api': target, '/health': target, '/ready': target };
  return { server: { proxy }, preview: { proxy } };
});
