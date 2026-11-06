import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, resolveAdminConfig } from './app';
import { assertAdminListener } from './admin';

export async function startServer() {
  const portText = process.env.PORT ?? '3001';
  if (!/^(0|[1-9][0-9]*)$/.test(portText) || Number(portText) > 65535) throw new Error('Invalid PORT');
  let ownedApp: Awaited<ReturnType<typeof createApp>> | undefined;
  const shutdown = () => { void ownedApp?.close().catch(() => { process.exitCode = 1; }); };
  const admin = resolveAdminConfig();
  const app = await createApp({ admin, onClose: () => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.removeListener(signal, shutdown);
  } });
  ownedApp = app;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, shutdown);
  try {
    const address = await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(portText) });
    if (admin) assertAdminListener(app, admin);
    console.log(`API: ${address}`);
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await startServer(); }
  catch { console.error('API startup failed; check database configuration, backup/migration and listening address.'); process.exitCode = 1; }
}
