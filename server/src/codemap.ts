/**
 * The code map: a pre-built index of a project's symbols and who calls whom,
 * so a crew member asking "how does X work" gets the answer in one lookup
 * instead of a grep → read → read → read loop that re-derives the same
 * structure on every turn, paid for in tokens each time.
 *
 * Idea and tool shape learned from CodeGraph (github.com/colbymchenry/codegraph,
 * MIT, © Colby McHenry): one "explore" call returning the relevant symbols'
 * verbatim source, the call paths between them and a blast radius. This is
 * Roost's own, smaller version: TypeScript/JavaScript only, parsed with the
 * TypeScript compiler (no native parts, nothing to install), built in-process
 * so every Roost install has it with no setup.
 *
 * Freshness without file watchers: every query stats the project's files and
 * re-parses only the ones whose mtime or size moved. Stat-ing a few hundred
 * files costs milliseconds; a watcher per project costs a process each and
 * goes stale silently when it dies.
 */
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';

export type SymbolKind = 'function' | 'class' | 'method' | 'interface' | 'type' | 'enum' | 'variable' | 'component';

export interface CodeSymbol {
  id: string; // `${file}#${qualifiedName}`
  name: string;
  /** Class.method for members, plain name otherwise. */
  qualified: string;
  kind: SymbolKind;
  file: string; // relative to the project root, forward slashes
  line: number; // 1-based
  endLine: number;
  exported: boolean;
  /** Only set for members: the enclosing class. */
  container?: string;
  /** Stemmed words from the symbol's comments, identifiers and strings --
   *  what lets "how does a restart get reported" find code whose NAME never
   *  says restart. Not set for classes: their members carry their own. */
  bag?: string[];
}

interface RawCall {
  from: string; // symbol id
  /** Plain `foo()` / `<Foo>` / `new Foo()`: a name resolved through scope and imports. */
  name?: string;
  /** `x.foo()`: only the member name is known without a type checker. */
  member?: string;
  /** `this.foo()` inside a class: resolved against that class first. */
  thisClass?: string;
  /** `R.foo()` with a plain identifier receiver: an import, a class, or a global. */
  receiver?: string;
  line: number;
}

interface ImportBinding {
  module: string; // the specifier as written
  imported: string; // 'default', '*', or the exported name
}

interface FileExtract {
  mtimeMs: number;
  size: number;
  symbols: CodeSymbol[];
  imports: Record<string, ImportBinding>; // local name → where it came from
  /** export { a as b } from './x' and export * from './x' */
  reexports: Array<{ module: string; imported: string; exported: string }>;
  calls: RawCall[];
}

export interface Edge {
  from: string;
  to: string;
  line: number;
  /** Member-name guesses (x.foo() with more than one foo) are kept but marked. */
  guess?: boolean;
}

export interface CodeMap {
  root: string;
  files: Map<string, FileExtract>;
  symbols: Map<string, CodeSymbol>;
  byName: Map<string, CodeSymbol[]>;
  callees: Map<string, Edge[]>;
  callers: Map<string, Edge[]>;
  builtAt: number;
}

/** Receivers that are never project code: `Object.create()` must not become
 *  a call to the one project method that happens to be named create. */
const GLOBALS = new Set([
  'Object', 'Math', 'JSON', 'Array', 'Promise', 'console', 'Date', 'Number', 'String', 'Boolean', 'Symbol', 'Reflect', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'window', 'document', 'process', 'Buffer', 'URL', 'URLSearchParams', 'crypto', 'navigator', 'location', 'history',
  'localStorage', 'sessionStorage', 'performance', 'Intl', 'RegExp', 'Error', 'globalThis', 'React', 'fs', 'path', 'os', 'require', 'module',
  'exports', 'self', 'Atomics', 'BigInt', 'Proxy', 'ArrayBuffer', 'DataView', 'TextEncoder', 'TextDecoder', 'AbortController', 'Response',
  'Request', 'Headers', 'FormData', 'Blob', 'File', 'Image', 'Notification', 'Worker', 'z', 'vi', 'expect', 'describe', 'it', 'test',
]);

const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const MAX_BYTES = 400_000;
/** Member names so common on built-ins that a project method sharing the name
 *  would collect every array/promise/map call in the codebase as a caller. */
const BUILTIN_MEMBERS = new Set([
  'map', 'filter', 'reduce', 'forEach', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every', 'push', 'pop', 'shift', 'unshift',
  'slice', 'splice', 'concat', 'join', 'split', 'includes', 'indexOf', 'sort', 'reverse', 'flat', 'flatMap', 'keys', 'values', 'entries',
  'get', 'set', 'has', 'delete', 'add', 'clear', 'then', 'catch', 'finally', 'toString', 'valueOf', 'trim', 'replace', 'match', 'test',
  'startsWith', 'endsWith', 'toLowerCase', 'toUpperCase', 'padStart', 'padEnd', 'log', 'warn', 'error', 'info', 'debug', 'send', 'on',
  'off', 'once', 'emit', 'close', 'write', 'end', 'json', 'parse', 'stringify', 'call', 'apply', 'bind', 'resolve', 'reject', 'next',
  'addEventListener', 'removeEventListener', 'querySelector', 'setTimeout', 'clearTimeout', 'now', 'max', 'min', 'floor', 'round',
]);

function listFiles(root: string): string[] {
  // git ls-files respects .gitignore (node_modules, dist, build output) and
  // includes untracked-but-not-ignored files so brand-new work is mapped too.
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\0').filter((f) => f && EXTS.has(extname(f)) && !f.endsWith('.d.ts') && !/(^|\/)(node_modules|dist|build)\//.test(f) && !/\.min\.[cm]?js$/.test(f));
  } catch {
    return []; // not a git repo: no map rather than a walk of everything under it
  }
}

function scriptKind(file: string): ts.ScriptKind {
  const e = extname(file);
  if (e === '.tsx') return ts.ScriptKind.TSX;
  if (e === '.jsx') return ts.ScriptKind.JSX;
  if (e === '.js' || e === '.mjs' || e === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

const hasExport = (n: ts.Node) =>
  ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const isComponentName = (name: string) => /^[A-Z]/.test(name);

/** Symbols, imports and raw call sites from one file -- syntax only, no type checker, so each file stands alone and caches by mtime. */
export function extractFile(file: string, text: string): Omit<FileExtract, 'mtimeMs' | 'size'> {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const symbols: CodeSymbol[] = [];
  // No prototype: a call named toString() or constructor() must not find
  // Object.prototype's function where an import binding would be.
  const imports: Record<string, ImportBinding> = Object.create(null);
  const reexports: FileExtract['reexports'] = [];
  const calls: RawCall[] = [];
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const exportedNames = new Set<string>();

  const add = (name: string, kind: SymbolKind, node: ts.Node, exported: boolean, container?: string): CodeSymbol => {
    const qualified = container ? `${container}.${name}` : name;
    const s: CodeSymbol = { id: `${file}#${qualified}`, name, qualified, kind, file, line: lineOf(node.getStart(sf)), endLine: lineOf(node.getEnd()), exported, container };
    if (node !== sf) {
      // A class's body is its members' business; its own comment still says what it is for.
      const end = kind === 'class' ? node.getStart(sf) : Math.min(node.getEnd(), node.getFullStart() + 8000);
      s.bag = [...new Set(words(text.slice(node.getFullStart(), end)).map(stem))].slice(0, 600);
    }
    // Overloads and re-declarations share an id; the first (usually the implementation's signature) wins.
    if (!symbols.some((x) => x.id === s.id)) symbols.push(s);
    return s;
  };

  const functionLike = (init: ts.Node | undefined): init is ts.ArrowFunction | ts.FunctionExpression =>
    !!init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));

  /** Walk a body, recording calls against `owner`; nested named functions become their own symbols. */
  const walkBody = (node: ts.Node, owner: CodeSymbol | undefined, thisClass?: string) => {
    const visit = (n: ts.Node): void => {
      if (owner) {
        if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
          const callee = n.expression;
          const line = lineOf(n.getStart(sf));
          if (ts.isIdentifier(callee)) calls.push({ from: owner.id, name: callee.text, line });
          else if (ts.isPropertyAccessExpression(callee)) {
            const member = callee.name.text;
            const recv = callee.expression;
            if (recv.kind === ts.SyntaxKind.ThisKeyword) calls.push({ from: owner.id, member, thisClass, line });
            else if (ts.isIdentifier(recv)) {
              if (!GLOBALS.has(recv.text)) calls.push({ from: owner.id, member, receiver: recv.text, line });
            } else if (!BUILTIN_MEMBERS.has(member)) calls.push({ from: owner.id, member, line });
          }
        } else if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
          const tag = n.tagName;
          if (ts.isIdentifier(tag) && isComponentName(tag.text)) calls.push({ from: owner.id, name: tag.text, line: lineOf(n.getStart(sf)) });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
  };

  const topLevel = (stmt: ts.Statement) => {
    const exported = hasExport(stmt);
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const s = add(stmt.name.text, isComponentName(stmt.name.text) && /tsx|jsx/.test(file) ? 'component' : 'function', stmt, exported);
      if (stmt.body) walkBody(stmt.body, s);
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      const cls = stmt.name.text;
      const s = add(cls, 'class', stmt, exported);
      for (const m of stmt.members) {
        const mname = m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) || ts.isPrivateIdentifier(m.name)) ? m.name.text : undefined;
        if ((ts.isMethodDeclaration(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m)) && mname) {
          const ms = add(mname, 'method', m, exported, cls);
          if (m.body) walkBody(m.body, ms, cls);
        } else if (ts.isConstructorDeclaration(m) && m.body) {
          walkBody(m.body, add('constructor', 'method', m, exported, cls), cls);
        } else if (ts.isPropertyDeclaration(m) && mname && functionLike(m.initializer)) {
          walkBody(m.initializer, add(mname, 'method', m, exported, cls), cls);
        } else if (ts.isPropertyDeclaration(m) && m.initializer) {
          walkBody(m.initializer, s, cls); // field initialisers run as the class
        }
      }
    } else if (ts.isInterfaceDeclaration(stmt)) {
      add(stmt.name.text, 'interface', stmt, exported);
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      add(stmt.name.text, 'type', stmt, exported);
    } else if (ts.isEnumDeclaration(stmt)) {
      add(stmt.name.text, 'enum', stmt, exported);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const name = d.name.text;
        const fn = functionLike(d.initializer);
        const kind: SymbolKind = fn ? (isComponentName(name) && /tsx|jsx/.test(file) ? 'component' : 'function') : 'variable';
        const s = add(name, kind, stmt.declarationList.declarations.length === 1 ? stmt : d, exported);
        if (d.initializer) walkBody(d.initializer, s);
      }
    } else if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const module = stmt.moduleSpecifier.text;
      const clause = stmt.importClause;
      if (clause?.name) imports[clause.name.text] = { module, imported: 'default' };
      const nb = clause?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) imports[nb.name.text] = { module, imported: '*' };
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) imports[el.name.text] = { module, imported: (el.propertyName ?? el.name).text };
    } else if (ts.isExportDeclaration(stmt)) {
      const module = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : undefined;
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          if (module) reexports.push({ module, imported: (el.propertyName ?? el.name).text, exported: el.name.text });
          else exportedNames.add((el.propertyName ?? el.name).text);
        }
      } else if (module && !stmt.exportClause) reexports.push({ module, imported: '*', exported: '*' });
    } else if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) {
      exportedNames.add(stmt.expression.text);
      imports['default'] ??= { module: '.', imported: stmt.expression.text }; // `export default foo` — resolved as a self-alias
    } else if (ts.isExpressionStatement(stmt)) {
      // Top-level code (router.get(...), app.listen(...)) calls into the project too.
      const mod = symbols.find((x) => x.qualified === '(module)') ?? add('(module)', 'variable', sf, false);
      mod.line = 1;
      walkBody(stmt, mod);
    }
  };

  for (const stmt of sf.statements) topLevel(stmt);
  for (const s of symbols) if (!s.container && exportedNames.has(s.name)) s.exported = true;
  // `export default function Foo` is both a named symbol and the default export.
  for (const stmt of sf.statements) {
    if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name && ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
      imports['default'] = { module: '.', imported: stmt.name.text };
    }
  }
  return { symbols, imports, reexports, calls };
}

// ---------------------------------------------------------------------------

const maps = new Map<string, CodeMap>();

/** Relative import specifier → project file, the way TS/bundlers would find it. */
function resolveModule(files: Map<string, FileExtract>, fromFile: string, spec: string): string | undefined {
  if (!spec.startsWith('.')) return undefined; // packages are outside the map
  const base = normalize(join(dirname(fromFile), spec)).replace(/\\/g, '/');
  // ESM TS writes './x.js' for './x.ts'.
  const stem = base.replace(/\.(m|c)?js$/, '');
  const tries = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs'].flatMap((e) => [stem + e]), ...['index.ts', 'index.tsx', 'index.js', 'index.jsx'].map((i) => `${stem}/${i}`)];
  return tries.find((t) => files.has(t));
}

/** An exported name in a file → the symbol, following re-exports (bounded, cycles ignored). */
function findExport(map: CodeMap, file: string, name: string, depth = 0): CodeSymbol | undefined {
  if (depth > 4) return undefined;
  const fx = map.files.get(file);
  if (!fx) return undefined;
  if (name === 'default') {
    const alias = fx.imports['default'];
    if (alias?.module === '.') name = alias.imported;
    else return undefined;
  }
  const own = fx.symbols.find((s) => !s.container && s.name === name && s.exported);
  if (own) return own;
  // import { x } from './a'; export { x } — an exported local import
  const imp = fx.imports[name];
  if (imp && imp.module !== '.') {
    const target = resolveModule(map.files, file, imp.module);
    if (target) {
      const hit = findExport(map, target, imp.imported, depth + 1);
      if (hit) return hit;
    }
  }
  for (const r of fx.reexports) {
    if (r.exported !== name && r.exported !== '*') continue;
    const target = resolveModule(map.files, file, r.module);
    if (!target) continue;
    const hit = findExport(map, target, r.exported === '*' ? name : r.imported, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

function resolveEdges(map: CodeMap): void {
  map.callees = new Map();
  map.callers = new Map();
  const push = (m: Map<string, Edge[]>, k: string, e: Edge) => {
    const a = m.get(k);
    if (a) a.push(e);
    else m.set(k, [e]);
  };
  const membersByName = new Map<string, CodeSymbol[]>();
  for (const s of map.symbols.values()) {
    if (s.container) {
      const a = membersByName.get(s.name);
      if (a) a.push(s);
      else membersByName.set(s.name, [s]);
    }
  }
  for (const [file, fx] of map.files) {
    const local = new Map(fx.symbols.filter((s) => !s.container).map((s) => [s.name, s]));
    const seen = new Set<string>();
    for (const c of fx.calls) {
      let targets: CodeSymbol[] = [];
      let guess = false;
      if (c.name) {
        const own = local.get(c.name);
        if (own) targets = [own];
        else {
          const imp = fx.imports[c.name];
          if (imp && imp.module !== '.') {
            const target = resolveModule(map.files, file, imp.module);
            const hit = target && findExport(map, target, imp.imported);
            if (hit) targets = [hit];
          }
        }
        // A global or an import the resolver can't follow (path aliases):
        // take it only when the name is unique in the project.
        if (!targets.length && !fx.imports[c.name]) {
          const all = (map.byName.get(c.name) ?? []).filter((s) => !s.container && s.kind !== 'variable' && s.kind !== 'type' && s.kind !== 'interface');
          if (all.length === 1) targets = all;
        }
      } else if (c.member && c.receiver) {
        const imp = fx.imports[c.receiver];
        if (imp && imp.module !== '.') {
          // A package's API, or a project module/class reached through its import.
          const target = resolveModule(map.files, file, imp.module);
          if (target) {
            if (imp.imported === '*') {
              const hit = findExport(map, target, c.member);
              if (hit) targets = [hit];
            } else {
              const cls = findExport(map, target, imp.imported);
              const m = cls && map.symbols.get(`${cls.file}#${cls.name}.${c.member}`);
              if (m) targets = [m];
            }
          }
        } else {
          const cls = local.get(c.receiver);
          const m = cls?.kind === 'class' ? map.symbols.get(`${file}#${cls.name}.${c.member}`) : undefined;
          if (m) targets = [m];
          else if (!cls && !BUILTIN_MEMBERS.has(c.member)) {
            // A local value (session.notice()): only the member name is known.
            const cands = membersByName.get(c.member) ?? [];
            if (cands.length === 1) targets = cands;
            else if (cands.length > 1 && cands.length <= 3) {
              targets = cands;
              guess = true;
            }
          }
        }
      } else if (c.member) {
        if (c.thisClass) {
          const own = map.symbols.get(`${file}#${c.thisClass}.${c.member}`);
          if (own) targets = [own];
        }
        if (!targets.length) {
          const cands = membersByName.get(c.member) ?? [];
          if (cands.length === 1) targets = cands;
          else if (cands.length > 1 && cands.length <= 3) {
            targets = cands;
            guess = true;
          }
        }
      }
      for (const t of targets) {
        if (t.id === c.from) continue; // recursion adds nothing to a map
        const key = `${c.from}>${t.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const e: Edge = { from: c.from, to: t.id, line: c.line, guess: guess || undefined };
        push(map.callees, c.from, e);
        push(map.callers, t.id, e);
      }
    }
  }
}

/** The map for a project, brought up to date with the files on disk. Cheap when nothing changed. */
export function getCodeMap(root: string): CodeMap {
  const prev = maps.get(root);
  const files = new Map<string, FileExtract>();
  let changed = !prev;
  for (const f of listFiles(root)) {
    let st;
    try {
      st = statSync(join(root, f));
    } catch {
      continue;
    }
    if (st.size > MAX_BYTES) continue;
    const old = prev?.files.get(f);
    if (old && old.mtimeMs === st.mtimeMs && old.size === st.size) {
      files.set(f, old);
      continue;
    }
    changed = true;
    try {
      files.set(f, { mtimeMs: st.mtimeMs, size: st.size, ...extractFile(f, readFileSync(join(root, f), 'utf8')) });
    } catch {
      /* unreadable or unparseable: leave it out rather than fail the map */
    }
  }
  if (prev && !changed && prev.files.size === files.size) return prev;
  const map: CodeMap = { root, files, symbols: new Map(), byName: new Map(), callees: new Map(), callers: new Map(), builtAt: Date.now() };
  for (const fx of files.values()) {
    for (const s of fx.symbols) {
      map.symbols.set(s.id, s);
      const a = map.byName.get(s.name);
      if (a) a.push(s);
      else map.byName.set(s.name, [s]);
    }
  }
  resolveEdges(map);
  maps.set(root, map);
  return map;
}

// ---------------------------------------------------------------------------
// Queries

const STOP = new Set(['how', 'does', 'do', 'the', 'a', 'an', 'is', 'are', 'what', 'where', 'when', 'why', 'which', 'who', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'it', 'this', 'that', 'with', 'from', 'by', 'work', 'works', 'get', 'gets', 'happen', 'happens', 'handled', 'handle', 'code', 'function', 'find', 'show', 'me', 'x', 'y', 'reach', 'reaches', 'flow', 'called', 'call', 'calls', 'used', 'use']);

/** "handleClientMessage" → ["handle","client","message"]; "gate_fingerprint" → ["gate","fingerprint"]. */
export function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '') || w;

function scoreSymbol(s: CodeSymbol, idents: Set<string>, terms: string[]): number {
  if (s.name === '(module)') return 0;
  let score = 0;
  if (idents.has(s.name) || idents.has(s.qualified)) score += 100;
  const nameWords = words(s.name).map(stem);
  const bag = s.bag ? new Set(s.bag) : undefined;
  const pathWords = words(s.file).map(stem);
  const ctrWords = s.container ? words(s.container).map(stem) : [];
  for (const t of terms) {
    if (nameWords.includes(t)) score += 10;
    else if (nameWords.some((w) => w.startsWith(t) || t.startsWith(w))) score += 4;
    if (ctrWords.includes(t)) score += 3;
    if (pathWords.includes(t)) score += 2;
    if (bag?.has(t)) score += 2;
  }
  if (score === 0) return 0;
  const matched = terms.filter((t) => nameWords.includes(t) || bag?.has(t)).length;
  if (terms.length > 1) score *= 0.5 + matched / terms.length; // covering more of the question beats one loud word
  if (/(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(s.file) && !terms.includes('test')) score *= 0.4;
  if (s.kind === 'function' || s.kind === 'method' || s.kind === 'component' || s.kind === 'class') score += 1;
  if (s.exported) score += 0.5;
  return score;
}

export function search(map: CodeMap, query: string, limit = 12): CodeSymbol[] {
  // Exact names: camelCase/Class.method/snake_case tokens, or a plain word
  // that IS a project symbol -- but never "a", "get" or other question words.
  const idents = new Set(
    (query.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?/g) ?? []).filter(
      (w) => w.length >= 3 && !STOP.has(w.toLowerCase()) && (/[A-Z_$]|\./.test(w.slice(1)) || (w.length >= 5 && map.byName.has(w))),
    ),
  );
  const terms = [...new Set(words(query).filter((w) => !STOP.has(w) && w.length > 1).map(stem))];
  const scored: Array<[CodeSymbol, number]> = [];
  for (const s of map.symbols.values()) {
    const sc = scoreSymbol(s, idents, terms);
    if (sc > 0) scored.push([s, sc + Math.min(3, (map.callers.get(s.id)?.length ?? 0) * 0.2)]);
  }
  scored.sort((a, b) => b[1] - a[1] || a[0].file.localeCompare(b[0].file) || a[0].line - b[0].line);
  return scored.slice(0, limit).map(([s]) => s);
}

function sourceOf(map: CodeMap, s: CodeSymbol, maxLines: number): string {
  let text: string;
  try {
    text = readFileSync(join(map.root, s.file), 'utf8');
  } catch {
    return '(file unreadable)';
  }
  const lines = text.split('\n');
  const start = s.line - 1;
  const end = Math.min(s.endLine, lines.length);
  const take = Math.min(end - start, maxLines);
  const out = lines.slice(start, start + take).map((l, i) => `${String(start + i + 1).padStart(5)}  ${l}`);
  if (end - start > take) out.push(`      … ${end - start - take} more lines (to ${s.file}:${s.endLine})`);
  return out.join('\n');
}

const where = (s: CodeSymbol, line?: number) => `${s.file}:${line ?? s.line}`;

/** Every symbol that reaches `id` through calls, nearest first, up to `depth` hops. */
export function impact(map: CodeMap, id: string, depth = 3): Array<{ symbol: CodeSymbol; hops: number }> {
  const out: Array<{ symbol: CodeSymbol; hops: number }> = [];
  const seen = new Set([id]);
  let frontier = [id];
  for (let hop = 1; hop <= depth && frontier.length; hop++) {
    const next: string[] = [];
    for (const f of frontier) {
      for (const e of map.callers.get(f) ?? []) {
        if (e.guess || seen.has(e.from)) continue; // a name-only guess is shown, never propagated
        seen.add(e.from);
        const s = map.symbols.get(e.from);
        if (s) out.push({ symbol: s, hops: hop });
        next.push(e.from);
      }
    }
    frontier = next;
  }
  return out;
}

/** Shortest call path a → b, if one exists within `max` hops. */
function path(map: CodeMap, a: string, b: string, max = 4): string[] | null {
  const prevOf = new Map<string, string>([[a, '']]);
  let frontier = [a];
  for (let d = 0; d < max && frontier.length; d++) {
    const next: string[] = [];
    for (const f of frontier) {
      for (const e of map.callees.get(f) ?? []) {
        if (prevOf.has(e.to)) continue;
        prevOf.set(e.to, f);
        if (e.to === b) {
          const chain = [b];
          let cur = f;
          while (cur) {
            chain.unshift(cur);
            cur = prevOf.get(cur) ?? '';
          }
          return chain;
        }
        next.push(e.to);
      }
    }
    frontier = next;
  }
  return null;
}

/** The one-call answer: the relevant symbols' source grouped by file, who
 *  calls them and what they call, the call paths between them, and what
 *  changing the top one would touch. Budgeted, so it never floods context. */
export function explore(root: string, query: string, budgetChars = 14_000): string {
  const map = getCodeMap(root);
  if (!map.files.size) return 'The code map is empty here: no TypeScript/JavaScript files under git in this project. Use Grep/Read instead.';
  const hits = search(map, query, 16);
  if (!hits.length) return `Nothing in the code map matches "${query}" (${map.symbols.size} symbols across ${map.files.size} files). Try the exact function or class name, or fall back to Grep.`;

  const exact = hits.filter((s) => query.includes(s.name) && words(query).length <= 3);
  const primary = (exact.length ? exact : hits).slice(0, exact.length === 1 ? 1 : 5);
  const perSymbolLines = primary.length === 1 ? 400 : primary.length <= 3 ? 80 : 45;

  const out: string[] = [];
  out.push(`# Code map: "${query}"`);
  out.push(`${map.symbols.size} symbols · ${map.files.size} files · current with the files on disk. Line numbers below are exact; edit from them without re-reading unless you need more.`);

  const byFile = new Map<string, CodeSymbol[]>();
  for (const s of primary) {
    const a = byFile.get(s.file);
    if (a) a.push(s);
    else byFile.set(s.file, [s]);
  }
  let used = out.join('\n').length;
  for (const [file, syms] of byFile) {
    out.push(`\n## ${file}`);
    for (const s of syms) {
      const callers = map.callers.get(s.id) ?? [];
      const callees = map.callees.get(s.id) ?? [];
      const block: string[] = [];
      block.push(`\n### ${s.qualified} (${s.kind}${s.exported ? ', exported' : ''}) — lines ${s.line}–${s.endLine}`);
      block.push('```');
      block.push(sourceOf(map, s, perSymbolLines));
      block.push('```');
      if (callers.length) {
        block.push(`Called by (${callers.length}): ` + callers.slice(0, 10).map((e) => {
          const c = map.symbols.get(e.from);
          return c ? `${c.qualified} @ ${c.file}:${e.line}${e.guess ? ' (by method name)' : ''}` : '';
        }).filter(Boolean).join('; ') + (callers.length > 10 ? `; +${callers.length - 10} more` : ''));
      } else block.push('Called by: nothing found in the project (an entry point, a callback passed by reference, or called dynamically).');
      if (callees.length) {
        block.push(`Calls (${callees.length}): ` + callees.slice(0, 12).map((e) => {
          const c = map.symbols.get(e.to);
          return c ? `${c.qualified} (${where(c)})${e.guess ? ' ?' : ''}` : '';
        }).filter(Boolean).join('; ') + (callees.length > 12 ? `; +${callees.length - 12} more` : ''));
      }
      const text = block.join('\n');
      if (used + text.length > budgetChars && out.length > 3) {
        out.push(`\n### ${s.qualified} — ${where(s)} (source omitted: over budget; ask for it by name)`);
        continue;
      }
      used += text.length;
      out.push(text);
    }
  }

  const paths: string[] = [];
  for (const a of primary) {
    for (const b of primary) {
      if (a === b) continue;
      const p = path(map, a.id, b.id);
      if (p && p.length > 2) paths.push(p.map((id) => map.symbols.get(id)?.qualified ?? id).join(' → '));
      else if (p) paths.push(`${a.qualified} → ${b.qualified}`);
    }
  }
  if (paths.length) out.push(`\n## Call paths\n` + [...new Set(paths)].slice(0, 8).map((p) => `- ${p}`).join('\n'));

  const top = primary[0];
  const blast = impact(map, top.id, 3);
  if (blast.length) {
    const files = new Set(blast.map((b) => b.symbol.file));
    out.push(`\n## Blast radius of ${top.qualified}\n${blast.length} symbol${blast.length === 1 ? '' : 's'} in ${files.size} file${files.size === 1 ? '' : 's'} reach it within 3 calls: ` +
      blast.slice(0, 12).map((b) => `${b.symbol.qualified} (${b.hops})`).join(', ') + (blast.length > 12 ? ', …' : ''));
  }

  const rest = hits.filter((h) => !primary.includes(h)).slice(0, 10);
  if (rest.length) out.push(`\n## Also matching\n` + rest.map((s) => `- ${s.qualified} (${s.kind}) — ${where(s)}`).join('\n'));
  return out.join('\n');
}

/** Who depends on a symbol, transitively -- the question before changing it. */
export function impactReport(root: string, name: string): string {
  const map = getCodeMap(root);
  const matches = [...map.symbols.values()].filter((s) => s.qualified === name || s.name === name);
  if (!matches.length) return `No symbol named "${name}" in the code map. Use code_explore to find the right name.`;
  const out: string[] = [];
  for (const s of matches.slice(0, 3)) {
    const blast = impact(map, s.id, 5);
    out.push(`## ${s.qualified} — ${where(s)}`);
    if (!blast.length) {
      out.push('Nothing in the project calls it (it may be an entry point, a callback, or called dynamically).');
      continue;
    }
    const files = new Set(blast.map((b) => b.symbol.file));
    out.push(`${blast.length} symbols in ${files.size} files reach it within 5 calls.`);
    for (let hop = 1; hop <= 5; hop++) {
      const at = blast.filter((b) => b.hops === hop);
      if (at.length) out.push(`- ${hop} hop${hop === 1 ? '' : 's'}: ` + at.slice(0, 25).map((b) => `${b.symbol.qualified} (${where(b.symbol)})`).join(', ') + (at.length > 25 ? ', …' : ''));
    }
  }
  return out.join('\n');
}

/** For tests and the status line: how big the map is, without a query. */
export function mapStats(root: string): { files: number; symbols: number; edges: number } {
  const m = getCodeMap(root);
  let edges = 0;
  for (const a of m.callees.values()) edges += a.length;
  return { files: m.files.size, symbols: m.symbols.size, edges };
}
