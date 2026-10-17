import type { ApiError, ContentQuery, Craft, CutOperation, Exhibit, Favorite, Page, Result, Story, TemplateVersion, Work } from './model';

/** Query ports have identical semantics for mock and future HTTP adapters. */
export interface ContentClient {
  readonly mode: 'mock' | 'http';
  listCrafts(): Promise<Result<Craft[]>>;
  listTemplates(query?: ContentQuery): Promise<Result<Page<TemplateVersion>>>;
  getTemplate(id: string): Promise<Result<TemplateVersion>>;
  listExhibits(query?: ContentQuery): Promise<Result<Page<Exhibit>>>;
  getExhibit(id: string): Promise<Result<Exhibit>>;
  listStories(query?: ContentQuery): Promise<Result<Page<Story>>>;
  getStory(id: string): Promise<Result<Story>>;
  getHome(): Promise<Result<{ exhibits: Exhibit[]; stories: Story[] }>>;
}
export type PapercutCommand =
  | { type: 'add-cut'; operation: CutOperation }
  | { type: 'undo' } | { type: 'redo' }
  | { type: 'set-palette'; palette: Work['palette'] };
export interface PapercutState { readonly work: Work; readonly undo: readonly Work[]; readonly redo: readonly Work[] }
export type CoreError = ApiError & { code: 'INVALID_INPUT' | 'GEOMETRY_INVALID' | 'UNSUPPORTED_VERSION' };
export interface PapercutCore {
  createState(work: Work): Result<PapercutState, CoreError>;
  validate(work: Work): Result<Work, CoreError>;
  dispatch(state: PapercutState, command: PapercutCommand): Result<PapercutState, CoreError>;
}
export interface RenderInput { readonly work: Work; readonly width: number; readonly height: number; readonly view: 'unfolded' | 'folded' }
export interface RenderOutput { readonly svg: string; readonly width: number; readonly height: number; readonly rendererVersion: 1 }
export interface ArtworkRenderer { render(input: RenderInput): Result<RenderOutput> }
export type StorageFailure =
  | (ApiError & { code: 'REVISION_CONFLICT'; expectedRevision: number | null; actualRevision: number | null })
  | (ApiError & { code: 'NOT_FOUND' | 'STORAGE_UNAVAILABLE' | 'QUOTA_EXCEEDED' | 'INVALID_INPUT' | 'UNSUPPORTED_VERSION' });
export interface LocalWorkQuery { readonly status?: Work['status']; readonly page?: number; readonly pageSize?: number }
export interface SaveWorkInput {
  readonly work: Work;
  /** null means create-only. An update must match the stored revision. */
  readonly expectedRevision: number | null;
}
export interface LocalRepository {
  readonly persistence: 'memory' | 'indexeddb';
  list(query?: LocalWorkQuery): Promise<Result<Page<Work>, StorageFailure>>;
  read(id: string): Promise<Result<Work, StorageFailure>>;
  save(input: SaveWorkInput): Promise<Result<Work, StorageFailure>>;
  delete(id: string, expectedRevision: number): Promise<Result<{ id: string }, StorageFailure>>;
}
export interface FavoriteRepository {
  list(): Promise<Result<Favorite[], StorageFailure>>;
  put(favorite: Favorite): Promise<Result<Favorite, StorageFailure>>;
  remove(exhibitId: string): Promise<Result<{ exhibitId: string }, StorageFailure>>;
}
export interface ExportInput { readonly work: Work; readonly width?: number; readonly height?: number }
export interface ExportOutput {
  readonly bytes: Uint8Array; readonly mimeType: 'image/png'; readonly filename: string;
  readonly width: number; readonly height: number;
}
/** Implementations inject the shared renderer; no separate cut geometry in the exporter. */
export interface ArtworkExporter { exportCard(input: ExportInput): Promise<Result<ExportOutput>> }
