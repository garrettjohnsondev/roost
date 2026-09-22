import { StringDecoder } from 'node:string_decoder';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

type Json = any;

// A single JSON-RPC line can legitimately carry megabytes (a large tool output, an embedded
// image) — but Node's `readline` accumulates the current line as one JS string via `+=`, and
// a pathological line with no trailing newline for long enough throws `RangeError: Invalid
// string length` once it exceeds V8's max string size. That's an uncaught exception with
// nothing upstream to catch it, which previously crashed the entire server — every project,
// every active session — for one oversized message on one Codex thread. This cap turns that
// hard crash into "drop the one bad line and keep going."
const MAX_BUFFERED_LINE_BYTES = 64 * 1024 * 1024;

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
  private lineBuffer = '';
  /** Reassembles multi-byte characters split across chunks. toString('utf8')
   *  per chunk corrupted any non-ASCII text that straddled a boundary. */
  private decoder = new StringDecoder('utf8');

  constructor(command: string, args: string[], cwd: string, private handlers: JsonRpcHandlers) {
    // The agent subprocess has no business holding Pocket's own auth secret.
    const env = { ...process.env };
    delete env.POCKET_TOKEN;
    this.child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', (chunk: Buffer) => this.onStdoutData(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (this.debug) console.error('[codex stderr]', text.trimEnd());
      this.stderrTail.push(text);
      if (this.stderrTail.length > 40) this.stderrTail.shift();
    });
    // A write racing the child's death raises EPIPE on stdin; with no listener
    // that is an uncaught 'error' event, which kills the server.
    this.child.stdin.on('error', (err) => {
      if (this.debug) console.error('[codex stdin]', err.message);
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

  private onStdoutData(chunk: Buffer) {
    this.lineBuffer += this.decoder.write(chunk);
    if (this.lineBuffer.length > MAX_BUFFERED_LINE_BYTES) {
      console.error(`[codex] dropping oversized unterminated line (${this.lineBuffer.length} bytes) — no newline seen`);
      this.lineBuffer = '';
      return;
    }
    let newlineIndex: number;
    while ((newlineIndex = this.lineBuffer.indexOf('\n')) !== -1) {
      const line = this.lineBuffer.slice(0, newlineIndex);
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
      this.onLine(line);
    }
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
    if (this.child.stdin.destroyed || !this.child.stdin.writable) return; // exit handler rejects the pending request
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
