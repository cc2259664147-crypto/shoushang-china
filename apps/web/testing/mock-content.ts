// Explicit legacy regression injection. Never imported by the production config or build.
import { createMockContentClient } from '@shoushang/content-client';
import { PublicTemplateSchema, TemplateVersionV1Schema, type PublicTemplate } from '@shoushang/contracts';
import profilesDocument from '../../../docs/qa/m15/editor-profiles-v2.json';
import templateV2C04Document from '../../../content/v2-additions-2026-10-27/template-v2-c04.json';

const base = createMockContentClient();
const formalTemplates: PublicTemplate[] = [
  ...profilesDocument.profiles.map(entry =>
    TemplateVersionV1Schema.parse(JSON.parse(entry.evidence.sourceTemplateCanonicalJcs)),
  ),
  PublicTemplateSchema.parse(templateV2C04Document),
];

export const contentClient = {
  ...base,
  async listTemplates() {
    return { ok: true as const, value: { items: structuredClone(formalTemplates), total: formalTemplates.length, page: 1, pageSize: 50 } };
  },
  async getTemplate(id: string) {
    const template = formalTemplates.find(item => item.id === id);
    return template
      ? { ok: true as const, value: structuredClone(template) }
      : { ok: false as const, error: { code: 'NOT_FOUND' as const, message: '内容不存在或不可公开访问', requestId: 'mock-content-request', fieldErrors: [] } };
  },
};
