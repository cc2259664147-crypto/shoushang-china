/** One-shot initializer for a brand-new M14-4 candidate-site database. */
import { existsSync } from 'node:fs';
import { ContentDatabase } from '../../apps/api/src/database';
import { developmentData } from '../../apps/api/src/database/development';
import { candidateTemplates } from './template-candidates';

const path = process.argv[2];
if (!path || !path.includes('m14-4-') || !path.endsWith('content.sqlite') || existsSync(path)) {
  throw new Error('A new project-external M14-4 content.sqlite path is required');
}
const database = new ContentDatabase({ path });
try {
  const initialized = database.initializeDevelopment({
    crafts: developmentData.crafts,
    templates: candidateTemplates,
    exhibits: [],
    stories: [],
  });
  if (!initialized) throw new Error('Candidate database initialization did not run');
} finally {
  database.close();
}
