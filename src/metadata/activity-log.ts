import { JsonStore } from './json-store.js';
import { uuid } from '../lib/ids.js';
import type { ActivityEntry } from '../types.js';

const MAX_ENTRIES = 2000;

interface ActivityFile { entries: ActivityEntry[]; }

export class ActivityLog {
  constructor(private store: JsonStore<ActivityFile>) {}

  async add(actor: string, action: string, target?: string, detail?: string): Promise<void> {
    const entry: ActivityEntry = { id: uuid(), ts: new Date().toISOString(), actor, action, target, detail };
    await this.store.mutate(d => {
      d.entries.unshift(entry);
      if (d.entries.length > MAX_ENTRIES) d.entries.length = MAX_ENTRIES;
    });
  }

  list(opts: { page?: number; perPage?: number; action?: string } = {}): {
    items: ActivityEntry[]; total: number; page: number; perPage: number;
  } {
    const page = Math.max(1, opts.page ?? 1);
    const perPage = Math.min(500, opts.perPage ?? 50);
    let items = this.store.snapshot.entries;
    if (opts.action) items = items.filter(e => e.action === opts.action);
    const total = items.length;
    return { items: items.slice((page - 1) * perPage, page * perPage), total, page, perPage };
  }
}