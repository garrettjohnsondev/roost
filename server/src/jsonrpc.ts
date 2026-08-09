import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

type Json = any;

export interface JsonRpcHandlers {
  /** Server -> client request (must be answered). Return the result object. */
  onRequest: (method: string, params: Json) => Promise<Json>;
  onNotification: (method: string, params: Json) => void;
  onExit: (code: number | null, stderrTail: string) => void;
}

/** Newline-delimited JSON-RPC 2.0 over a child process's stdio (codex app-server framing). */
export class JsonRpcProcess {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  private stderrTail: string[] = [];
  private debug = process.env.DEBUG_CODEX === '1';

  constructor(command: string, args: string[], cwd: string, private handlers: JsonRpcHandlers) {
    this.child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const rl = createInterface({ input: this.child.stdout });
    rl.on('line', (line) => this.onLine(line));
    this.child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (this.debug) console.error('[codex stderr]', text.trimEnd());
      this.stderrTail.push(text);
      if (this.stderrTail.length > 40) this.stderrTail.shift();
    });
    this.child.on('exit', (code) => {
      const tail = this.stderrTail.join('').slice(-2000);
      for (const [, p] of this.pending) p.reject(new Error(`codex app-server exited (code ${code})`));
      this.pending.clear();
      handlers.onExit(code, tail);
    });
    this.child.on('error', (err) => {
      for (const [, p] of this.pending) p.reject(err);
      this.pending.clear();
      handlers.onExit(null, String(err));
    });
  }

  private onLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: Json;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      if (this.debug) console.error('[codex non-json]', trimmed.slice(0, 300));
      return;
    }
    if (this.debug) console.error('[codex <-]', trimmed.slice(0, 500));

    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
        else pending.resolve(msg.result);
      }
      return;
    }
    if (msg.id !== undefined && msg.method) {
      this.handlers
        .onRequest(msg.method, msg.params)
        .then((result) => this.write({ jsonrpc: '2.0', id: msg.id, result }))
        .catch((err) => this.write({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: String(err?.message ?? err) } }));
      return;
    }
    if (msg.method) {
      this.handlers.onNotification(msg.method, msg.params);
    }
  }

  private write(obj: Json) {
    const line = JSON.stringify(obj);
    if (this.debug) console.error('[codex ->]', line.slice(0, 500));
    this.child.stdin.write(line + '\n');
  }

  request(method: string, params?: Json, timeoutMs = 60_000): Promise<Json> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`codex request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.write({ jsonrpc: '2.0', id, method, params: params ?? {} });
    });
  }

  notify(method: string, params?: Json): void {
    this.write({ jsonrpc: '2.0', method, params: params ?? {} });
  }

  kill(): void {
    try {
      this.child.kill();
    } catch {
      /* already dead */
    }
  }
}
