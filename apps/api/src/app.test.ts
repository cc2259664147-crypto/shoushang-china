import { expect, it } from 'vitest';
import { HealthSchema } from '@shoushang/contracts';
import { createApp } from './app';
it('serves validated health and does not pretend unimplemented content APIs exist', async () => {
  const app = createApp();
  try {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(HealthSchema.parse(response.json()).database).toBe('not-initialized');
    expect((await app.inject({ method: 'GET', url: '/api/v1/exhibits' })).statusCode).toBe(404);
  } finally { await app.close(); }
});
