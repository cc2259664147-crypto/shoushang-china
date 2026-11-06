import {
  EditorProfileRegistryEntryV2Schema,
  type EditorProfileRegistryEntryV2,
} from '@shoushang/contracts';
import profilesDocument from '../../../../../../docs/qa/m15/editor-profiles-v2.json';
import profileV2C04Document from '../../../../../../content/v2-additions-2026-10-27/editor-profile-v2-c04.json';

function parseProfiles(): readonly EditorProfileRegistryEntryV2[] {
  if (profilesDocument.schemaVersion !== 1 || !Array.isArray(profilesDocument.profiles)) {
    throw new Error('正式编辑器 profile 文档结构无效');
  }

  return Object.freeze([...profilesDocument.profiles, profileV2C04Document].map((entry, index) => {
    const parsed = EditorProfileRegistryEntryV2Schema.safeParse({
      profile: entry.profile,
      lifecycle: entry.lifecycle,
    });
    if (!parsed.success) {
      throw new Error(`正式编辑器 profile[${index}] 校验失败: ${parsed.error.message}`);
    }
    return parsed.data;
  }));
}

export const EDITOR_PROFILE_REGISTRY_V2: readonly EditorProfileRegistryEntryV2[] = parseProfiles();

/** Match the same enabled, unique profile requirement used when creating a work. */
export function hasCreatableEditorProfile(template: { id: string; version: number }): boolean {
  return EDITOR_PROFILE_REGISTRY_V2.filter(entry => entry.lifecycle.newWorkEnabled
    && entry.profile.sourceTemplate.id === template.id
    && entry.profile.sourceTemplate.version === template.version).length === 1;
}
