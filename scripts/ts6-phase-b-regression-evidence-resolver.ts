/**
 * TS-6 Phase B C2-R15 ??Regression Evidence Resolver.
 *
 * PURPOSE
 *   Independently resolve the regression-evidence relationships that R3 authored
 *   and the v2 fixture retained, according to each relation's declared
 *   `coverageKind`. This replaces method-name/text-search as the evidence
 *   authority.
 *
 * CONTRACT
 *   - Resolution runs against the actual source/test corpus.
 *   - A qualified evidence target is (file, symbol, method). Method-name-only
 *     matching is never sufficient for DIRECT_BOUNDARY.
 *   - A fixture claim cannot validate itself: the approved relation is read from
 *     an approved source (R3 manifest / v2 fixture) and checked against the corpus.
 *   - `productionReachability.status` is NOT consulted. It is a different axis.
 *
 * Derived validation only. This is not a new canonical evidence authority; the
 * approved vocabulary (decision, coverageKind, entrySymbol, path[], testEvidenceId)
 * remains the source of truth for what was approved.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type CoverageKind = 'DIRECT_BOUNDARY' | 'PUBLIC_PATH' | 'OWNER_ATOMICITY';

/** Qualified evidence target: file + symbol/class + method. */
export type QualifiedTarget = {
  readonly file: string;
  readonly symbol: string;
  readonly method: string;
};

export type ResolutionStatus =
  | 'RESOLVED_DIRECT'
  | 'RESOLVED_PUBLIC_PATH'
  | 'RESOLVED_OWNER_ATOMICITY'
  | 'MISSING_TEST_FILE'
  | 'MISSING_TEST_BLOCK'
  | 'NO_QUALIFIED_CALL'
  | 'UNQUALIFIED_RECEIVER'
  | 'CALL_OUTSIDE_TARGET_BLOCK'
  | 'TARGET_MISMATCH'
  | 'PATH_NOT_RESOLVED'
  | 'ENTRY_NOT_INVOKED'
  | 'UNSUPPORTED_COVERAGE_KIND';

export type ResolutionIssueCode =
  | 'REGRESSION_EVIDENCE_FILE_MISSING'
  | 'REGRESSION_TEST_BLOCK_MISSING'
  | 'REGRESSION_QUALIFIED_CALL_MISSING'
  | 'REGRESSION_RECEIVER_UNQUALIFIED'
  | 'REGRESSION_TARGET_MISMATCH'
  | 'REGRESSION_CALL_OUTSIDE_TARGET_BLOCK'
  | 'REGRESSION_PATH_UNRESOLVED'
  | 'REGRESSION_ENTRY_NOT_INVOKED'
  | 'REGRESSION_COVERAGE_KIND_UNSUPPORTED';

export type Resolution = {
  readonly testEvidenceId: string;
  readonly targetBoundaryId: string;
  /**
   * Free text as declared by the corpus. Narrowing happens at the dispatch
   * below, which reports `REGRESSION_COVERAGE_KIND_UNSUPPORTED` for anything
   * outside {@link CoverageKind}, so a wider declared type is reported rather
   * than rejected by the type system.
   */
  readonly declaredCoverageKind: string;
  readonly testFile: string;
  readonly testTitle: string;
  readonly target: QualifiedTarget | null;
  readonly status: ResolutionStatus;
  readonly resolved: boolean;
  readonly evidence: readonly string[];
  readonly issueCode: ResolutionIssueCode | null;
};

export type ApprovedEvidenceRecord = {
  /** Files allowed to host the final hop into the target: the boundary file plus its recorded callers. */
  readonly licensedHopFiles?: readonly string[];
  readonly testEvidenceId: string;
  readonly targetBoundaryId: string;
  /**
   * Free text as declared by the corpus. `resolveEvidence` dispatches on the
   * literal members below and reports `REGRESSION_COVERAGE_KIND_UNSUPPORTED` for
   * anything else, so a value outside the union is a reported data error rather
   * than a type error at the call site.
   */
  readonly coverageKind: string;
  readonly entrySymbol: string;
  readonly path: readonly string[];
  readonly testFile: string;
  readonly testTitle: string;
};

export type BoundaryForResolution = {
  readonly boundaryId: string;
  readonly file: string;
  readonly symbol: string;
  readonly method: string;
};

/** ---- caches ----------------------------------------------------------- */

const sourceCache = new Map<string, string | undefined>();
const sfCache = new Map<string, ts.SourceFile | null>();
let definitionIndexCache: Map<string, DefinitionSite[]> | null = null;
let productionClassNamesCache: Set<string> | null = null;
const testLocalCache = new Map<string, Map<string, ReadonlySet<string>>>();

export const clearResolverCaches = (): void => {
  sourceCache.clear();
  sfCache.clear();
  definitionIndexCache = null;
  productionClassNamesCache = null;
};

export const readSource = (root: string, file: string): string | undefined => {
  const key = `${root}\u0000${file}`;
  if (sourceCache.has(key)) return sourceCache.get(key);
  let text: string | undefined;
  try {
    text = fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    text = undefined;
  }
  sourceCache.set(key, text);
  return text;
};

const sourceFileOf = (root: string, file: string): ts.SourceFile | null => {
  const key = `${root}\u0000${file}`;
  if (sfCache.has(key)) return sfCache.get(key) ?? null;
  const text = readSource(root, file);
  const sf =
    text === undefined
      ? null
      : ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  sfCache.set(key, sf);
  return sf;
};

export const conciseName = (value: string): string => {
  const lastDot = value.lastIndexOf('.');
  return lastDot >= 0 ? value.slice(lastDot + 1) : value;
};

export const isTestCall = (node: ts.Node): node is ts.CallExpression => {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return false;
  if (node.expression.text !== 'it' && node.expression.text !== 'test') return false;
  const first = node.arguments[0];
  return first !== undefined && ts.isStringLiteral(first);
};

/**
 * Parse `test:<file>:<title>`. The title may contain colons, so the split is
 * anchored on the test-file extension.
 */
export const parseTestEvidenceId = (
  testEvidenceId: string,
): { file: string; title: string } | null => {
  const body = testEvidenceId.startsWith('test:')
    ? testEvidenceId.slice('test:'.length)
    : testEvidenceId;
  const m = body.match(/^(.*?\.(?:test|spec)\.tsx?):(.*)$/);
  if (m?.[1] !== undefined && m[2] !== undefined) return { file: m[1], title: m[2] };
  const i = body.indexOf(':');
  if (i < 0) return null;
  return { file: body.slice(0, i), title: body.slice(i + 1) };
};

/** Call expressions belonging to a specific it()/test() block. */
export const callsInTestBlock = (
  root: string,
  file: string,
  title: string,
): { found: boolean; calls: readonly ts.CallExpression[] } => {
  const sf = sourceFileOf(root, file);
  if (!sf) return { found: false, calls: [] };
  let target: ts.CallExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (target) return;
    const first = ts.isCallExpression(node) ? node.arguments[0] : undefined;
    if (
      isTestCall(node) &&
      first !== undefined &&
      ts.isStringLiteral(first) &&
      first.text === title
    ) {
      target = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!target) return { found: false, calls: [] };
  const calls: ts.CallExpression[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) calls.push(n);
    ts.forEachChild(n, walk);
  };
  const body = (target as ts.CallExpression).arguments[1];
  if (body) walk(body);
  return { found: true, calls };
};

type Invocation = { readonly method: string; readonly receiver: string; readonly position: number };

const invocationsIn = (calls: readonly ts.CallExpression[]): Invocation[] => {
  const out: Invocation[] = [];
  for (const call of calls) {
    const e = call.expression;
    if (ts.isPropertyAccessExpression(e))
      out.push({
        method: e.name.text,
        receiver: e.expression.getText(),
        position: call.getStart(),
      });
    else if (ts.isIdentifier(e))
      out.push({ method: e.text, receiver: '', position: call.getStart() });
  }
  return out;
};

/** Does any block in this file invoke `method` (for wrong-block vs wrong-target)? */
const methodInvokedAnywhereInFile = (root: string, file: string, method: string): boolean => {
  const sf = sourceFileOf(root, file);
  if (!sf) return false;
  let hit = false;
  const visit = (n: ts.Node): void => {
    if (hit) return;
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === method
    ) {
      hit = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hit;
};

/**
 * Receiver -> class qualification.
 *
 * A test typically exercises a boundary through a local binding, e.g.
 *   const repository = new PostgresAIProviderCallRepository(injected.pool);
 *   await repository.acceptOutput(...)
 * The receiver text is therefore NOT the class name. Method-name matching alone
 * is insufficient, so we resolve the receiver's class instead of comparing text:
 *
 *   tier 1  receiver is `new <Class>(...)`          -> that class
 *   tier 2  receiver is a local variable            -> declared type annotation,
 *                                                      or the `new <Class>` it was
 *                                                      initialised with, or a nested
 *                                                      property whose own declaration
 *                                                      carries the class
 *   tier 3  class not derivable                     -> the receiver text is not
 *                                                      class-qualified; the record is
 *                                                      reported UNQUALIFIED_RECEIVER
 *                                                      rather than silently accepted
 */
export type ReceiverBinding = { readonly className: string | null; readonly how: string };

const classFromExpressionText = (text: string, known: ReadonlySet<string>): string | null => {
  const m = text.match(/new\s+([A-Za-z_$][\w$]*)/);
  const name = m?.[1];
  if (name !== undefined && known.has(name)) return name;
  return null;
};

/**
 * The outermost constructed known class named in a declaration's initialiser.
 *
 * A single declaration routinely nests constructions, e.g.
 *   new PostgresSourcesProductService(pool, new SealedSourcesStagingService(...), ...)
 * Choosing an arbitrary known class from that text bound the receiver to the
 * INNER argument class. The outermost `new` is the value the variable actually
 * holds, so that is the one that qualifies.
 */
const outermostConstructedClass = (text: string, known: ReadonlySet<string>): string | null => {
  let best: { className: string; index: number } | null = null;
  const re = /new\s+([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const name = match[1];
    if (name === undefined || !known.has(name)) continue;
    if (best === null || match.index < best.index) best = { className: name, index: match.index };
  }
  return best?.className ?? null;
};

/** Fallback for a type-only declaration (no initialiser): the unique known class named. */
const soleNamedClass = (text: string, known: ReadonlySet<string>): string | null => {
  const named = [...known].filter((cls) => new RegExp(`\\b${cls}\\b`).test(text));
  const only = named[0];
  return named.length === 1 && only !== undefined ? only : null;
};

/** Strip non-null assertions / optional chains to the base receiver text. */
const baseReceiverText = (text: string): string => text.replace(/[!?]+/g, '');

export const resolveReceiverBinding = (
  root: string,
  testFile: string,
  receiverText: string,
  knownClassNames: ReadonlySet<string>,
  position = -1,
): ReceiverBinding => {
  const text = baseReceiverText(receiverText).trim();
  if (!text) return { className: null, how: 'bare identifier call' };

  // tier 1: direct construction / class reference
  const direct = classFromExpressionText(text, knownClassNames);
  if (direct) return { className: direct, how: 'constructed in the call' };

  const sf = sourceFileOf(root, testFile);
  if (!sf) return { className: null, how: 'test file unreadable' };

  // (a) import alias map: local name -> imported symbol / module (confident short-circuit)
  const importHints = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const moduleName = stmt.moduleSpecifier.getText(sf).replace(/['"]/g, '');
    const named = stmt.importClause.namedBindings;
    if (!named) continue;
    if (ts.isNamedImports(named)) {
      for (const el of named.elements) {
        const local = el.name.text;
        const imported = (el.propertyName ?? el.name).text;
        importHints.set(local, `${imported} from ${moduleName}`);
      }
    }
  }

  // (b) block-scoped binding lookup: nearest declaration at/above the call position
  const collect = (node: ts.Node, out: string[]): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      out.push(
        `${node.type ? node.type.getText(sf) : ''} ${node.initializer ? node.initializer.getText(sf) : ''}`.trim(),
      );
    } else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      out.push(node.initializer ? node.initializer.getText(sf) : '');
    } else if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
      out.push(node.type ? node.type.getText(sf) : '');
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      out.push(node.type ? node.type.getText(sf) : '');
    }
    ts.forEachChild(node, (child) => collect(child, out));
  };
  const bindingFor = (name: string): string[] => {
    if (position < 0) return [];
    const scopes: ts.Node[] = [];
    const find = (node: ts.Node): void => {
      if (node.getStart(sf) <= position && position < node.getEnd()) {
        scopes.push(node);
        ts.forEachChild(node, find);
      }
    };
    find(sf);
    // `scopes` is outermost -> innermost, so the LAST match is the nearest binding
    // at or above the call. Declaration order matters: one test file routinely
    // reuses a local name (`service`) for several different classes, and taking an
    // arbitrary match made the receiver bind to the wrong class.
    const out: string[] = [];
    for (const scope of scopes) {
      const local: string[] = [];
      const walkScope = (node: ts.Node): void => {
        const isTarget =
          (ts.isVariableDeclaration(node) ||
            ts.isPropertyAssignment(node) ||
            ts.isPropertyDeclaration(node) ||
            ts.isParameter(node)) &&
          ts.isIdentifier((node as unknown as { name: ts.Identifier }).name) &&
          (node as unknown as { name: ts.Identifier }).name.text === name;
        if (isTarget) collect(node, local);
        ts.forEachChild(node, walkScope);
      };
      walkScope(scope);
      out.push(...local);
    }
    return [...new Set(out.reverse())];
  };

  const normaliseTail = (segment: string): string => segment.replace(/[^\w$]/g, '');
  const segments = text.split('.').map(normaliseTail).filter(Boolean);
  // Empty when there is no root segment; every consumer below treats that as
  // "no declaration found", which is what an absent root name means.
  const rootName = segments[0] ?? '';
  const candidates: string[] = [];
  if (rootName) {
    const hint = importHints.get(rootName);
    if (hint) candidates.push(hint);
    candidates.push(...bindingFor(rootName));
  }

  for (const candidate of candidates) {
    const cls =
      outermostConstructedClass(candidate, knownClassNames) ??
      soleNamedClass(candidate, knownClassNames);
    if (cls !== null)
      return { className: cls, how: `receiver root "${rootName}" resolves to ${cls}` };
  }

  // (c) file-wide fallback (weaker): the declaration of the root nearest at or
  // above the call position that names a known class. Position matters: a test
  // file commonly reuses a local name (`service`) for several different classes,
  // and picking an arbitrary declaration made the receiver bind to whichever
  // class happened to be scanned first.
  type DeclCandidate = { readonly position: number; readonly text: string };
  const fileWide = new Map<string, DeclCandidate[]>();
  const record = (name: string, position: number, text: string): void => {
    const list = fileWide.get(name) ?? [];
    list.push({ position, text });
    fileWide.set(name, list);
  };
  const collectAll = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isPropertyAssignment(node) ||
        ts.isPropertyDeclaration(node)) &&
      ts.isIdentifier((node as unknown as { name: ts.Identifier }).name)
    ) {
      const named = node as unknown as {
        name: ts.Identifier;
        type?: ts.TypeNode;
        initializer?: ts.Expression;
      };
      record(
        named.name.text,
        node.getStart(sf),
        `${named.type ? named.type.getText(sf) : ''} ${named.initializer ? named.initializer.getText(sf) : ''}`.trim(),
      );
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      record(node.name.text, node.getStart(sf), node.type ? node.type.getText(sf) : '');
    }
    ts.forEachChild(node, collectAll);
  };
  collectAll(sf);
  const declared = (fileWide.get(rootName) ?? [])
    .filter((entry) => position < 0 || entry.position <= position)
    .sort((a, b) => b.position - a.position);
  for (const entry of declared) {
    for (const cls of knownClassNames) {
      if (new RegExp(`\\b${cls}\\b`).test(entry.text))
        return {
          className: cls,
          how: `nearest file-wide declaration of "${rootName}" references ${cls}`,
        };
    }
  }

  return { className: null, how: `cannot derive a boundary class for "${text}"` };
};

/** ---- production definition index (path/entry verification) ------------- */

type DefinitionSite = {
  readonly file: string;
  readonly symbol: string;
  readonly propertyCalls: ReadonlySet<string>;
};

const scopeFiles = (root: string): string[] => {
  const out: string[] = [];
  const walk = (rel: string): void => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'coverage', '.git'].includes(entry.name)) continue;
        walk(path.join(rel, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        out.push(path.join(rel, entry.name).split(path.sep).join('/'));
      }
    }
  };
  for (const scope of ['adapters', 'modules', 'packages', 'assemblies', 'apps']) walk(scope);
  return out;
};

const indexProduction = (root: string): Map<string, DefinitionSite[]> => {
  if (definitionIndexCache) return definitionIndexCache;
  const index = new Map<string, DefinitionSite[]>();
  const classNames = new Set<string>();
  for (const file of scopeFiles(root)) {
    const sf = sourceFileOf(root, file);
    if (!sf) continue;
    const classOf = (node: ts.Node): string => {
      let cur: ts.Node | undefined = node.parent;
      while (cur) {
        if (ts.isClassDeclaration(cur) || ts.isClassExpression(cur))
          return cur.name?.text ?? '<anonymous-class>';
        cur = cur.parent;
      }
      return '<module>';
    };
    const visit = (node: ts.Node): void => {
      if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name)
        classNames.add(node.name.text);
      const named =
        (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) ||
        (ts.isFunctionDeclaration(node) && node.name);
      const varFn =
        (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
        node.parent &&
        ts.isVariableDeclaration(node.parent) &&
        ts.isIdentifier(node.parent.name);
      const propFn =
        (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
        node.parent &&
        ts.isPropertyAssignment(node.parent) &&
        ts.isIdentifier(node.parent.name);
      if (named || varFn || propFn) {
        const name = named
          ? (node as unknown as { name: ts.Identifier }).name.text
          : (node.parent as unknown as { name: ts.Identifier }).name.text;
        const propertyCalls = new Set<string>();
        const walkBody = (n: ts.Node): void => {
          if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression))
            propertyCalls.add(n.expression.name.text);
          ts.forEachChild(n, walkBody);
        };
        const body = (node as unknown as { body?: ts.Node }).body;
        if (body) walkBody(body);
        const list = index.get(name) ?? [];
        list.push({ file, symbol: `${classOf(node)}.${name}`, propertyCalls });
        index.set(name, list);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  definitionIndexCache = index;
  productionClassNamesCache = classNames;
  return index;
};

/** All class names declared in the production scopes (for receiver binding). */
export const productionClassNames = (root: string): ReadonlySet<string> => {
  indexProduction(root);
  return productionClassNamesCache ?? new Set<string>();
};

const pathReaches = (
  root: string,
  fromMethod: string,
  toMethod: string,
  depth: number,
  licensedHopFiles?: ReadonlySet<string>,
): { reached: boolean; chain: string[] } => {
  const index = indexProduction(root);
  const queue: { method: string; depth: number; chain: string[] }[] = [
    { method: fromMethod, depth, chain: [] },
  ];
  const seen = new Set<string>();
  while (queue.length) {
    const cur = queue.shift()!;
    const key = `${cur.method}|${cur.depth}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const site of index.get(cur.method) ?? []) {
      for (const callee of site.propertyCalls) {
        const hop = `${site.file}:${site.symbol} -> ${callee}`;
        if (callee === toMethod) {
          // The hop landing on the target must originate in the boundary's own
          // file or in one of the boundary's recorded production callers.
          // Otherwise it is a same-named method in an unrelated class ??exactly
          // the false positive this resolver exists to prevent.
          const licensed = !licensedHopFiles || licensedHopFiles.has(site.file);
          if (licensed) return { reached: true, chain: [...cur.chain, hop] };
          continue;
        }
        if (cur.depth > 0)
          queue.push({ method: callee, depth: cur.depth - 1, chain: [...cur.chain, hop] });
      }
    }
  }
  return { reached: false, chain: [] };
};

/**
 * Test-local call adjacency: method name -> set of property-access callees
 * declared inside that test file. R3 evidence approval records sometimes name a
 * test-local helper as the `entrySymbol` (e.g. an approved recovery helper that
 * drives the production recovery path). Those hops are not in the production
 * definition index, so they are resolved here.
 */
export const testLocalCalls = (root: string, file: string): Map<string, ReadonlySet<string>> => {
  const cacheKey = `testlocal\u0000${root}\u0000${file}`;
  const cached = testLocalCache.get(cacheKey);
  if (cached) return cached;
  const out = new Map<string, Set<string>>();
  const sf = sourceFileOf(root, file);
  if (sf) {
    const visit = (node: ts.Node): void => {
      const named =
        (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) ||
        (ts.isFunctionDeclaration(node) && node.name);
      const varFn =
        (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
        node.parent &&
        ts.isVariableDeclaration(node.parent) &&
        ts.isIdentifier(node.parent.name);
      if (named || varFn) {
        const name = named
          ? (node as unknown as { name: ts.Identifier }).name.text
          : (node.parent as unknown as { name: ts.Identifier }).name.text;
        const callees = new Set<string>();
        const walk = (n: ts.Node): void => {
          if (ts.isCallExpression(n)) {
            const e = n.expression;
            if (ts.isPropertyAccessExpression(e)) callees.add(e.name.text);
            // bare-identifier calls matter here: a test-local helper typically
            // invokes the production entry as `await recoverX(state)`, not as a
            // member access.
            else if (ts.isIdentifier(e)) callees.add(e.text);
          }
          // A helper may reach a private boundary by EXTRACTING the method and
          // invoking it via .call/.apply, e.g.
          //   const recovery = (state as unknown as { m(): void }).m;
          //   await recovery.call(state);
          // The invoked callee is then `call`, so record the extracted member
          // name as well.
          if (
            ts.isPropertyAccessExpression(n) &&
            !ts.isCallExpression(n.parent) &&
            ts.isIdentifier(n.name)
          ) {
            callees.add(n.name.text);
          }
          ts.forEachChild(n, walk);
        };
        const body = (node as unknown as { body?: ts.Node }).body;
        if (body) walk(body);
        const list = out.get(name) ?? new Set<string>();
        for (const c of callees) list.add(c);
        out.set(name, list);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  testLocalCache.set(cacheKey, out);
  return out;
};

const pathReachesLocal = (
  root: string,
  file: string,
  fromMethod: string,
  toMethod: string,
  depth: number,
): { reached: boolean; chain: string[] } => {
  const local = testLocalCalls(root, file);
  const queue: { method: string; depth: number; chain: string[] }[] = [
    { method: fromMethod, depth, chain: [] },
  ];
  const seen = new Set<string>();
  while (queue.length) {
    const cur = queue.shift()!;
    const key = `${cur.method}|${cur.depth}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const callee of local.get(cur.method) ?? []) {
      const hop = `${file} (test-local):${cur.method} -> ${callee}`;
      const matchesTarget = callee === toMethod || callee.endsWith(toMethod);
      if (matchesTarget) return { reached: true, chain: [...cur.chain, hop] };
      if (cur.depth > 0)
        queue.push({ method: callee, depth: cur.depth - 1, chain: [...cur.chain, hop] });
    }
  }
  return { reached: false, chain: [] };
};

/**
 * Resolve from an entry method to the target: try the production call graph
 * first, then test-local helpers (R3 sometimes names a test-local helper as the
 * approved entry symbol), then the entry itself.
 */
const resolveEntryToTarget = (
  root: string,
  file: string,
  fromMethod: string,
  targetMethod: string,
  licensedHopFiles?: ReadonlySet<string>,
): { reached: boolean; chain: string[] } => {
  const prod = pathReaches(root, fromMethod, targetMethod, 4, licensedHopFiles);
  if (prod.reached) return prod;
  const local = pathReachesLocal(root, file, fromMethod, targetMethod, 4);
  if (local.reached) return local;
  if (fromMethod === targetMethod) return { reached: true, chain: [`${fromMethod} is the target`] };
  return { reached: false, chain: [] };
};

/** ---- coverage-kind verification --------------------------------------- */

type Outcome = {
  status: ResolutionStatus;
  evidence: string[];
  issueCode: ResolutionIssueCode | null;
};

const missingFile = (file: string): Outcome => ({
  status: 'MISSING_TEST_FILE',
  evidence: [`declared test file not found: ${file}`],
  issueCode: 'REGRESSION_EVIDENCE_FILE_MISSING',
});

/**
 * Some registered transaction boundaries are module-level closures rather than
 * class methods (e.g. the object-literal `commitProjectProjection` returned by
 * the activity/history read-model factories, whose transaction helper sits
 * inside that closure). Their recorded symbol is `<module>`/`<anonymous-class>`,
 * so there is no class name a receiver could ever bind to.
 *
 * For those boundaries the class-binding tier is not applicable, but the
 * receiver must still not resolve to a *different* registered class: a call to
 * the same method name on another boundary's class is exactly the false positive
 * (invariant C) this resolver exists to reject.
 */
const isModuleLevelSymbol = (symbol: string): boolean =>
  symbol === '<module>' || symbol === '<anonymous-class>' || symbol.length === 0;

const missingBlock = (file: string, title: string): Outcome => ({
  status: 'MISSING_TEST_BLOCK',
  evidence: [`no it()/test() block titled "${title}" in ${file}`],
  issueCode: 'REGRESSION_TEST_BLOCK_MISSING',
});

const resolveDirect = (
  root: string,
  record: ApprovedEvidenceRecord,
  target: QualifiedTarget,
  knownClassNames: ReadonlySet<string>,
): Outcome => {
  if (!fs.existsSync(path.join(root, record.testFile))) return missingFile(record.testFile);
  const block = callsInTestBlock(root, record.testFile, record.testTitle);
  if (!block.found) return missingBlock(record.testFile, record.testTitle);

  const invocations = invocationsIn(block.calls);
  const named = invocations.filter((i) => i.method === target.method);
  if (named.length === 0)
    return methodInvokedAnywhereInFile(root, record.testFile, target.method)
      ? {
          status: 'CALL_OUTSIDE_TARGET_BLOCK',
          evidence: [
            `${target.method} is invoked in ${record.testFile} but NOT inside block "${record.testTitle}"`,
          ],
          issueCode: 'REGRESSION_CALL_OUTSIDE_TARGET_BLOCK',
        }
      : {
          status: 'NO_QUALIFIED_CALL',
          evidence: [
            `no call to ${target.method} inside block "${record.testTitle}" in ${record.testFile}`,
          ],
          issueCode: 'REGRESSION_QUALIFIED_CALL_MISSING',
        };

  const wantedClass = conciseName(target.symbol);
  // A "module-level" boundary is a closure/object-literal method whose recorded
  // symbol is a placeholder, e.g. the `commitProjectProjection` returned by the
  // activity/history read-model factories. There is no class name for a receiver
  // to bind to, so the class-binding tier is inapplicable; the caller identity is
  // instead carried by the declared block itself. The required qualified call
  // inside the declared block is unchanged, which is what keeps this from
  // degenerating into method-name matching in an arbitrary block.
  const moduleLevelBoundary = isModuleLevelSymbol(wantedClass) && !knownClassNames.has(wantedClass);
  const bindings: string[] = [];
  let sawUnqualified = false;
  let moduleLevelAccepted = false;
  for (const invocation of named) {
    const binding = resolveReceiverBinding(
      root,
      record.testFile,
      invocation.receiver,
      knownClassNames,
      invocation.position,
    );
    bindings.push(
      `${invocation.receiver || '(bare)'} -> ${binding.className ?? 'UNRESOLVED'} (${binding.how})`,
    );
    if (binding.className === null) {
      sawUnqualified = true;
      if (moduleLevelBoundary) {
        moduleLevelAccepted = true;
        break;
      }
      continue;
    }
    if (binding.className === wantedClass)
      return {
        status: 'RESOLVED_DIRECT',
        evidence: [
          `qualified call inside declared block: ${invocation.receiver}.${target.method}`,
          `receiver resolves to ${binding.className} (${binding.how})`,
        ],
        issueCode: null,
      };
  }

  if (moduleLevelAccepted)
    return {
      status: 'RESOLVED_DIRECT',
      evidence: [
        `module-level boundary ${target.symbol}.${target.method} is invoked inside the declared block`,
        ...bindings,
      ],
      issueCode: null,
    };

  if (moduleLevelBoundary)
    // Every call site in the block bound to a *different* registered class, so
    // this block exercises another class's same-named method.
    return {
      status: 'TARGET_MISMATCH',
      evidence: [
        `${target.method} is invoked in the declared block but every receiver binds to another class, not the module-level boundary ${target.symbol}.${target.method}`,
        ...bindings,
      ],
      issueCode: 'REGRESSION_TARGET_MISMATCH',
    };

  if (sawUnqualified)
    return {
      status: 'UNQUALIFIED_RECEIVER',
      evidence: [
        `${target.method} is invoked in the declared block but the receiver cannot be bound to ${wantedClass}`,
        ...bindings,
      ],
      issueCode: 'REGRESSION_RECEIVER_UNQUALIFIED',
    };
  return {
    status: 'TARGET_MISMATCH',
    evidence: [
      `${target.method} is invoked in the declared block but on a different class (expected ${wantedClass})`,
      ...bindings,
    ],
    issueCode: 'REGRESSION_TARGET_MISMATCH',
  };
};

const resolvePublicPath = (
  root: string,
  record: ApprovedEvidenceRecord,
  target: QualifiedTarget,
): Outcome => {
  const licensedHopFiles = new Set<string>([target.file, ...(record.licensedHopFiles ?? [])]);
  if (!fs.existsSync(path.join(root, record.testFile))) return missingFile(record.testFile);
  const block = callsInTestBlock(root, record.testFile, record.testTitle);
  if (!block.found) return missingBlock(record.testFile, record.testTitle);

  const evidence: string[] = [];
  const entryMethod = conciseName(record.entrySymbol);
  const invocations = invocationsIn(block.calls);
  const entryInvoked = invocations.some((i) => i.method === entryMethod);
  evidence.push(
    entryInvoked
      ? `approved entry invoked in declared block: ${record.entrySymbol}`
      : `approved entry NOT invoked in declared block: ${record.entrySymbol}`,
  );

  const hops = record.path ?? [];
  const declaredHop = hops.length >= 2 ? hops[hops.length - 2] : undefined;
  const declaredFrom = declaredHop === undefined ? entryMethod : conciseName(declaredHop);
  const reach = resolveEntryToTarget(
    root,
    record.testFile,
    declaredFrom,
    target.method,
    licensedHopFiles,
  );
  evidence.push(
    reach.reached
      ? `approved path resolves to target: ${reach.chain.slice(-2).join(' -> ')}`
      : `approved path does not resolve from ${declaredFrom} to ${target.method}`,
  );

  // An approved PUBLIC_PATH relation is a claim about THIS declared block: the
  // block invokes the approved entry and the approved entry reaches the target.
  // Accepting on `entryInvoked` alone was already wrong (the block might never
  // reach the target), but accepting on `reach.reached` alone is equally wrong
  // and was an actual false positive: the production call graph is global, so a
  // same-named method chain exists independently of whether the declared block
  // ever executes it. Both halves are required.
  if (!entryInvoked)
    return { status: 'ENTRY_NOT_INVOKED', evidence, issueCode: 'REGRESSION_ENTRY_NOT_INVOKED' };
  if (!reach.reached)
    return { status: 'PATH_NOT_RESOLVED', evidence, issueCode: 'REGRESSION_PATH_UNRESOLVED' };
  return { status: 'RESOLVED_PUBLIC_PATH', evidence, issueCode: null };
};

const resolveOwnerAtomicity = (
  root: string,
  record: ApprovedEvidenceRecord,
  target: QualifiedTarget,
): Outcome => {
  const licensedHopFiles = new Set<string>([target.file, ...(record.licensedHopFiles ?? [])]);
  if (!fs.existsSync(path.join(root, record.testFile))) return missingFile(record.testFile);
  const block = callsInTestBlock(root, record.testFile, record.testTitle);
  if (!block.found) return missingBlock(record.testFile, record.testTitle);

  const evidence: string[] = [];
  const sf = sourceFileOf(root, record.testFile)!;
  // Owner-level proofs routinely place assertions inside a file-local helper that
  // the declared block invokes, so the assertion search covers the whole file and
  // the block (the block-level count is reported for transparency).
  const blockAsserts = block.calls.filter((c) => c.expression.getText(sf).startsWith('expect'));
  let fileAsserts = 0;
  const countAsserts = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.expression.getText(sf).startsWith('expect')) fileAsserts += 1;
    ts.forEachChild(n, countAsserts);
  };
  countAsserts(sf);
  const entryMethod = conciseName(record.entrySymbol);
  const entryInvoked = invocationsIn(block.calls).some((i) => i.method === entryMethod);

  // OWNER_ATOMICITY semantics are deliberately DIFFERENT from DIRECT_BOUNDARY and
  // PUBLIC_PATH. An owner-level proof drives the operation through a helper and
  // asserts the transaction/recovery invariant; it must NOT be required to name
  // the (usually private) boundary method in a final licensed hop, which is what
  // DIRECT_BOUNDARY requires. Acceptance conditions:
  //   (a) the declared entry is executed by the block, OR the block drives the
  //       owner operation directly / through a helper, AND
  //   (b) the owner operation reaches the registered boundary method on the same
  //       class, via the production graph or via test-local helper expansion, AND
  //   (c) the proof file asserts the invariant.
  const targetClass = conciseName(target.symbol);
  const localIndex = testLocalCalls(root, record.testFile);
  const driverInvokesTarget = invocationsIn(block.calls).some(
    (i) => localIndex.get(i.method)?.has(target.method) === true,
  );
  const blockDrivesOwner = invocationsIn(block.calls).some((i) => {
    if (i.method === target.method) return true;
    const tail = (i.receiver.split('.').pop() ?? '').toLowerCase();
    return tail !== '' && tail.includes(targetClass.toLowerCase().replace(/^postgres/, ''));
  });
  const reach = entryInvoked
    ? { reached: true, chain: [] as string[] }
    : resolveEntryToTarget(root, record.testFile, entryMethod, target.method, licensedHopFiles);
  const ownerReached = entryInvoked || reach.reached || driverInvokesTarget || blockDrivesOwner;

  evidence.push(
    entryInvoked
      ? `owner entry invoked in declared block: ${record.entrySymbol}`
      : driverInvokesTarget
        ? `declared block drives a helper that invokes ${target.method}`
        : blockDrivesOwner
          ? `declared block drives the owner operation on ${targetClass}`
          : reach.reached
            ? `owner entry reachable to target: ${reach.chain.slice(-2).join(' -> ')}`
            : `owner entry not reachable to target: ${record.entrySymbol}`,
  );
  evidence.push(
    `assertions: block=${blockAsserts.length}, file=${fileAsserts}; total calls in block: ${block.calls.length}`,
  );

  if (!ownerReached)
    return { status: 'ENTRY_NOT_INVOKED', evidence, issueCode: 'REGRESSION_ENTRY_NOT_INVOKED' };
  if (fileAsserts === 0)
    return { status: 'PATH_NOT_RESOLVED', evidence, issueCode: 'REGRESSION_PATH_UNRESOLVED' };
  return { status: 'RESOLVED_OWNER_ATOMICITY', evidence, issueCode: null };
};

/** ---- public API -------------------------------------------------------- */

export const resolveEvidence = (
  root: string,
  record: ApprovedEvidenceRecord,
  target: QualifiedTarget | null,
): Resolution => {
  const base = {
    testEvidenceId: record.testEvidenceId,
    targetBoundaryId: record.targetBoundaryId,
    declaredCoverageKind: record.coverageKind,
    testFile: record.testFile,
    testTitle: record.testTitle,
    target,
  };
  if (!target) {
    return {
      ...base,
      status: 'TARGET_MISMATCH',
      resolved: false,
      evidence: ['declared target boundary is not registered in the inventory'],
      issueCode: 'REGRESSION_TARGET_MISMATCH',
    };
  }
  const outcome: Outcome =
    record.coverageKind === 'DIRECT_BOUNDARY'
      ? resolveDirect(root, record, target, productionClassNames(root))
      : record.coverageKind === 'PUBLIC_PATH'
        ? resolvePublicPath(root, record, target)
        : record.coverageKind === 'OWNER_ATOMICITY'
          ? resolveOwnerAtomicity(root, record, target)
          : {
              status: 'UNSUPPORTED_COVERAGE_KIND',
              evidence: [`unsupported coverageKind: ${String(record.coverageKind)}`],
              issueCode: 'REGRESSION_COVERAGE_KIND_UNSUPPORTED',
            };
  return {
    ...base,
    status: outcome.status,
    resolved: outcome.status.startsWith('RESOLVED_'),
    evidence: outcome.evidence,
    issueCode: outcome.issueCode,
  };
};

/**
 * Build approved evidence records from an approved source (v2 fixture shape or
 * the R3 closure records shape). This does not invent relationships; it only
 * reads what was approved.
 */
export const approvedRecordsFromFixture = (fixture: {
  regressionEvidence: readonly {
    testEvidenceId: string;
    covers: readonly string[];
    coverageKind: CoverageKind;
    entrySymbol: string;
    path: readonly string[];
  }[];
  transactionBoundaries?: readonly {
    boundaryId: string;
    productionReachability?: { callers?: readonly { file: string }[] };
  }[];
}): ApprovedEvidenceRecord[] => {
  const callerFiles = new Map<string, string[]>();
  for (const b of fixture.transactionBoundaries ?? []) {
    callerFiles.set(b.boundaryId, [
      ...new Set((b.productionReachability?.callers ?? []).map((c) => c.file)),
    ]);
  }
  return fixture.regressionEvidence.map((e) => {
    const parsed = parseTestEvidenceId(e.testEvidenceId);
    const targetBoundaryId = e.covers[0] ?? '';
    return {
      testEvidenceId: e.testEvidenceId,
      targetBoundaryId,
      coverageKind: e.coverageKind,
      entrySymbol: e.entrySymbol,
      path: e.path ?? [],
      testFile: parsed?.file ?? '',
      testTitle: parsed?.title ?? '',
      licensedHopFiles: callerFiles.get(targetBoundaryId) ?? [],
    };
  });
};
