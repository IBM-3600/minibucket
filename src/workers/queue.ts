import type { Logger } from '../lib/logger.js';

type Handler = (payload: any) => Promise<void> | void;
interface Job { type: string; payload: any; attempts: number; }

/**
 * In-process background job queue with bounded concurrency and retries.
 * Swap for BullMQ / worker_threads pool when scaling out — the register/add
 * interface stays identical.
 */
export class JobQueue {
  private handlers = new Map<string, Handler>();
  private waiting: Job[] = [];
  private running = 0;
  private completedCount = 0;
  private failedCount = 0;
  private closed = false;

  constructor(private concurrency: number, private logger?: Logger,
              private onDone?: (type: string, payload: any, error?: Error) => void) {}

  register(type: string, handler: Handler): void { this.handlers.set(type, handler); }

  add(type: string, payload: any): void {
    if (this.closed) return;
    this.waiting.push({ type, payload, attempts: 0 });
    this.pump();
  }

  private pump(): void {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      const job = this.waiting.shift()!;
      this.running++;
      void this.run(job);
    }
  }

  private async run(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);
    try {
      if (!handler) throw new Error(`no handler for job type ${job.type}`);
      await handler(job.payload);
      this.completedCount++;
      this.onDone?.(job.type, job.payload);
    } catch (err) {
      job.attempts++;
      if (job.attempts < 3) {
        setTimeout(() => { this.waiting.push(job); this.pump(); }, 1000 * job.attempts).unref();
      } else {
        this.failedCount++;
        this.logger?.error(`job ${job.type} failed permanently: ${(err as Error).message}`);
        this.onDone?.(job.type, job.payload, err as Error);
      }
    } finally {
      this.running--;
      this.pump();
    }
  }

  stats() {
    return { waiting: this.waiting.length, running: this.running, completed: this.completedCount, failed: this.failedCount };
  }

  close(): void { this.closed = true; this.waiting = []; }
}