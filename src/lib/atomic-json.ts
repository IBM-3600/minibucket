import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export interface WriteJsonOptions {
  backupDir?: string;
  minBackupIntervalMs?: number;
  maxBackups?: number;
}

/**
 * Crash-safe JSON persistence: write to *.tmp then atomic rename.
 * Optionally maintains timestamped backups in backupDir (rate-limited, capped).
 */
export async function writeJsonAtomic(file: string, data: unknown, opts: WriteJsonOptions = {}): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });

  if (opts.backupDir) {
    try { await maybeBackup(file, opts.backupDir, opts.minBackupIntervalMs ?? 10 * 60_000, opts.maxBackups ?? 10); }
    catch { /* backups are best-effort */ }
  }

  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  const fd = await fs.open(tmp, 'w');
  try {
    await fd.writeFile(JSON.stringify(data, null, 2));
    await fd.sync().catch(() => {}); // best-effort fsync
  } finally {
    await fd.close();
  }
  await fs.rename(tmp, file);
}

async function maybeBackup(file: string, backupDir: string, minIntervalMs: number, maxBackups: number): Promise<void> {
  const base = path.basename(file).replace(/\.json$/, '');
  await fs.mkdir(backupDir, { recursive: true });
  const existing = (await fs.readdir(backupDir))
    .filter(f => f.startsWith(`${base}.`) && f.endsWith('.bak.json'))
    .sort();

  let newestTs = 0;
  if (existing.length > 0) {
    const m = existing[existing.length - 1].match(/\.(\d+)\.bak\.json$/);
    if (m) newestTs = Number(m[1]);
  }
  const hasFile = await fs.access(file).then(() => true, () => false);
  if (hasFile && Date.now() - newestTs >= minIntervalMs) {
    await fs.copyFile(file, path.join(backupDir, `${base}.${Date.now()}.bak.json`));
    existing.push(`${base}.${Date.now()}.bak.json`);
  }
  while (existing.length > maxBackups) {
    await fs.unlink(path.join(backupDir, existing.shift()!)).catch(() => {});
  }
}

export async function readJsonSafe<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Attempt to restore the newest backup for a corrupted file. */
export async function restoreLatestBackup(file: string, backupDir: string): Promise<unknown | null> {
  try {
    const base = path.basename(file).replace(/\.json$/, '');
    const backups = (await fs.readdir(backupDir))
      .filter(f => f.startsWith(`${base}.`) && f.endsWith('.bak.json'))
      .sort();
    for (let i = backups.length - 1; i >= 0; i--) {
      const data = await readJsonSafe(path.join(backupDir, backups[i]));
      if (data !== null) return data;
    }
  } catch { /* no backups */ }
  return null;
}