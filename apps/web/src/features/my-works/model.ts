import type { EditorProfileRegistryEntryV2, WorkV1, WorkV2 } from '@shoushang/contracts';
import type { IndexedDbRepository, RecordIssue, ValidatedStoredDraft, ValidatedStoredWork } from '@shoushang/local-repository';

export type HistoricalMode = 'editable' | 'read-export-only';
export type EntryVersion = 'draft' | 'stored-draft' | 'completed';
export type Filter = 'all' | 'draft' | 'completed';

export interface WorkEntry {
  readonly id: string;
  readonly work: ValidatedStoredWork | null;
  readonly draft: ValidatedStoredDraft | null;
  readonly updatedAt: string;
}

export type EntrySelection =
  | { readonly schemaVersion: 1; readonly historicalMode: null; readonly work: WorkV1 }
  | { readonly schemaVersion: 2; readonly historicalMode: HistoricalMode; readonly work: WorkV2 };

export function selectVersion(entry: WorkEntry, version: EntryVersion): EntrySelection {
  if (version === 'draft') {
    if (!entry.draft) throw new Error('所选版本不存在');
    return entry.draft.schemaVersion === 1
      ? { schemaVersion: 1, historicalMode: null, work: entry.draft.work }
      : { schemaVersion: 2, historicalMode: entry.draft.historicalMode, work: entry.draft.work };
  }
  if (!entry.work) throw new Error('所选版本不存在');
  if (version === 'completed' && entry.work.work.status !== 'completed') throw new Error('所选版本不存在');
  if (version === 'stored-draft' && entry.work.work.status !== 'draft') throw new Error('所选版本不存在');
  return entry.work.schemaVersion === 1
    ? { schemaVersion: 1, historicalMode: null, work: entry.work.work }
    : { schemaVersion: 2, historicalMode: entry.work.historicalMode, work: entry.work.work };
}

export function shownVersion(entry: WorkEntry): EntryVersion {
  return entry.draft ? 'draft' : entry.work?.work.status === 'draft' ? 'stored-draft' : 'completed';
}

export function entryVersions(entry: WorkEntry): EntryVersion[] {
  return [
    ...(entry.draft ? ['draft' as const] : []),
    ...(entry.work ? [entry.work.work.status === 'draft' ? 'stored-draft' as const : 'completed' as const] : []),
  ];
}

export function entrySchemaVersion(entry: WorkEntry): 1 | 2 | null {
  return entry.work?.schemaVersion ?? entry.draft?.schemaVersion ?? null;
}

export function entryHistoricalMode(entry: WorkEntry): HistoricalMode | null {
  return entry.work?.schemaVersion === 2 ? entry.work.historicalMode : entry.draft?.schemaVersion === 2 ? entry.draft.historicalMode : null;
}

export function isReadExportOnly(entry: WorkEntry): boolean {
  return entrySchemaVersion(entry) === 1 || entryHistoricalMode(entry) === 'read-export-only';
}

export function canRename(entry: WorkEntry): boolean {
  return !isReadExportOnly(entry) && (entry.work !== null || entry.draft !== null);
}

export function canCopySelection(selection: EntrySelection, registry: readonly EditorProfileRegistryEntryV2[]): boolean {
  if (selection.schemaVersion === 1) return true;
  if (selection.historicalMode === 'read-export-only') return false;
  const profile = selection.work.editorProfileSnapshot;
  const matches = registry.filter(entry => entry.profile.profileId === profile.profileId && entry.profile.profileVersion === profile.profileVersion);
  return matches.length === 1 && matches[0]!.lifecycle.newWorkEnabled;
}

export function mergeWorks(works: ValidatedStoredWork[], drafts: ValidatedStoredDraft[]): WorkEntry[] {
  const byId = new Map<string, WorkEntry>();
  for (const item of works) byId.set(item.work.id, { id: item.work.id, work: item, draft: null, updatedAt: item.work.updatedAt });
  for (const item of drafts) {
    const old = byId.get(item.workId);
    const updatedAt = Date.parse(item.updatedAt) > Date.parse(old?.updatedAt ?? '') ? item.updatedAt : old?.updatedAt ?? item.updatedAt;
    byId.set(item.workId, { id: item.workId, work: old?.work ?? null, draft: item, updatedAt });
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
}

export function filterWorks(entries: WorkEntry[], filter: Filter): WorkEntry[] {
  return entries.filter(entry => filter === 'all'
    || filter === 'draft' && (!!entry.draft || entry.work?.work.status === 'draft')
    || filter === 'completed' && entry.work?.work.status === 'completed');
}

export async function loadWorks(repo: IndexedDbRepository): Promise<{ entries: WorkEntry[]; issues: RecordIssue[] }> {
  const [first, drafts, issues] = await Promise.all([repo.listAnyWorks({ page: 1, pageSize: 50 }), repo.listAnyDrafts(), repo.inspectRecords()]);
  if (!first.ok) throw new Error(first.error.message);
  if (!drafts.ok) throw new Error(drafts.error.message);
  if (!issues.ok) throw new Error(issues.error.message);
  const works = [...first.value.items];
  for (let page = 2; page <= Math.ceil(first.value.total / 50); page++) {
    const next = await repo.listAnyWorks({ page, pageSize: 50 });
    if (!next.ok) throw new Error(next.error.message);
    works.push(...next.value.items);
  }
  return { entries: mergeWorks(works, drafts.value), issues: issues.value };
}

export function copyName(name: string): string {
  const suffix = '副本'; let prefix = name;
  while (prefix.length + suffix.length > 30) prefix = prefix.slice(0, -1);
  if (prefix.length && /[\uD800-\uDBFF]/.test(prefix.at(-1) ?? '')) prefix = prefix.slice(0, -1);
  return prefix + suffix;
}
