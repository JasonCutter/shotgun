import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { checkRegressionEvidenceAuthority } from './ts6-phase-b-regression-evidence-authority.js';

export type Classification =
  | 'TX_BOUNDARY'
  | 'TX_PARTICIPANT'
  | 'TX_DELEGATE'
  | 'NON_TX'
  | 'TEST_ONLY_OR_DEAD'
  | 'REVIEW_REQUIRED';

export type SourceCandidate = {
  readonly candidateId: string;
  readonly kind: 'SAFE_HELPER' | 'RAW';
  readonly file: string;
  readonly line: number;
  readonly sourceNeedle: string;
  readonly symbol: string;
  readonly method: string;
  readonly text: string;
  readonly functionKey: string;
};

export type CallEvidence = {
  readonly file: string;
  readonly symbol: string;
  readonly callExpression: string;
  readonly callNeedle: string;
  readonly bindingEvidence: readonly string[];
  readonly regressionEvidenceIds: readonly string[];
};

export type RegressionEvidence = {
  readonly testEvidenceId: string;
  readonly file: string;
  readonly testName: string;
  readonly covers: readonly string[];
  readonly coverageKind:
    | 'DIRECT_BOUNDARY'
    | 'PUBLIC_PATH'
    | 'OWNER_ATOMICITY'
    | 'DELEGATE_PATH'
    | 'PARTICIPANT_ATOMICITY'
    | 'ACK_LOSS';
  readonly entrySymbol: string;
  readonly path: readonly string[];
};

export type Corpus = {
  readonly schemaVersion: 'ts6.phase-b.transaction-authority.v2';
  readonly baseSha: string;
  readonly historical: {
    readonly previousSchema: 'v1';
    readonly previousReviewedRows: 87;
    readonly c2r1CandidateRows: 120;
  };
  readonly transactionBoundaries: readonly Boundary[];
  readonly transactionParticipants: readonly Participant[];
  readonly transactionDelegates: readonly Delegate[];
  readonly excludedCandidates: readonly Excluded[];
  readonly candidateReconciliation: readonly Reconciliation[];
  readonly historicalReconciliation: readonly HistoricalMapping[];
  readonly rawTransactionSites: readonly SourceCandidate[];
  readonly regressionEvidence: readonly RegressionEvidence[];
  readonly summary: Record<string, number>;
};

export type CountCrosswalk = {
  readonly candidateInventory: {
    readonly total: number;
    readonly txBoundary: number;
    readonly txParticipant: number;
    readonly txDelegate: number;
    readonly nonTx: number;
    readonly testOnlyOrDead: number;
  };
  readonly canonicalInventory: {
    readonly boundaries: number;
    readonly participants: number;
    readonly rawSites: number;
  };
  readonly mapping: readonly Record<string, unknown>[];
  readonly unexplained: readonly Record<string, unknown>[];
};

export type Boundary = {
  readonly boundaryId: string;
  readonly file: string;
  readonly symbol: string;
  readonly method: string;
  readonly ownership: { readonly kind: 'SAFE_HELPER' | 'RAW'; readonly primitive: string };
  readonly sourceEvidence: {
    readonly declarationNeedle: string;
    readonly transactionNeedle: string;
  };
  readonly productionReachability: {
    readonly status: 'PROVEN' | 'TEST_ONLY_OR_DEAD' | 'REVIEW_REQUIRED';
    readonly callers: readonly CallEvidence[];
  };
  readonly ackLossPolicy: {
    readonly kind:
      'PROPAGATE_UNKNOWN' | 'EXACT_READBACK' | 'NOT_APPLICABLE' | 'OTHER_EXISTING_POLICY';
    readonly evidence: string;
  };
  readonly regressionEvidenceIds: readonly string[];
};

export type Participant = {
  readonly participantId: string;
  readonly file: string;
  readonly symbol: string;
  readonly method: string;
  readonly transactionInput: string;
  readonly ownedByBoundaryIds: readonly string[];
  readonly callerEvidence: readonly CallEvidence[];
  readonly regressionEvidenceIds: readonly string[];
};

export type Delegate = {
  readonly delegateId: string;
  readonly file: string;
  readonly symbol: string;
  readonly method: string;
  readonly delegatesTo: readonly string[];
  readonly callEvidence: readonly CallEvidence[];
};
export type Excluded = {
  readonly candidateId: string;
  readonly file: string;
  readonly symbol: string;
  readonly reason: 'NON_TX' | 'DUPLICATE' | 'TEST_ONLY_OR_DEAD' | 'FALSE_POSITIVE';
  readonly evidence: string;
};
export type Reconciliation = {
  readonly candidateId: string;
  readonly c2r1Classification: 'SAFE_HELPER' | 'RAW';
  readonly c2r2Classification: Classification;
  readonly file: string;
  readonly symbol: string;
  readonly method: string;
  readonly reason: string;
  readonly productionReachable: boolean;
  readonly transactionOwner: boolean;
  readonly transactionParticipant: boolean;
  readonly canonicalBoundaryId?: string;
};
export type HistoricalMapping = {
  readonly historicalRowId: string;
  readonly disposition:
    | 'STILL_VALID'
    | 'SPLIT'
    | 'MERGED'
    | 'STALE'
    | 'FALSE_POSITIVE'
    | 'NO_LONGER_PRESENT'
    | 'REPLACED_BY_V2_BOUNDARY';
  readonly mappedCandidateIds: readonly string[];
  readonly explanation: string;
};
export type Issue = { readonly code: string; readonly message: string };
export type ValidationResult = {
  readonly valid: boolean;
  readonly candidates: readonly SourceCandidate[];
  readonly rawSiteCount: number;
  readonly counts: Record<Classification, number>;
  readonly issues: readonly Issue[];
};

const MODULE_PATH = fileURLToPath(import.meta.url);
export const ROOT = path.resolve(path.dirname(MODULE_PATH), '..');
export const BASELINE_SHA = '1f821ea371b308d8cecede4a98ebe27960873b21';
export const V2_FIXTURE_RELATIVE_PATH =
  'tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json';
const SCOPES = ['adapters', 'modules', 'packages', 'assemblies', 'apps'] as const;
const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git']);
const posix = (value: string): string => value.split(path.sep).join('/');
const read = (root: string, file: string): string | undefined => {
  try {
    return fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    return undefined;
  }
};
const filesUnder = (root: string, rel: string): string[] => {
  const out: string[] = [];
  const walk = (current: string): void => {
    if (!fs.existsSync(path.join(root, current))) return;
    for (const entry of fs.readdirSync(path.join(root, current), { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP.has(entry.name)) continue;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && child.endsWith('.ts')) out.push(posix(child));
    }
  };
  walk(rel);
  return out;
};
const productionFiles = (root: string): string[] =>
  SCOPES.flatMap((scope) => filesUnder(root, scope)).filter(
    (file) => file !== 'packages/postgres-transaction/src/index.ts',
  );
const sourceLine = (source: string, line: number): string =>
  source.split(/\r?\n/)[line - 1]?.trim() ?? '';
const isFunctionLike = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node);
const enclosingFunction = (node: ts.Node): ts.FunctionLikeDeclaration | undefined => {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (isFunctionLike(current)) return current;
    current = current.parent;
  }
  return undefined;
};
const className = (node: ts.Node): string => {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isClassDeclaration(current) || ts.isClassExpression(current))
      return current.name?.text ?? '<anonymous-class>';
    current = current.parent;
  }
  return '<module>';
};
const functionName = (node: ts.FunctionLikeDeclaration | undefined): string => {
  if (!node) return '<module>';
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (node.parent && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name))
    return node.parent.name.text;
  if (node.parent && ts.isPropertyAssignment(node.parent) && ts.isIdentifier(node.parent.name))
    return node.parent.name.text;
  return '<anonymous-function>';
};
const identity = (node: ts.Node): { readonly symbol: string; readonly method: string } => ({
  symbol: className(node),
  method: functionName(enclosingFunction(node)),
});
const lineOf = (sf: ts.SourceFile, node: ts.Node): number =>
  sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
const sqlText = (argument: ts.Expression | undefined, source: string): string | undefined => {
  if (!argument) return undefined;
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
    return argument.text;
  if (ts.isTemplateExpression(argument))
    return source.slice(argument.getStart(), argument.end).replace(/^`|`$/g, '');
  return undefined;
};
const isTxSql = (value: string | undefined): boolean =>
  value !== undefined && /^(BEGIN|COMMIT|ROLLBACK)\b/i.test(value.trim());
const fnKey = (file: string, node: ts.Node): string => {
  const id = identity(node);
  return `${file}:${id.symbol}.${id.method}`;
};

const sourceCandidatesCache = new Map<string, readonly SourceCandidate[]>();
export const scanCurrentSource = (root: string = ROOT): readonly SourceCandidate[] => {
  const cached = sourceCandidatesCache.get(root);
  if (cached) return cached;
  const candidates: SourceCandidate[] = [];
  for (const file of productionFiles(root)) {
    const source = read(root, file);
    if (source === undefined) continue;
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const line = lineOf(sf, node);
        const id = identity(node);
        const key = fnKey(file, node);
        const expression = node.expression.getText(sf);
        if (expression === 'withSafePostgresTransaction')
          candidates.push({
            candidateId: `safe:${file}:${line}`,
            kind: 'SAFE_HELPER',
            file,
            line,
            sourceNeedle: 'withSafePostgresTransaction',
            symbol: id.symbol,
            method: id.method,
            text: sourceLine(source, line),
            functionKey: key,
          });
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'query' &&
          ts.isIdentifier(node.expression.expression) &&
          (node.expression.expression.text === 'client' ||
            node.expression.expression.text === 'poolClient')
        ) {
          const argument = node.arguments[0];
          const sql = sqlText(argument, source);
          if (isTxSql(sql) && argument !== undefined && !ts.isTemplateExpression(argument))
            candidates.push({
              candidateId: `raw:${file}:${line}`,
              kind: 'RAW',
              file,
              line,
              sourceNeedle: sourceLine(source, line),
              symbol: id.symbol,
              method: id.method,
              text: sourceLine(source, line),
              functionKey: key,
            });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  const result = candidates.sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  sourceCandidatesCache.set(root, result);
  return result;
};

const rawSiteCache = new Map<string, readonly SourceCandidate[]>();
const scanAllRawSites = (root: string): readonly SourceCandidate[] => {
  const cached = rawSiteCache.get(root);
  if (cached) return cached;
  const sites: SourceCandidate[] = [];
  for (const file of productionFiles(root)) {
    const source = read(root, file);
    if (source === undefined) continue;
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'query' &&
        ts.isIdentifier(node.expression.expression) &&
        (node.expression.expression.text === 'client' ||
          node.expression.expression.text === 'poolClient')
      ) {
        const sql = sqlText(node.arguments[0], source);
        if (isTxSql(sql)) {
          const line = lineOf(sf, node);
          const id = identity(node);
          sites.push({
            candidateId: `raw:${file}:${line}`,
            kind: 'RAW',
            file,
            line,
            sourceNeedle: sourceLine(source, line),
            symbol: id.symbol,
            method: id.method,
            text: sourceLine(source, line),
            functionKey: fnKey(file, node),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  const result = sites.sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  rawSiteCache.set(root, result);
  return result;
};

const declarationNeedle = (root: string, candidate: SourceCandidate): string => {
  const source = read(root, candidate.file) ?? '';
  const matcher = new RegExp(
    `(?:async\\s+|public\\s+|private\\s+|protected\\s+)?${candidate.method}\\s*\\(`,
  );
  return (
    source
      .split(/\r?\n/)
      .find((line) => matcher.test(line))
      ?.trim() ??
    source
      .split(/\r?\n/)
      .find((line) => line.includes(candidate.method))
      ?.trim() ??
    `${candidate.method}`
  );
};
const testFiles = (root: string): string[] => filesUnder(root, 'tests');
const testEvidenceCache = new Map<string, RegressionEvidence | undefined>();
const testEvidenceFor = (
  root: string,
  boundaryId: string,
  method: string,
): RegressionEvidence | undefined => {
  const cacheKey = `${root}:${method}`;
  const cached = testEvidenceCache.get(cacheKey);
  if (cached !== undefined || testEvidenceCache.has(cacheKey)) return cached;
  if (!method || method.startsWith('<')) return undefined;
  for (const file of testFiles(root)) {
    const source = read(root, file) ?? '';
    const match = source.match(
      new RegExp(`\\b${method.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')}\\s*\\(`),
    );
    const position = match?.index ?? -1;
    if (position < 0) continue;
    const matches = [
      ...source.slice(0, position).matchAll(/(?:it|test|describe)\s*\(\s*['"`]([^'"`]+)['"`]/g),
    ];
    const testName = matches.at(-1)?.[1];
    if (!testName) continue;
    const evidence = {
      testEvidenceId: `test:${file}:${testName}`,
      file,
      testName,
      covers: [boundaryId],
      coverageKind: 'DIRECT_BOUNDARY' as const,
      entrySymbol: method,
      path: [method],
    };
    testEvidenceCache.set(cacheKey, evidence);
    return evidence;
  }
  testEvidenceCache.set(cacheKey, undefined);
  return undefined;
};
type IndexedCall = {
  readonly file: string;
  readonly line: number;
  readonly expression: string;
  readonly symbol: string;
  readonly method: string;
};
const callIndexCache = new Map<string, readonly IndexedCall[]>();
const callIndexFor = (root: string): readonly IndexedCall[] => {
  const cached = callIndexCache.get(root);
  if (cached) return cached;
  const out: IndexedCall[] = [];
  for (const file of productionFiles(root)) {
    const source = read(root, file);
    if (source === undefined) continue;
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const caller = identity(node);
        out.push({
          file,
          line: lineOf(sf, node),
          expression: node.expression.getText(sf),
          symbol: caller.symbol,
          method: caller.method,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  callIndexCache.set(root, out);
  return out;
};
const callersFor = (root: string, boundary: SourceCandidate): readonly CallEvidence[] => {
  if (!boundary.method || boundary.method.startsWith('<')) return [];
  const needle = declarationNeedle(root, boundary);
  const seen = new Set<string>();
  return callIndexFor(root)
    .filter(
      (call) =>
        call.expression.endsWith(`.${boundary.method}`) &&
        !(call.file === boundary.file && call.line === boundary.line),
    )
    .filter((call) => {
      const key = `${call.file}:${call.line}:${call.expression}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((call) => ({
      file: call.file,
      symbol: `${call.symbol}.${call.method}`,
      callExpression: `${call.expression}(...)`,
      callNeedle: `${call.expression}(`,
      bindingEvidence: [needle],
      regressionEvidenceIds: [],
    }));
};
const savepoint = (candidate: SourceCandidate): boolean =>
  /(?:ROLLBACK\s+TO\s+SAVEPOINT|SAVEPOINT\s+)/i.test(candidate.text);
const rawBoundary = (
  candidate: SourceCandidate,
  all: readonly SourceCandidate[],
): SourceCandidate | undefined =>
  all.find(
    (other) =>
      other.kind === 'RAW' &&
      other.functionKey === candidate.functionKey &&
      /\bBEGIN\b/i.test(other.text),
  );

export const buildAuditShape = (root: string = ROOT) => {
  const candidates = scanCurrentSource(root);
  const boundaries: Boundary[] = [];
  const participants: Participant[] = [];
  const delegates: Delegate[] = [];
  const excluded: Excluded[] = [];
  const reconciliation: Reconciliation[] = [];
  const rawSites = scanAllRawSites(root);
  const regressionEvidence: RegressionEvidence[] = [];
  const evidenceIds = new Set<string>();
  const addEvidence = (candidateId: string, method: string): string[] => {
    const evidence = testEvidenceFor(root, candidateId, method);
    if (!evidence || evidenceIds.has(evidence.testEvidenceId))
      return evidence ? [evidence.testEvidenceId] : [];
    evidenceIds.add(evidence.testEvidenceId);
    regressionEvidence.push(evidence);
    return [evidence.testEvidenceId];
  };
  const makeBoundary = (candidate: SourceCandidate, kind: 'SAFE_HELPER' | 'RAW'): Boundary => {
    const callers = callersFor(root, candidate);
    const status = callers.length > 0 ? 'PROVEN' : 'TEST_ONLY_OR_DEAD';
    const regressionEvidenceIds = addEvidence(candidate.candidateId, candidate.method);
    return {
      boundaryId: candidate.candidateId,
      file: candidate.file,
      symbol: candidate.symbol,
      method: candidate.method,
      ownership: {
        kind,
        primitive:
          kind === 'SAFE_HELPER' ? 'withSafePostgresTransaction' : 'manual PostgreSQL transaction',
      },
      sourceEvidence: {
        declarationNeedle: declarationNeedle(root, candidate),
        transactionNeedle: candidate.sourceNeedle,
      },
      productionReachability: {
        status,
        callers: callers.map((caller) => ({ ...caller, regressionEvidenceIds })),
      },
      ackLossPolicy:
        candidate.file.includes('frontend-command-gateway-postgres') &&
        candidate.method === 'complete'
          ? {
              kind: 'EXACT_READBACK',
              evidence: 'same command_id + COMPLETED + SUCCEEDED + exact produced_resources',
            }
          : kind === 'SAFE_HELPER'
            ? {
                kind: 'PROPAGATE_UNKNOWN',
                evidence: 'existing safe transaction helper outcome contract',
              }
            : { kind: 'OTHER_EXISTING_POLICY', evidence: 'existing manual transaction code' },
      regressionEvidenceIds,
    };
  };
  const savepointSite = rawSites.find((candidate) => savepoint(candidate));
  if (savepointSite) {
    const owner = candidates.find(
      (item) =>
        item.kind === 'SAFE_HELPER' &&
        item.file === savepointSite.file &&
        item.method === 'poolTransaction',
    )?.candidateId;
    participants.push({
      participantId: savepointSite.candidateId,
      file: savepointSite.file,
      symbol: savepointSite.symbol,
      method: savepointSite.method,
      transactionInput: 'client supplied by enclosing poolTransaction callback',
      ownedByBoundaryIds: owner ? [owner] : [],
      callerEvidence: [
        {
          file: savepointSite.file,
          symbol: `${savepointSite.symbol}.${savepointSite.method}`,
          callExpression: 'client.query(`ROLLBACK TO SAVEPOINT ...`)',
          callNeedle: savepointSite.sourceNeedle,
          bindingEvidence: ['poolTransaction('],
          regressionEvidenceIds: [],
        },
      ],
      regressionEvidenceIds: [],
    });
  }
  for (const candidate of candidates) {
    if (candidate.kind === 'SAFE_HELPER') {
      const boundary = makeBoundary(candidate, 'SAFE_HELPER');
      boundaries.push(boundary);
      reconciliation.push({
        candidateId: candidate.candidateId,
        c2r1Classification: candidate.kind,
        c2r2Classification:
          boundary.productionReachability.status === 'PROVEN' ? 'TX_BOUNDARY' : 'TEST_ONLY_OR_DEAD',
        file: candidate.file,
        symbol: candidate.symbol,
        method: candidate.method,
        reason:
          boundary.productionReachability.status === 'PROVEN'
            ? 'Safe helper call owns transaction outcome.'
            : 'No production CallExpression found after AST audit.',
        productionReachable: boundary.productionReachability.status === 'PROVEN',
        transactionOwner: true,
        transactionParticipant: false,
        canonicalBoundaryId: boundary.boundaryId,
      });
      continue;
    }
    const owner = rawBoundary(candidate, candidates);
    if (owner && owner.candidateId !== candidate.candidateId) {
      excluded.push({
        candidateId: candidate.candidateId,
        file: candidate.file,
        symbol: candidate.symbol,
        reason: 'DUPLICATE',
        evidence: `Lifecycle statement belongs to raw boundary ${owner.candidateId}.`,
      });
      reconciliation.push({
        candidateId: candidate.candidateId,
        c2r1Classification: candidate.kind,
        c2r2Classification: 'NON_TX',
        file: candidate.file,
        symbol: candidate.symbol,
        method: candidate.method,
        reason: 'Duplicate COMMIT/ROLLBACK lifecycle statement.',
        productionReachable: true,
        transactionOwner: false,
        transactionParticipant: false,
        canonicalBoundaryId: owner.candidateId,
      });
      continue;
    }
    const boundary = makeBoundary(candidate, 'RAW');
    boundaries.push(boundary);
    reconciliation.push({
      candidateId: candidate.candidateId,
      c2r1Classification: candidate.kind,
      c2r2Classification:
        boundary.productionReachability.status === 'PROVEN' ? 'TX_BOUNDARY' : 'TEST_ONLY_OR_DEAD',
      file: candidate.file,
      symbol: candidate.symbol,
      method: candidate.method,
      reason: 'Manual BEGIN owns raw transaction outcome.',
      productionReachable: boundary.productionReachability.status === 'PROVEN',
      transactionOwner: true,
      transactionParticipant: false,
      canonicalBoundaryId: boundary.boundaryId,
    });
  }
  const counts = {
    TX_BOUNDARY: reconciliation.filter((row) => row.c2r2Classification === 'TX_BOUNDARY').length,
    TX_PARTICIPANT: reconciliation.filter((row) => row.c2r2Classification === 'TX_PARTICIPANT')
      .length,
    TX_DELEGATE: 0,
    NON_TX: reconciliation.filter((row) => row.c2r2Classification === 'NON_TX').length,
    TEST_ONLY_OR_DEAD: reconciliation.filter(
      (row) => row.c2r2Classification === 'TEST_ONLY_OR_DEAD',
    ).length,
    REVIEW_REQUIRED: 0,
  } satisfies Record<Classification, number>;
  return {
    candidates,
    boundaries,
    participants,
    delegates,
    excluded,
    reconciliation,
    rawTransactionSites: rawSites,
    regressionEvidence,
    counts,
  };
};

const add = (issues: Issue[], code: string, message: string): void => {
  issues.push({ code, message });
};
const lastPathToken = (value: string): string =>
  value.replace(/\(.*$/, '').split(/[.:]/).filter(Boolean).at(-1) ?? value;
const activeTestTitles = (source: string): ReadonlySet<string> => {
  const file = ts.createSourceFile(
    'regression-evidence.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const titles = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const isPlainTestCall =
        ts.isIdentifier(expression) && (expression.text === 'it' || expression.text === 'test');
      if (isPlainTestCall && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        titles.add(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return titles;
};
const sourceHasPathToken = (source: string, pathItem: string): boolean => {
  const token = lastPathToken(pathItem);
  return (
    token.length > 0 &&
    new RegExp(`\\b${token.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`).test(source)
  );
};
const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((item) => right.includes(item));

export const validateCountCrosswalk = (crosswalk: CountCrosswalk): Issue[] => {
  const issues: Issue[] = [];
  const candidates = crosswalk.candidateInventory;
  const canonical = crosswalk.canonicalInventory;
  if (
    candidates.total !== 120 ||
    candidates.txBoundary !== 100 ||
    candidates.txParticipant !== 0 ||
    candidates.txDelegate !== 0 ||
    candidates.nonTx !== 7 ||
    candidates.testOnlyOrDead !== 13
  )
    add(issues, 'CROSSWALK_CANDIDATE_COUNTS', 'Candidate inventory must be 120/100/0/0/7/13.');
  if (canonical.boundaries !== 113 || canonical.participants !== 1 || canonical.rawSites !== 11)
    add(issues, 'CROSSWALK_CANONICAL_COUNTS', 'Canonical inventory must be 113/1/11.');
  if (crosswalk.unexplained.length !== 0)
    add(issues, 'CROSSWALK_UNEXPLAINED', 'Count crosswalk contains unexplained records.');
  const extras = crosswalk.mapping.filter((item) => item.kind === 'CANONICAL_BOUNDARY_EXTRA');
  if (extras.length !== 13)
    add(
      issues,
      'CROSSWALK_BOUNDARY_EXTRAS',
      'Exactly 13 canonical boundary extras must be explicit.',
    );
  if (
    !crosswalk.mapping.some(
      (item) =>
        item.kind === 'PARTICIPANT_MAPPING' &&
        item.participantId === 'raw:adapters/frontend-ask-execution-postgres/src/index.ts:2062',
    )
  )
    add(issues, 'CROSSWALK_PARTICIPANT', 'The canonical participant mapping is missing.');
  return issues;
};

export const validateCorpus = (corpus: Corpus, root: string = ROOT): ValidationResult => {
  const issues: Issue[] = [];
  const audit = buildAuditShape(root);
  const expected = new Map(audit.reconciliation.map((row) => [row.candidateId, row]));
  const SUPPORTED_SCHEMAS = new Set([
    'ts6.phase-b.transaction-authority.v2',
    'ts6.phase-b.transaction-authority.v3',
  ]);
  if (!SUPPORTED_SCHEMAS.has(corpus.schemaVersion))
    add(issues, 'SCHEMA', 'schemaVersion must be v2 or v3 (v3 is the C2-R15 corrected snapshot).');
  if (corpus.baseSha !== BASELINE_SHA) add(issues, 'BASE_SHA', `baseSha must be ${BASELINE_SHA}.`);
  if (corpus.historical.previousReviewedRows !== 87 || corpus.historical.c2r1CandidateRows !== 120)
    add(issues, 'HISTORICAL_INPUT', 'Historical inputs must be 87 and 120.');
  const seen = new Set<string>();
  for (const row of corpus.candidateReconciliation) {
    if (seen.has(row.candidateId)) add(issues, 'DUPLICATE_CANDIDATE', row.candidateId);
    seen.add(row.candidateId);
    const source = expected.get(row.candidateId);
    if (!source) add(issues, 'STALE_CANDIDATE', row.candidateId);
    else if (
      source.c2r2Classification !== row.c2r2Classification ||
      source.canonicalBoundaryId !== row.canonicalBoundaryId
    )
      add(issues, 'CLASSIFICATION_DRIFT', row.candidateId);
  }
  for (const row of audit.reconciliation)
    if (!seen.has(row.candidateId)) add(issues, 'UNREGISTERED_CANDIDATE', row.candidateId);
  if (corpus.candidateReconciliation.length !== audit.candidates.length)
    add(
      issues,
      'CANDIDATE_COUNT',
      `${corpus.candidateReconciliation.length} != ${audit.candidates.length}`,
    );
  const boundaryIds = new Set(corpus.transactionBoundaries.map((item) => item.boundaryId));
  const participantIds = new Set(corpus.transactionParticipants.map((item) => item.participantId));
  const expectedBoundaryIds = new Set(audit.boundaries.map((item) => item.boundaryId));
  if (!sameIds([...boundaryIds], [...expectedBoundaryIds]))
    add(issues, 'BOUNDARY_SET', 'Canonical boundary set differs from the AST audit.');
  if (
    !sameIds(
      corpus.transactionParticipants.map((item) => item.participantId),
      audit.participants.map((item) => item.participantId),
    )
  )
    add(issues, 'PARTICIPANT_SET', 'Canonical participant set differs from the AST audit.');
  if (
    !sameIds(
      corpus.transactionDelegates.map((item) => item.delegateId),
      audit.delegates.map((item) => item.delegateId),
    )
  )
    add(issues, 'DELEGATE_SET', 'Canonical delegate set differs from the AST audit.');
  if (
    !sameIds(
      corpus.excludedCandidates.map((item) => item.candidateId),
      audit.excluded.map((item) => item.candidateId),
    )
  )
    add(issues, 'EXCLUSION_SET', 'Excluded candidate set differs from the AST audit.');
  for (const boundary of corpus.transactionBoundaries) {
    const expectedBoundary = audit.boundaries.find(
      (item) => item.boundaryId === boundary.boundaryId,
    );
    const source = read(root, boundary.file);
    if (!source) add(issues, 'BOUNDARY_FILE', boundary.file);
    else {
      if (!source.includes(boundary.sourceEvidence.declarationNeedle))
        add(issues, 'BOUNDARY_DECLARATION', boundary.boundaryId);
      if (!source.includes(boundary.sourceEvidence.transactionNeedle))
        add(issues, 'BOUNDARY_TRANSACTION', boundary.boundaryId);
    }
    if (
      expectedBoundary &&
      boundary.productionReachability.status !== expectedBoundary.productionReachability.status
    )
      add(issues, 'REACHABILITY_DRIFT', boundary.boundaryId);
    if (expectedBoundary) {
      const expectedCallers = expectedBoundary.productionReachability.callers.map(
        (caller) => `${caller.file}:${caller.callNeedle}`,
      );
      const actualCallers = boundary.productionReachability.callers.map(
        (caller) => `${caller.file}:${caller.callNeedle}`,
      );
      if (
        expectedCallers.length !== actualCallers.length ||
        !expectedCallers.every((caller) => actualCallers.includes(caller))
      )
        add(issues, 'CALLER_SET', boundary.boundaryId);
    }
    if (boundary.productionReachability.status === 'REVIEW_REQUIRED')
      add(issues, 'PRODUCTION_REVIEW_REQUIRED', boundary.boundaryId);
    if (boundary.productionReachability.status === 'PROVEN') {
      if (boundary.productionReachability.callers.length === 0)
        add(issues, 'MISSING_CALLER', boundary.boundaryId);
      if (boundary.regressionEvidenceIds.length === 0)
        add(issues, 'MISSING_REGRESSION', boundary.boundaryId);
    }
    for (const caller of boundary.productionReachability.callers) {
      const callerSource = read(root, caller.file);
      if (!callerSource || !callerSource.includes(caller.callNeedle))
        add(issues, 'CALLER_CALLSITE', `${boundary.boundaryId}:${caller.file}`);
      if (caller.bindingEvidence.length === 0) add(issues, 'CALLER_BINDING', boundary.boundaryId);
      if (source && !caller.bindingEvidence.every((evidence) => source.includes(evidence)))
        add(issues, 'CALLER_BINDING', boundary.boundaryId);
    }
  }
  for (const participant of corpus.transactionParticipants)
    if (participant.ownedByBoundaryIds.some((id) => !boundaryIds.has(id)))
      add(issues, 'PARTICIPANT_OWNER', participant.participantId);
  for (const excluded of corpus.excludedCandidates)
    if (!seen.has(excluded.candidateId)) add(issues, 'EXCLUSION_TARGET', excluded.candidateId);
  const rawIds = new Set(audit.rawTransactionSites.map((item) => item.candidateId));
  const fixtureRawIds = new Set(corpus.rawTransactionSites.map((item) => item.candidateId));
  for (const id of rawIds) if (!fixtureRawIds.has(id)) add(issues, 'UNREGISTERED_RAW', id);
  for (const id of fixtureRawIds) if (!rawIds.has(id)) add(issues, 'STALE_RAW', id);
  const evidenceIds = new Set(corpus.regressionEvidence.map((item) => item.testEvidenceId));
  for (const evidence of corpus.regressionEvidence) {
    const source = read(root, evidence.file);
    if (!source) add(issues, 'REGRESSION_FILE', evidence.file);
    else {
      if (!activeTestTitles(source).has(evidence.testName))
        add(issues, 'REGRESSION_NAME', evidence.testName);
      if (!evidence.entrySymbol || evidence.path.length === 0)
        add(issues, 'REGRESSION_PATH', evidence.testEvidenceId);
      const coveredBoundary = evidence.covers
        .map((id) => corpus.transactionBoundaries.find((item) => item.boundaryId === id))
        .find((item): item is Boundary => item !== undefined);
      const allowedSources = [
        source,
        ...(coveredBoundary
          ? [
              read(root, coveredBoundary.file) ?? '',
              ...coveredBoundary.productionReachability.callers.map(
                (caller) => read(root, caller.file) ?? '',
              ),
            ]
          : []),
      ];
      if (!allowedSources.some((candidate) => sourceHasPathToken(candidate, evidence.entrySymbol)))
        add(issues, 'REGRESSION_ENTRY', evidence.testEvidenceId);
      for (const pathItem of evidence.path)
        if (!allowedSources.some((candidate) => sourceHasPathToken(candidate, pathItem)))
          add(issues, 'REGRESSION_PATH_SYMBOL', `${evidence.testEvidenceId}:${pathItem}`);
      if (
        coveredBoundary &&
        evidence.coverageKind === 'DIRECT_BOUNDARY' &&
        !new RegExp(
          `\\b${coveredBoundary.method.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*\\(`,
        ).test(source)
      )
        add(issues, 'REGRESSION_DIRECT_CALL', evidence.testEvidenceId);
      if (
        coveredBoundary &&
        evidence.coverageKind === 'DIRECT_BOUNDARY' &&
        !evidence.path.some((pathItem) => lastPathToken(pathItem) === coveredBoundary.method)
      )
        add(issues, 'REGRESSION_DIRECT_PATH', evidence.testEvidenceId);
    }
    if (evidence.covers.some((id) => !boundaryIds.has(id) && !participantIds.has(id)))
      add(issues, 'REGRESSION_TARGET', evidence.testEvidenceId);
  }
  for (const boundary of corpus.transactionBoundaries)
    for (const id of boundary.regressionEvidenceIds)
      if (!evidenceIds.has(id)) add(issues, 'REGRESSION_LINK', id);
  if (
    corpus.historicalReconciliation.length !== 87 ||
    corpus.summary.historicalRowsExplained !== 87 ||
    corpus.summary.historicalRowsUnexplained !== 0
  )
    add(issues, 'HISTORICAL_UNEXPLAINED', 'Historical rows are not fully explained.');
  for (const key of Object.keys(audit.counts) as Classification[])
    if (corpus.summary[key] !== audit.counts[key])
      add(issues, 'SUMMARY_COUNT', `${key}: ${corpus.summary[key]} != ${audit.counts[key]}`);
  if (corpus.summary.reconciliationTotal !== audit.candidates.length)
    add(issues, 'SUMMARY_TOTAL', 'reconciliationTotal does not equal the source candidate count.');
  const crosswalkPath = path.join(root, 'ts6-c2-r3-boundary-count-crosswalk.json');
  if (fs.existsSync(crosswalkPath)) {
    const crosswalk = JSON.parse(fs.readFileSync(crosswalkPath, 'utf8')) as CountCrosswalk;
    issues.push(...validateCountCrosswalk(crosswalk));
  } else add(issues, 'CROSSWALK_FILE', 'ts6-c2-r3-boundary-count-crosswalk.json is missing.');
  // C2-R15: independent validation of the approved regression-evidence relations.
  // Removes fixture self-reference ??a non-empty regressionEvidenceIds array alone
  // no longer satisfies regression coverage for a PROVEN boundary.
  for (const authorityIssue of checkRegressionEvidenceAuthority(
    root,
    corpus.transactionBoundaries,
    corpus.regressionEvidence,
  ))
    add(issues, authorityIssue.code, authorityIssue.message);
  return {
    valid: issues.length === 0,
    candidates: audit.candidates,
    rawSiteCount: audit.rawTransactionSites.length,
    counts: audit.counts,
    issues,
  };
};

const fixturePath = path.join(ROOT, V2_FIXTURE_RELATIVE_PATH);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(MODULE_PATH)) {
  if ((process.argv[2] ?? 'verify') === 'audit') {
    console.log(JSON.stringify(buildAuditShape(ROOT), null, 2));
  } else if (!fs.existsSync(fixturePath)) {
    console.error(`V2 fixture is missing: ${V2_FIXTURE_RELATIVE_PATH}`);
    process.exitCode = 1;
  } else {
    const result = validateCorpus(JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Corpus);
    console.log(
      JSON.stringify(
        {
          mode: 'verify',
          candidateCount: result.candidates.length,
          rawSiteCount: result.rawSiteCount,
          counts: result.counts,
          issueCount: result.issues.length,
          issues: result.issues,
        },
        null,
        2,
      ),
    );
    if (!result.valid) process.exitCode = 1;
  }
}
