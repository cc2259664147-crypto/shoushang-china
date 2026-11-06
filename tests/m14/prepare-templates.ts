/** Explicit one-shot initializer for a brand-new isolated M14-3B SQLite path. */
import { existsSync } from 'node:fs';
import { ContentDatabase } from '../../apps/api/src/database';
import { developmentData } from '../../apps/api/src/database/development';
import { candidateTemplates } from './template-candidates';

const path = process.argv[2];
if (!path || !path.includes('m14-3b-') || !path.endsWith('content.sqlite') || existsSync(path)) throw new Error('A new M14-3B isolated content.sqlite path is required');
const db = new ContentDatabase({ path });
try {
  if (!db.initializeDevelopment({ crafts: developmentData.crafts, templates: candidateTemplates, exhibits: [], stories: [] })) throw new Error('Candidate initialization did not run');
} finally { db.close(); }
