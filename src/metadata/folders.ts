import { JsonStore } from './json-store.js';

interface FoldersFile { folders: Record<string, { createdAt: string }>; }

/** Logical folders (metadata-only; files never move on disk when renaming folders). */
export class FoldersRepo {
  constructor(private store: JsonStore<FoldersFile>) {}

  list(): string[] { return Object.keys(this.store.snapshot.folders).sort(); }

  async create(name: string): Promise<void> {
    await this.store.mutate(d => {
      if (!d.folders[name]) d.folders[name] = { createdAt: new Date().toISOString() };
    });
  }

  async rename(from: string, to: string): Promise<void> {
    await this.store.mutate(d => {
      if (d.folders[from]) {
        d.folders[to] = d.folders[from];
        delete d.folders[from];
      }
    });
  }

  async remove(name: string): Promise<void> {
    await this.store.mutate(d => { delete d.folders[name]; });
  }
}