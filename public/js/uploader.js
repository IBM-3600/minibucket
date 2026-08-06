import { api } from './api.js';

const CHUNK_THRESHOLD = 4 * 1024 * 1024; // > 4 MiB → chunked/resumable path
const CONCURRENCY = 3;

/**
 * Upload queue with pause/resume/retry, progress events, and automatic
 * chunked + resumable uploads for large files.
 */
export class Uploader extends EventTarget {
  constructor() {
    super();
    this.items = new Map();
    this.running = 0;
    this.waiting = [];
  }

  add(files, { folder = '', tags = [] } = {}) {
    const added = [];
    for (const file of files) {
      const item = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file, folder, tags,
        name: file.name, size: file.size,
        done: 0, state: 'waiting', error: null,
        uploadId: null, gate: null, gateResolve: null
      };
      this.items.set(item.id, item);
      this.waiting.push(item.id);
      added.push(item);
    }
    this.emit();
    this.pump();
    return added;
  }

  pump() {
    while (this.running < CONCURRENCY && this.waiting.length > 0) {
      const id = this.waiting.shift();
      const item = this.items.get(id);
      if (!item || item.state === 'cancelled') continue;
      this.running++;
      item.state = 'uploading';
      this.emit();
      this.run(item).finally(() => { this.running--; this.pump(); });
    }
  }

  async run(item) {
    try {
      if (item.size > CHUNK_THRESHOLD) await this.runChunked(item);
      else await this.runSimple(item);
      if (item.state === 'cancelled') return;
      item.state = 'done'; item.done = item.size;
    } catch (err) {
      if (item.state === 'cancelled') return;
      item.state = 'error';
      item.error = err?.message || 'upload failed';
    }
    this.emit();
  }

  async runSimple(item) {
    const fd = new FormData();
    fd.append('file', item.file, item.name);
    if (item.folder) fd.append('folder', item.folder);
    if (item.tags.length) fd.append('tags', item.tags.join(','));
    fd.append('source', 'ui');

    // fetch with progress via XHR (FormData upload progress is simpler with XHR)
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/v1/assets');
      if (api.token) xhr.setRequestHeader('Authorization', `Bearer ${api.token}`);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) { item.done = e.loaded; this.emit(); } };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
      xhr.onerror = () => reject(new Error('network error'));
      xhr.send(fd);
    });
  }

  async runChunked(item) {
    if (!item.uploadId) {
      const init = await api.post('/api/v1/assets/multipart', {
        filename: item.name, size: item.size, tags: item.tags, folder: item.folder
      });
      item.uploadId = init.uploadId;
      item.chunkSize = init.chunkSize;
    }
    const status = await api.get(`/api/v1/assets/multipart/${item.uploadId}`);
    const have = new Set(status.receivedParts);
    const total = Math.ceil(item.size / item.chunkSize);

    for (let i = 0; i < total; i++) {
      if (item.state === 'cancelled') return;
      if (item.state === 'paused') await this.waitForResume(item);
      if (item.state === 'cancelled') return;

      if (have.has(i)) { item.done = Math.max(item.done, (i + 1) * item.chunkSize); continue; }
      const start = i * item.chunkSize;
      const end = Math.min(item.size, start + item.chunkSize);
      const blob = item.file.slice(start, end);

      await this.withRetry(() => api.put(
        `/api/v1/assets/multipart/${item.uploadId}/chunk/${i}`,
        blob, { 'Content-Type': 'application/octet-stream' }
      ));
      item.done = end;
      this.emit();
    }
    await api.post(`/api/v1/assets/multipart/${item.uploadId}/complete`, { tags: item.tags, folder: item.folder });
  }

  async withRetry(fn, attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try { return await fn(); }
      catch (err) { lastErr = err; await new Promise(r => setTimeout(r, 500 * (i + 1))); }
    }
    throw lastErr;
  }

  waitForResume(item) {
    return new Promise(resolve => { item.gateResolve = resolve; });
  }

  pause(id) { const it = this.items.get(id); if (it && it.state === 'uploading') { it.state = 'paused'; this.emit(); } }
  resume(id) {
    const it = this.items.get(id);
    if (!it) return;
    if (it.state === 'paused') { it.state = 'uploading'; it.gateResolve?.(); this.emit(); }
    if (it.state === 'error') { it.state = 'waiting'; it.error = null; this.waiting.push(id); this.emit(); this.pump(); }
  }
  retry(id) { this.resume(id); }
  cancel(id) {
    const it = this.items.get(id);
    if (!it) return;
    it.state = 'cancelled';
    it.gateResolve?.();
    if (it.uploadId) api.del(`/api/v1/assets/multipart/${it.uploadId}`).catch(() => {});
    this.emit();
  }
  clearFinished() {
    for (const [id, it] of this.items) if (it.state === 'done' || it.state === 'cancelled') this.items.delete(id);
    this.emit();
  }

  summary() {
    let active = 0, done = 0, errors = 0;
    for (const it of this.items.values()) {
      if (it.state === 'uploading' || it.state === 'paused' || it.state === 'waiting') active++;
      else if (it.state === 'done') done++;
      else if (it.state === 'error') errors++;
    }
    return { active, done, errors, total: this.items.size };
  }

  emit() { this.dispatchEvent(new CustomEvent('change')); }
}

export const uploader = new Uploader();