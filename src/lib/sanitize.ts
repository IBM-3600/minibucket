/** Sanitize an uploaded filename: strip path components, control chars, unsafe symbols. */
export function sanitizeFilename(name: string): string {
  const base = String(name ?? 'file').split(/[\\/]/).pop() ?? 'file';
  let cleaned = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/\.+$/, '')
    .slice(0, 180)
    .trim();
  if (!cleaned) cleaned = 'file';
  if (cleaned.startsWith('.')) cleaned = `_${cleaned.slice(1)}`;
  return cleaned;
}

/** Validate a relative storage path coming from a URL. Returns null if unsafe. */
export function safeRelPath(input: string): string | null {
  const norm = String(input ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = norm.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  for (const p of parts) {
    if (p === '..' || p === '.') return null;
    if (/[<>:"|?*\u0000-\u001f]/.test(p)) return null;
  }
  return parts.join('/');
}

export function sanitizeFolderName(name: string): string {
  return String(name ?? '').trim().replace(/[\\/]+/g, '-').replace(/[<>:"|?*\u0000-\u001f]/g, '').slice(0, 100);
}