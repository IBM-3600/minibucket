import { JsonStore } from './json-store.js';

interface SettingsFile { settings: Record<string, unknown>; }

const ALLOWED_KEYS = ['dedupe', 'thumbnailEnabled', 'namingStrategy'];

export class SettingsRepo {
  constructor(private store: JsonStore<SettingsFile>) {}

  get(): Record<string, unknown> { return { ...this.store.snapshot.settings }; }

  async patch(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.store.mutate(d => {
      for (const [k, v] of Object.entries(patch)) {
        if (ALLOWED_KEYS.includes(k)) d.settings[k] = v;
      }
      return { ...d.settings };
    });
  }
}