// Ponte tipada entre a UI (main thread) e o Web Worker do Pyodide.
import type { CountResult, RunResult } from "../types";
import PyWorker from "./worker.ts?worker";

type Pending = { resolve: (v: any) => void; reject: (e: any) => void; onProgress?: ProgressCb };
export type ProgressCb = (done: number, total: number) => void;

export class JuscraperClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private ready: Promise<{ version: string }> | null = null;

  constructor(
    private proxyUrl: string,
    private wheelsBaseUrl: string
  ) {
    this.worker = new PyWorker();
    this.worker.onmessage = (ev: MessageEvent) => this.handle(ev.data);
  }

  private handle(msg: any) {
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.type === "progress") {
      p.onProgress?.(msg.done, msg.total);
      return;
    }
    if (msg.type === "result") {
      this.pending.delete(msg.id);
      p.resolve(msg.payload);
      return;
    }
    if (msg.type === "error") {
      this.pending.delete(msg.id);
      p.reject(new Error(msg.error));
    }
  }

  private send<T>(msg: Record<string, unknown>, onProgress?: ProgressCb): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ ...msg, id });
    });
  }

  /** Inicializa o Pyodide + juscraper. Idempotente. */
  bootstrap(): Promise<{ version: string }> {
    if (!this.ready) {
      this.ready = this.send<{ version: string }>({
        type: "bootstrap",
        proxyUrl: this.proxyUrl,
        wheelsBaseUrl: this.wheelsBaseUrl,
      });
    }
    return this.ready;
  }

  count(sigla: string, endpoint: string, params: Record<string, unknown>): Promise<CountResult> {
    return this.send<CountResult>({ type: "count", sigla, endpoint, params });
  }

  run(
    sigla: string,
    endpoint: string,
    params: Record<string, unknown>,
    paginas: number | null,
    onProgress?: ProgressCb
  ): Promise<RunResult> {
    return this.send<RunResult>({ type: "run", sigla, endpoint, params, paginas }, onProgress);
  }
}
