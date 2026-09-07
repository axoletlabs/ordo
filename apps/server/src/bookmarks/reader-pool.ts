import { Worker } from "node:worker_threads";
import { join } from "node:path";
import type { ExtractedContent } from "./reader-parse.js";
import { extractFromHtml } from "./reader-parse.js";
import { reviveExtractError, type SerializedExtractError } from "./reader-errors.js";

const POOL_SIZE = 2;

interface Job {
  html: string;
  url: string;
  forceArticle: boolean;
  resolve: (value: ExtractedContent) => void;
  reject: (err: unknown) => void;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: ExtractedContent;
  error?: SerializedExtractError;
}

/**
 * Two-thread pool for Readability/DOM work so fetch concurrency cannot freeze
 * the HTTP event loop. Falls back to in-process parse in tests or if workers
 * fail to start.
 */
export class ExtractPool {
  private readonly workers: Worker[] = [];
  private readonly busy = new Set<Worker>();
  private readonly pending = new Map<number, Job>();
  private readonly queue: Job[] = [];
  private nextId = 1;
  private inline = false;

  constructor() {
    if (process.env.JEST_WORKER_ID || process.env.ORDO_EXTRACT_WORKERS === "0") {
      this.inline = true;
      return;
    }
    try {
      const filename = join(__dirname, "reader.worker.js");
      for (let i = 0; i < POOL_SIZE; i += 1) {
        const worker = new Worker(filename);
        worker.on("message", (msg: WorkerResponse) => this.onMessage(worker, msg));
        worker.on("error", () => this.fallbackToInline());
        worker.on("exit", (code) => {
          if (code !== 0) this.fallbackToInline();
        });
        this.workers.push(worker);
      }
    } catch {
      this.inline = true;
    }
  }

  private fallbackToInline(): void {
    if (this.inline && this.workers.length === 0) return;
    this.inline = true;
    const workers = this.workers.splice(0);
    for (const worker of workers) {
      worker.removeAllListeners();
      void worker.terminate();
    }
    const jobs = [...this.pending.values(), ...this.queue.splice(0)];
    this.pending.clear();
    this.busy.clear();
    for (const job of jobs) {
      try {
        job.resolve(extractFromHtml(job.html, job.url, { forceArticle: job.forceArticle }));
      } catch (err) {
        job.reject(err);
      }
    }
  }

  parse(html: string, url: string, forceArticle: boolean): Promise<ExtractedContent> {
    if (this.inline || this.workers.length === 0) {
      try {
        return Promise.resolve(extractFromHtml(html, url, { forceArticle }));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ html, url, forceArticle, resolve, reject });
      this.pump();
    });
  }

  async close(): Promise<void> {
    this.inline = true;
    const jobs = [...this.pending.values(), ...this.queue.splice(0)];
    this.pending.clear();
    this.busy.clear();
    const workers = this.workers.splice(0);
    await Promise.all(
      workers.map((worker) => {
        worker.removeAllListeners();
        return worker.terminate();
      }),
    );
    for (const job of jobs) job.reject(new Error("extract pool closed"));
  }

  private pump(): void {
    for (const worker of this.workers) {
      if (this.busy.has(worker)) continue;
      const job = this.queue.shift();
      if (!job) return;
      const id = this.nextId++;
      this.busy.add(worker);
      this.pending.set(id, job);
      worker.postMessage({
        id,
        html: job.html,
        url: job.url,
        forceArticle: job.forceArticle,
      });
    }
  }

  private onMessage(worker: Worker, msg: WorkerResponse): void {
    this.busy.delete(worker);
    const job = this.pending.get(msg.id);
    this.pending.delete(msg.id);
    if (job) {
      if (msg.ok && msg.result) job.resolve(msg.result);
      else job.reject(msg.error ? reviveExtractError(msg.error) : new Error("extract worker failed"));
    }
    this.pump();
  }
}
