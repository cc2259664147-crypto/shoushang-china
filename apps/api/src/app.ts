import Fastify from 'fastify';
import { HealthSchema } from '@shoushang/contracts';
export function createApp() {
  const app = Fastify({ logger: false });
  app.get('/health', async () => HealthSchema.parse({ status: 'ok', service: '@shoushang/api', version: '0.1.0', contentMode: 'mock', database: 'not-initialized' }));
  // No fake business endpoints. Public HTTP content and admin persistence belong to M12/M13.
  return app;
}
