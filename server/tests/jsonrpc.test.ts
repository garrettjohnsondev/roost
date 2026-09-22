import { afterEach, describe, expect, it } from 'vitest';
import { JsonRpcProcess } from '../src/jsonrpc.js';

// TS `private` is erased at runtime — drive onStdoutData() directly with synthetic
// chunks so we test the parsing logic without OS pipe timing as a confound. The spawned
// `sleep` child exists only to satisfy the constructor.
function makeProc(onNotification: (method: string) => void) {
  return new JsonRpcProcess('sleep', ['5'], process.cwd(), {
    onRequest: async () => ({}),
    onNotification,
    onExit: () => {},
  }) as any;
}

const line = (obj: unknown) => Buffer.from(JSON.stringify(obj) + '\n');

let procs: any[] = [];
afterEach(() => {
  for (const p of procs) p.kill();
  procs = [];
});

describe('JsonRpcProcess stdout parsing', () => {
  it('parses complete lines and lines split across chunks', () => {
    const seen: string[] = [];
    const proc = makeProc((m) => seen.push(m));
    procs.push(proc);

    proc.onStdoutData(line({ jsonrpc: '2.0', method: 'one', params: {} }));
    const two = JSON.stringify({ jsonrpc: '2.0', method: 'two', params: {} }) + '\n';
    proc.onStdoutData(Buffer.from(two.slice(0, 10)));
    proc.onStdoutData(Buffer.from(two.slice(10)));
    expect(seen).toEqual(['one', 'two']);
  });

  it('drops an oversized unterminated line instead of crashing, then keeps parsing', () => {
    const seen: string[] = [];
    const proc = makeProc((m) => seen.push(m));
    procs.push(proc);

    proc.onStdoutData(line({ jsonrpc: '2.0', method: 'before', params: {} }));
    const chunk10mb = Buffer.alloc(10 * 1024 * 1024, 'x');
    for (let i = 0; i < 8; i++) proc.onStdoutData(chunk10mb); // 80MB, no newline
    proc.onStdoutData(Buffer.from('\n')); // pathological line finally ends
    proc.onStdoutData(line({ jsonrpc: '2.0', method: 'after', params: {} }));

    expect(seen).toEqual(['before', 'after']);
  });

  it('matches responses to pending requests', async () => {
    const proc = makeProc(() => {});
    procs.push(proc);

    const pending = proc.request('some/method', {});
    proc.onStdoutData(line({ jsonrpc: '2.0', id: 1, result: { ok: true } }));
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('rejects a request when the response carries an error', async () => {
    const proc = makeProc(() => {});
    procs.push(proc);

    const pending = proc.request('some/method', {});
    proc.onStdoutData(line({ jsonrpc: '2.0', id: 1, error: { message: 'nope' } }));
    await expect(pending).rejects.toThrow('nope');
  });
});

describe('JsonRpcProcess stdout decoding', () => {
  it('reassembles a multi-byte character split across chunks', () => {
    // toString('utf8') per chunk turned the two halves of 'é' into U+FFFD
    // replacement characters, corrupting any non-ASCII text on a boundary.
    const seen: string[] = [];
    const proc = makeProc((m) => seen.push(m));
    procs.push(proc);
    const buf = Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'héllo → wörld', params: {} }) + '\n');
    const cut = buf.indexOf(Buffer.from('é')) + 1; // inside the 2-byte sequence
    proc.onStdoutData(buf.subarray(0, cut));
    proc.onStdoutData(buf.subarray(cut));
    expect(seen).toEqual(['héllo → wörld']);
  });
});
