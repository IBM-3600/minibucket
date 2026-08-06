type Handler = (payload: unknown) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler>>();
  private wildcards = new Set<(type: string, payload: unknown) => void>();

  on(type: string, fn: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  subscribeAll(fn: (type: string, payload: unknown) => void): () => void {
    this.wildcards.add(fn);
    return () => this.wildcards.delete(fn);
  }

  emit(type: string, payload?: unknown): void {
    this.handlers.get(type)?.forEach(fn => {
      try { fn(payload); } catch { /* listener errors are isolated */ }
    });
    this.wildcards.forEach(fn => {
      try { fn(type, payload); } catch { /* ignore */ }
    });
  }
}