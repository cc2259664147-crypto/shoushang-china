import { createApp } from './app';
const app = createApp();
try {
  await app.listen({ host: '127.0.0.1', port: 3001 });
  console.log('API: http://127.0.0.1:3001/health (M01, no database initialized)');
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close(); });
}
