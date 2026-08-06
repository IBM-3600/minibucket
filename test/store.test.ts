import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { JsonStore } from '../src/metadata/json-store.js';

describe('JsonStore integrity', () => {
  it('serializes concurrent mutations without lost updates', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mb-store-'));
    const store = new JsonStore<{ counter: number }>({
      file: path.join(dir, 'data.json'),
      backupDir: path.join(dir, 'backups'),
      defaults: () => ({ counter: 0 })
    });
    await store.init();

    const N = 100;
    await Promise.all(Array.from({ length: N }, (_, i) => store.mutate(d => { d.counter += 1; return i; })));
    expect(store.snapshot.counter).toBe(N);

    await store.close();
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'data.json'), 'utf8'));
    expect(raw.counter).toBe(N);
  });

  it('recovers from a corrupted file via backups', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mb-store2-'));
    const file = path.join(dir, 'doc.json');
    const backupDir = path.join(dir, 'backups');
    const store = new JsonStore<{ v: number }>({ file, backupDir, defaults: () => ({ v: 0 }) });
    await store.init();
    await store.mutate(d => { d.v = 42; });
    await store.flush();
    await store.close();

    // Seed an old backup, then corrupt the live file
    await fs.mkdir(backupDir, { recursive: true });
    await fs.writeFile(path.join(backupDir, `doc.${Date.now() - 1000}.bak.json`), JSON.stringify({ v: 42 }));
    await fs.writeFile(file, '{corrupt!!');

    const store2 = new JsonStore<{ v: number }>({ file, backupDir, defaults: () => ({ v: 0 }) });
    await store2.init();
    expect(store2.snapshot.v).toBe(42);
    await store2.close();
  });
});