// Explicit isolated test preparation. Normal app/server never imports this file.
import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { ContentDatabase } from '../src/database';
import { developmentData } from '../src/database/development';
import { hashPassword } from '../src/admin/security';

export async function prepareAdminIntegration(root: string, password: string): Promise<void> {
  if (!isAbsolute(root) || !existsSync(root) || readdirSync(root).length !== 0 || password.length < 24)
    throw new Error('A new empty absolute test directory and random temporary password are required');
  const db = new ContentDatabase({ path: join(root, 'content.sqlite') });
  try {
    db.initializeDevelopment(developmentData);
    const hash = await hashPassword(password);
    db.admin.maintenanceAccount('integration-admin', 'admin', hash);
    db.admin.maintenanceAccount('integration-editor', 'editor', hash);
  } finally { db.close(); }
}
