import { PublicTemplateSchema, type PublicTemplate } from '@shoushang/contracts';
import templateV2C04Document from '../../../../content/v2-additions-2026-10-27/template-v2-c04.json';

/** Additive public templates owned by the current application, separate from the frozen v1 content set. */
export const OFFICIAL_ADDITIVE_TEMPLATES: readonly PublicTemplate[] = Object.freeze([
  PublicTemplateSchema.parse(templateV2C04Document),
]);
