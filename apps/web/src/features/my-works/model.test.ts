import { describe, expect, it } from 'vitest';
import { EditorProfileV2Schema, TemplateVersionV1Schema, WorkV2Schema, type WorkV2 } from '@shoushang/contracts';
import { createFixtureWork } from '@shoushang/fixtures';
import type { EditorDraft, ValidatedStoredDraft, ValidatedStoredWork } from '@shoushang/local-repository';
import profilesDocument from '../../../../../docs/qa/m15/editor-profiles-v2.json';
import { canCopySelection, canRename, copyName, filterWorks, isReadExportOnly, mergeWorks, selectVersion } from './model';

const entry = profilesDocument.profiles[0]!;
const profile = EditorProfileV2Schema.parse(entry.profile);
const template = TemplateVersionV1Schema.parse(JSON.parse(entry.evidence.sourceTemplateCanonicalJcs));
const v2work = (id: string, status: WorkV2['status'] = 'completed', revision = 1): WorkV2 => WorkV2Schema.parse({
  id, name: 'v2 作品', craftId: template.craftId, templateSnapshot: template, editorProfileSnapshot: profile,
  palette: { paper: '#B82025', background: '#F2D9A6' }, operations: [], status, schemaVersion: 2, revision,
  createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z',
});
const stored = (work: ReturnType<typeof createFixtureWork>): ValidatedStoredWork => ({ schemaVersion: 1, work });
const storedV2 = (work: WorkV2, historicalMode: 'editable' | 'read-export-only' = 'editable'): ValidatedStoredWork => ({ schemaVersion: 2, work, historicalMode });

describe('my works grouping and names',()=>{
  it('merges two versions, sorts by latest update then ID, and includes both in each relevant filter',()=>{
    const base=createFixtureWork();
    const first={...base,id:'a',status:'completed' as const,revision:1,updatedAt:'2026-10-18T00:00:00Z'};
    const second={...first,id:'b'};
    const draft:EditorDraft={workId:'a',work:{...first,status:'draft' as const},step:'preview' as const,revision:5,baseRevision:1,updatedAt:'2026-10-18T01:00:00Z'};
    const entries=mergeWorks([stored(second),stored(first)],[{...draft,schemaVersion:1}]);
    expect(entries.map(x=>x.id)).toEqual(['a','b']);
    expect(filterWorks(entries,'draft').map(x=>x.id)).toEqual(['a']);
    expect(filterWorks(entries,'completed').map(x=>x.id)).toEqual(['a','b']);
    expect(mergeWorks([stored(second),stored(first)],[]).map(x=>x.id)).toEqual(['a','b']);
  });
  it('truncates UTF-16 without splitting an emoji surrogate pair',()=>{
    const name='一'.repeat(27)+'😀';
    expect(copyName(name)).toBe('一'.repeat(27)+'副本');
    expect(copyName('😀')).toBe('😀副本');
  });
  it('classifies a legal draft in the primary works store by status',()=>{
    const main={...createFixtureWork(),id:'main-draft',revision:1};
    const entries=mergeWorks([stored(main)],[]);
    expect(filterWorks(entries,'draft').map(x=>x.id)).toEqual(['main-draft']);
    expect(filterWorks(entries,'completed')).toEqual([]);
  });
  it('keeps v2 records as editable entries with their version and historical mode',()=>{
    const v2=storedV2(v2work('v2-completed'));
    const draft:ValidatedStoredDraft={workId:'v2-completed',work:v2work('v2-completed','draft',0),step:'cut',revision:3,baseRevision:1,updatedAt:'2026-10-26T01:00:00.000Z',schemaVersion:2,historicalMode:'editable'};
    const entries=mergeWorks([v2],[draft]);
    expect(entries).toHaveLength(1);
    expect(canRename(entries[0]!)).toBe(true);
    expect(isReadExportOnly(entries[0]!)).toBe(false);
    expect(selectVersion(entries[0]!,'completed')).toMatchObject({schemaVersion:2,historicalMode:'editable',work:{id:'v2-completed'}});
    expect(selectVersion(entries[0]!,'draft')).toMatchObject({schemaVersion:2,historicalMode:'editable',work:{status:'draft'}});
  });
  it('marks read-export-only v2 records as export-only and not renamable',()=>{
    const entries=mergeWorks([storedV2(v2work('v2-readonly'),'read-export-only')],[]);
    expect(isReadExportOnly(entries[0]!)).toBe(true);
    expect(canRename(entries[0]!)).toBe(false);
    expect(selectVersion(entries[0]!,'completed')).toMatchObject({schemaVersion:2,historicalMode:'read-export-only'});
  });
  it('marks v1 records as read-only and not renamable',()=>{
    const entries=mergeWorks([stored({...createFixtureWork(),status:'completed'})],[]);
    expect(isReadExportOnly(entries[0]!)).toBe(true);
    expect(canRename(entries[0]!)).toBe(false);
    expect(selectVersion(entries[0]!,'completed')).toMatchObject({schemaVersion:1,historicalMode:null});
  });
  it('blocks copies for disabled-for-new and read-export-only profiles',()=>{
    const selection=selectVersion(mergeWorks([storedV2(v2work('copy-policy'))],[])[0]!,'completed');
    if(selection.schemaVersion!==2)throw new Error('expected v2 selection');
    const registry=[{profile,lifecycle:{newWorkEnabled:false,historicalMode:'editable' as const}}];
    expect(canCopySelection(selection,registry)).toBe(false);
    expect(canCopySelection({...selection,historicalMode:'read-export-only'},[{profile,lifecycle:{newWorkEnabled:true,historicalMode:'read-export-only'}}])).toBe(false);
    expect(canCopySelection(selection,[{profile,lifecycle:{newWorkEnabled:true,historicalMode:'editable'}}])).toBe(true);
  });
});
