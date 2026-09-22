/**
 * TS-6 Phase B C2-R15 — regression-evidence authority checks.
 *
 * Implements the independent-validation invariants that remove fixture
 * self-reference from regression-coverage validation:
 *
 *   A. evidence-ID existence      every boundary.regressionEvidenceIds[] resolves
 *                                 to a real regression-evidence object
 *   B. bidirectional integrity    evidence.covers[] and boundary.regressionEvidenceIds
 *                                 must agree in both directions
 *   C. independent resolution     every approved relation must resolve against the
 *                                 actual source/test corpus per its coverageKind
 *   D. coverage completeness      every PROVEN boundary must have >=1 independently
 *                                 resolved approved evidence relation
 *
 * `MISSING_REGRESSION` remains reserved for a boundary with no declared evidence
 * relation at all. The checks below add semantically distinct failure classes.
 */
import {
  resolveEvidence,
  type ApprovedEvidenceRecord,
} from './ts6-phase-b-regression-evidence-resolver.js';

export type AuthorityIssue = {
  readonly code: string;
  readonly message: string;
  readonly boundaryId?: string;
};

type BoundaryShape = {
  readonly boundaryId: string;
  readonly file: string;
  readonly symbol: string;
  readonly method: string;
  readonly productionReachability: {
    readonly status: string;
    readonly callers?: readonly { readonly file: string }[];
  };
  readonly regressionEvidenceIds: readonly string[];
};

export type EvidenceShape = {
  readonly testEvidenceId: string;
  /**
   * The test block identity. The fixture carries these explicitly, and a record's
   * `testEvidenceId` may carry a relation suffix, so these are authoritative when
   * present. They are optional so an ad-hoc shape can still be validated by id.
   */
  readonly file?: string;
  readonly testName?: string;
  readonly covers: readonly string[];
  /**
   * Widened to `string` on purpose: a fixture record stores this as free text and
   * the resolver narrows it when it classifies the relation, so requiring the
   * literal union here would reject a structurally valid corpus at the call site.
   */
  readonly coverageKind: string;
  readonly entrySymbol: string;
  readonly path: readonly string[];
};

export const checkRegressionEvidenceAuthority = (
  root: string,
  boundaries: readonly BoundaryShape[],
  evidence: readonly EvidenceShape[],
): AuthorityIssue[] => {
  const issues: AuthorityIssue[] = [];
  const byId = new Map(evidence.map((e) => [e.testEvidenceId, e]));
  const boundaryById = new Map(boundaries.map((b) => [b.boundaryId, b]));

  // ---- A. evidence-ID existence
  for (const boundary of boundaries) {
    for (const id of boundary.regressionEvidenceIds) {
      if (!byId.has(id))
        issues.push({
          code: 'REGRESSION_EVIDENCE_ID_UNRESOLVED',
          message: `${boundary.boundaryId} references evidence "${id}" which does not exist`,
          boundaryId: boundary.boundaryId,
        });
    }
  }

  // ---- B. bidirectional integrity
  for (const record of evidence) {
    for (const covered of record.covers) {
      const boundary = boundaryById.get(covered);
      if (!boundary) {
        issues.push({
          code: 'REGRESSION_TARGET_UNREGISTERED',
          message: `evidence "${record.testEvidenceId}" declares unknown target "${covered}"`,
        });
        continue;
      }
      if (!boundary.regressionEvidenceIds.includes(record.testEvidenceId))
        issues.push({
          code: 'REGRESSION_BACKREF_MISSING',
          message: `evidence "${record.testEvidenceId}" covers ${covered} but the boundary does not back-reference it`,
          boundaryId: covered,
        });
    }
  }
  for (const boundary of boundaries) {
    for (const id of boundary.regressionEvidenceIds) {
      const record = byId.get(id);
      if (!record) continue; // already reported under A
      if (!record.covers.includes(boundary.boundaryId))
        issues.push({
          code: 'REGRESSION_BACKREF_MISMATCH',
          message: `${boundary.boundaryId} back-references "${id}" but that evidence covers ${record.covers.join(', ') || '(nothing)'}`,
          boundaryId: boundary.boundaryId,
        });
    }
  }

  // ---- C. independent resolution, at RELATION granularity ----------------
  // An evidence record is not the unit of coverage: a relation is
  // (boundaryId, testEvidenceId). The historical v2 fixture has 69 evidence
  // records but 112 boundary->evidence edges, so record-level bookkeeping would
  // let one resolving target vouch for another target of the same record.
  // Every declared `covers[]` target is therefore resolved independently.
  const resolvedRelations = new Set<string>(); // `${boundaryId}\u0000${testEvidenceId}`
  const resolvedEvidenceIds = new Set<string>(); // retained for reporting only
  const relationKey = (boundaryId: string, evidenceId: string): string =>
    `${boundaryId}\u0000${evidenceId}`;
  for (const record of evidence) {
    const targets = record.covers.length ? record.covers : [];
    for (const boundaryId of targets) {
      // Prefer the record's explicit block identity. `parseId` is only a fallback
      // for shapes that omit it, because a relation-scoped record's id carries a
      // suffix that is not part of the test title.
      // The validator resolves the declared block from `evidence.file` and
      // `evidence.testName`; the authority must check the SAME block. Parsing the
      // id is only a fallback for shapes that omit those fields, because a
      // relation-scoped record's id carries a suffix that is not part of the
      // title. `C2R15_BASELINE_OLD_AUTHORITY=1` restores id-only parsing so the
      // recorded 121-issue baseline can be compared against the corrected 119.
      const parsed = parseId(record.testEvidenceId);
      const legacy = process.env.C2R15_BASELINE_OLD_AUTHORITY === '1';
      const base: ApprovedEvidenceRecord = {
        testEvidenceId: record.testEvidenceId,
        targetBoundaryId: boundaryId,
        coverageKind: record.coverageKind,
        entrySymbol: record.entrySymbol,
        path: record.path ?? [],
        testFile: (legacy ? parsed?.file : (record.file ?? parsed?.file)) ?? '',
        testTitle: (legacy ? parsed?.title : (record.testName ?? parsed?.title)) ?? '',
      };
      const boundary = boundaryById.get(boundaryId);
      const target = boundary
        ? { file: boundary.file, symbol: boundary.symbol, method: boundary.method }
        : null;
      const withHops: ApprovedEvidenceRecord = boundary
        ? {
            ...base,
            licensedHopFiles: [
              ...new Set((boundary.productionReachability.callers ?? []).map((c) => c.file)),
            ],
          }
        : base;
      const resolution = resolveEvidence(root, withHops, target);
      if (resolution.resolved) {
        resolvedRelations.add(relationKey(boundaryId, record.testEvidenceId));
        resolvedEvidenceIds.add(record.testEvidenceId);
        continue;
      }
      issues.push({
        code: resolution.issueCode ?? 'REGRESSION_EVIDENCE_UNRESOLVED',
        message: `${boundaryId} <- "${record.testEvidenceId}": ${resolution.status} — ${resolution.evidence.join(' | ')}`,
        boundaryId,
      });
    }
  }

  // ---- D. coverage completeness, at RELATION granularity -----------------
  for (const boundary of boundaries) {
    if (boundary.productionReachability.status !== 'PROVEN') continue;
    if (boundary.regressionEvidenceIds.length === 0) continue; // MISSING_REGRESSION handles this
    // Only a RESOLVED (boundary, evidence) relation counts as coverage.
    const anyResolvedRelation = boundary.regressionEvidenceIds.some((id) =>
      resolvedRelations.has(relationKey(boundary.boundaryId, id)),
    );
    if (!anyResolvedRelation)
      issues.push({
        code: 'REGRESSION_COVERAGE_INCOMPLETE',
        message: `${boundary.boundaryId} is PROVEN but none of its declared (boundary, evidence) relations independently resolve`,
        boundaryId: boundary.boundaryId,
      });
  }

  return issues;
};

const parseId = (testEvidenceId: string): { file: string; title: string } | null => {
  const body = testEvidenceId.startsWith('test:')
    ? testEvidenceId.slice('test:'.length)
    : testEvidenceId;
  const m = body.match(/^(.*?\.(?:test|spec)\.tsx?):(.*)$/);
  if (m?.[1] !== undefined && m[2] !== undefined) return { file: m[1], title: m[2] };
  const i = body.indexOf(':');
  if (i < 0) return null;
  return { file: body.slice(0, i), title: body.slice(i + 1) };
};
