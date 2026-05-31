/// <reference lib="webworker" />
/**
 * Web Worker que hospeda o Pyodide e roda o glue Python.
 *
 * Roda fora da main thread porque o glue usa XHR síncrono com
 * responseType="arraybuffer" — só permitido em workers.
 */
import glueSource from "./glue.py?raw";

const PYODIDE_VERSION = "0.27.2";
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

type InMsg =
  | { type: "bootstrap"; id: number; proxyUrl: string; wheelUrl: string }
  | { type: "count"; id: number; sigla: string; endpoint: string; params: Record<string, unknown> }
  | {
      type: "run";
      id: number;
      sigla: string;
      endpoint: string;
      params: Record<string, unknown>;
      paginas: number | null;
    };

interface PyodideAPI {
  loadPackage(names: string | string[]): Promise<void>;
  runPythonAsync(code: string): Promise<unknown>;
  globals: { get(name: string): any };
  toPy(obj: unknown): unknown;
  FS: { writeFile(path: string, data: Uint8Array): void };
}

let pyodide: PyodideAPI | null = null;
let booting: Promise<string> | null = null;

async function loadPyodideRuntime(): Promise<PyodideAPI> {
  const url = `${PYODIDE_INDEX}pyodide.mjs`;
  const mod = (await import(/* @vite-ignore */ url)) as { loadPyodide: (o: unknown) => Promise<PyodideAPI> };
  return mod.loadPyodide({ indexURL: PYODIDE_INDEX });
}

async function bootstrap(proxyUrl: string, wheelUrl: string): Promise<string> {
  if (!booting) {
    booting = (async () => {
      pyodide = await loadPyodideRuntime();
      await pyodide.loadPackage("micropip");
      // Baixa o wheel em JS (micropip 0.27.2 falha ao baixar wheels por URL) e
      // grava no FS do Pyodide; o glue instala via esquema emfs:.
      const wheelBytes = new Uint8Array(await (await fetch(wheelUrl)).arrayBuffer());
      const wheelPath = "/tmp/juscraper-0.3.0-py3-none-any.whl";
      pyodide.FS.writeFile(wheelPath, wheelBytes);
      await pyodide.runPythonAsync(glueSource);
      const boot = pyodide.globals.get("bootstrap");
      const version: string = await boot(proxyUrl, `emfs:${wheelPath}`);
      return version;
    })();
  }
  return booting;
}

function post(msg: unknown) {
  (self as DedicatedWorkerGlobalScope).postMessage(msg);
}

self.onmessage = async (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  try {
    if (msg.type === "bootstrap") {
      const version = await bootstrap(msg.proxyUrl, msg.wheelUrl);
      post({ type: "result", id: msg.id, payload: { version } });
      return;
    }

    if (!pyodide) throw new Error("Pyodide ainda não inicializado.");

    if (msg.type === "count") {
      const fn = pyodide.globals.get("count");
      const out = fn(msg.sigla, msg.endpoint, pyodide.toPy(msg.params)) as string;
      post({ type: "result", id: msg.id, payload: JSON.parse(out) });
      return;
    }

    if (msg.type === "run") {
      const fn = pyodide.globals.get("run");
      const progress = (done: number, total: number) =>
        post({ type: "progress", id: msg.id, done, total });
      const out = fn(
        msg.sigla,
        msg.endpoint,
        pyodide.toPy(msg.params),
        msg.paginas,
        progress
      ) as string;
      post({ type: "result", id: msg.id, payload: JSON.parse(out) });
      return;
    }
  } catch (err) {
    post({ type: "error", id: msg.id, error: String(err) });
  }
};
