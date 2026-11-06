import type { Favorite, FavoriteRepository, Result, StorageFailure } from '@shoushang/contracts';
import { openIndexedDbRepository } from '@shoushang/local-repository';

export interface FavoriteConnection { favorites: FavoriteRepository; close(): void }
type Open = () => Promise<Result<FavoriteConnection, StorageFailure>>;
interface Snapshot { items: Favorite[] | null; error: string; pending: ReadonlySet<string>; reading: boolean }
export class GalleryFavorites {
  private value: Snapshot = { items: null, error: '', pending: new Set(), reading: false };
  private listeners = new Set<() => void>();
  private connection: FavoriteConnection | null = null;
  private opening: ReturnType<Open> | null = null;
  private epoch = 0;
  private read = 0;
  private mutation = 0;
  private refreshQueued = false;
  private locks = new Set<string>();
  constructor(private readonly open: Open = () => openIndexedDbRepository()) {}
  snapshot = () => this.value;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(patch: Partial<Snapshot>) { this.value = { ...this.value, ...patch }; this.listeners.forEach(fn => fn()); }
  private async port() {
    if (this.connection) return { ok: true as const, value: this.connection };
    if (!this.opening) {
      const epoch = this.epoch;
      this.opening = this.open().then(r => { if (epoch !== this.epoch) { if (r.ok) r.value.close(); return { ok: false as const, error: { code: 'STORAGE_UNAVAILABLE' as const, message: '收藏连接已关闭', requestId: 'gallery', fieldErrors: [] } }; } if (r.ok) this.connection = r.value; this.opening = null; return r; });
    }
    return this.opening;
  }
  async refresh() {
    if (this.locks.size) { this.refreshQueued = true; return; }
    const read = ++this.read, mutation = this.mutation, epoch = this.epoch;
    this.publish({ reading: true });
    try {
      const port = await this.port();
      const r = port.ok ? await port.value.favorites.list() : port;
      if (read !== this.read || mutation !== this.mutation || epoch !== this.epoch) return;
      this.publish(r.ok ? { items: r.value, error: '', reading: false } : { items: null, error: `${r.error.code}：${r.error.message}`, reading: false });
    } catch { if (read === this.read && epoch === this.epoch && mutation === this.mutation) this.publish({ items: null, error: '收藏读取失败，请重试', reading: false }); }
  }
  async toggle(id: string) {
    if (this.locks.has(id) || !this.value.items) return;
    this.locks.add(id); ++this.mutation; ++this.read;
    const epoch = this.epoch, existing = this.value.items.find(f => f.exhibitId === id);
    this.publish({ pending: new Set(this.locks), reading: false });
    try {
      const port = await this.port();
      const r = port.ok ? existing ? await port.value.favorites.remove(id) : await port.value.favorites.put({ exhibitId: id, createdAt: new Date().toISOString() }) : port;
      if (epoch !== this.epoch) return;
      if (!r.ok) this.publish({ error: `收藏操作未完成：${r.error.code}：${r.error.message}；可重试，原状态保留` });
      else {
        const rest = (this.value.items ?? []).filter(f => f.exhibitId !== id);
        this.publish({ items: existing ? rest : [...rest, r.value as Favorite], error: '' });
      }
    } catch { if (epoch === this.epoch) this.publish({ error: '收藏操作未完成，请重试；原状态保留' }); }
    finally { this.locks.delete(id); ++this.mutation; ++this.read; if (epoch === this.epoch) { this.publish({ pending: new Set(this.locks), reading: false }); if (!this.locks.size && this.refreshQueued) { this.refreshQueued = false; void this.refresh(); } } }
  }
  dispose() { this.epoch++; this.read++; this.connection?.close(); this.connection = null; this.opening = null; }
}
