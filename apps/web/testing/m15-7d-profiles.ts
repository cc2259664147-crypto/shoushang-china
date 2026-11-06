import { EditorProfileRegistryEntryV2Schema, type EditorProfileRegistryEntryV2 } from '@shoushang/contracts';
import profilesDocument from '../../../docs/qa/m15/editor-profiles-v2.json';

const modes = [
  { newWorkEnabled: false, historicalMode: 'editable' as const },
  { newWorkEnabled: false, historicalMode: 'read-export-only' as const },
  { newWorkEnabled: true, historicalMode: 'editable' as const },
];

export const EDITOR_PROFILE_REGISTRY_V2: readonly EditorProfileRegistryEntryV2[] = Object.freeze(
  profilesDocument.profiles.map((entry, index) => EditorProfileRegistryEntryV2Schema.parse({
    profile: entry.profile,
    lifecycle: modes[index],
  })),
);
