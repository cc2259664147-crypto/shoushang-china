import type {
  ApiError, BrushCandidateV2, BrushCutV2, ContentQuery, Craft, CutOperation, Exhibit, Favorite, FreehandCandidateV2,
  FreehandCutV2, Page, ParametricCutV2, PublicTemplate, Result, Story, Work, WorkV2,
} from './model';

/** Query ports have identical semantics for mock and future HTTP adapters. */
export interface ContentClient {
  readonly mode: 'mock' | 'http';
  listCrafts(): Promise<Result<Craft[]>>;
  listTemplates(query?: ContentQuery): Promise<Result<Page<PublicTemplate>>>;
  getTemplate(id: string): Promise<Result<PublicTemplate>>;
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
export type PapercutCommandV2 =
  | { type: 'add-parametric-cut'; operation: ParametricCutV2 }
  | { type: 'add-freehand-cut'; candidate: FreehandCandidateV2 }
  | { type: 'add-brush-cut'; candidate: BrushCandidateV2 }
  | { type: 'update-cut'; operationId: string; change:
    | { type: 'translate'; dx: number; dy: number }
    | { type: 'transform-parametric'; center: ParametricCutV2['center']; width: number; height: number; angleDeg: number }
  }
  | { type: 'duplicate-cut'; operationId: string; newOperationId: string; dx: number; dy: number }
  | { type: 'delete-cut'; operationId: string }
  | { type: 'clear-cuts' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'set-palette'; palette: WorkV2['palette'] };
export interface PapercutStateV2 {
  readonly work: WorkV2;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}
export interface PapercutSessionV2 {
  current(): PapercutStateV2;
  dispatch(command: PapercutCommandV2): Result<PapercutStateV2, CoreError>;
}
export interface PapercutCoreV2 {
  prepareFreehandCut(work: WorkV2, candidate: FreehandCandidateV2): Result<FreehandCutV2, CoreError>;
  prepareBrushCut(work: WorkV2, candidate: BrushCandidateV2): Result<BrushCutV2, CoreError>;
  createSession(work: WorkV2): Result<PapercutSessionV2, CoreError>;
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
