import { CraftSchema, ExhibitSchema, PublicTemplateSchema, StorySchema } from '@shoushang/contracts';

type Spec = { readonly [key: string]: true | Spec | readonly [Spec] };
function isArraySpec(rule: Spec | readonly [Spec]): rule is readonly [Spec] { return Array.isArray(rule); }
const license = { name: true, attribution: true, url: true } as const;
const source = { title: true, author: true, url: true, accessedAt: true, citation: true, note: true } as const;
const media = { id: true, url: true, alt: true, author: true, license, source: true, modification: true, width: true, height: true, kind: true } as const;
const point = { x: true, y: true } as const;
const craft = { id: true, name: true, slug: true, description: true, status: true, supportsExperience: true } as const;
const template = {
  id: true, craftId: true, version: true, name: true, difficulty: true, steps: true, enabled: true,
  geometry: { basePaper: { kind: true }, symmetry: { kind: true, axis: true, sectors: true, mirror: true }, allowedRegion: [point] },
  allowedCuts: [{ shape: true, minWidth: true, maxWidth: true, minHeight: true, maxHeight: true }],
  rules: { minEdgeGap: true, maxOperations: true }, recommendedColors: true, license, digitalNotice: true, geometryVersion: true, rendererVersion: true,
} as const;
const exhibit = {
  id: true, title: true, craftId: true, category: true, tags: true, summary: true, description: true,
  media: [media], sources: [source], storyIds: true, templateIds: true, dateLabel: true, region: true,
  creator: true, meaning: true, sortOrder: true, revision: true, updatedAt: true, developmentOnly: true,
} as const;
const story = {
  id: true, title: true, personName: true, personBio: true, craftIds: true, region: true, summary: true,
  cover: media, body: [{ type: true, text: true }], timeline: [{ dateLabel: true, text: true, sources: [source] }],
  sources: [source], exhibitIds: true, templateId: true, sortOrder: true, revision: true, updatedAt: true, developmentOnly: true,
} as const;
/** Explicit recursive public allowlist, followed by strict contract validation. */
function project(input: unknown, spec: Spec): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const fields = Object.fromEntries(Object.entries(input));
  return Object.fromEntries(Object.entries(spec).filter(([key]) => fields[key] !== undefined).map(([key, rule]) => {
    const value = fields[key];
    if (rule === true) return [key, value];
    if (isArraySpec(rule)) return [key, Array.isArray(value) ? value.map(v => project(v, rule[0])) : value];
    return [key, project(value, rule)];
  }));
}
export const publicCraft = (input: unknown) => CraftSchema.parse(project(input, craft));
export const publicTemplate = (input: unknown) => PublicTemplateSchema.parse(project(input, template));
export const publicExhibit = (input: unknown) => ExhibitSchema.parse(project(input, exhibit));
export const publicStory = (input: unknown) => StorySchema.parse(project(input, story));
