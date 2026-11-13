import { readSurferRuleMemorySession } from '../../../packages/contracts/src/surfer-rule-memory.js';
import { readSurferChainState } from './rule-chain-state.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import type {
  SurferScopedRuleMemorySessionPort,
  SurferScopedRuleProofPort,
} from '../../../packages/contracts/src/surfer-rule-memory.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
  type SurferObservation,
} from '../../../packages/contracts/src/surfer-learning.js';
import type { SurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import { type SurferSourceBasisV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import { validateSurferScopedRuleProof } from './scoped-rule-proof.js';
import { applySurferScopedRule, applySurferObservedRule } from './scoped-rule-application.js';
import {
  validateSurferReplacementMemory,
  readSurferReplacementSources,
} from './replacement-proof.js';
export { applySurferScopedRule } from './scoped-rule-application.js';
import {
  validateSurferRuleMemoryBinding as validateBinding,
  readSurferRuleReviewViews,
  surferRuleUseState,
  surferRuleReviewDiagnoses,
  type SurferAnyRuleMemoryPayload,
  type SurferRuleMemoryPayload as Payload,
} from './rule-memory-state.js';

const revision = 'surfer.scoped-rule-memory.v1';
type Remember = {
  schemaVersion: '1.0.0';
  contract: typeof revision;
  operationId: string;
  memoryId: string;
  proofId: string;
  expectedRevision: number | null;
  expectedActiveSnapshotId: string | null;
};
type Question = {
  schemaVersion: '1.0.0';
  contract: 'surfer.scoped-rule-question.v1';
  snapshotId: string | null;
  memoryId: string;
  kind: 'RECALL' | 'APPLY';
  features: Record<string, SurferObservation>;
};
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const exact = (v: object, keys: string) => Object.keys(v).sort().join(',') === keys;
const stale = () =>
  new ShotgunError({
    code: 'STALE_VERSION',
    safeMessage: 'The rule collection is no longer current.',
    module: 'surfer.learning',
    operation: 'rule-memory',
  });

/** Bounded typed backend. Reuses the existing Source/knowledge MVCC session; grants no Action authority. */
export class SurferScopedRuleMemoryService {
  constructor(
    private readonly sessions: SurferScopedRuleMemorySessionPort,
    private readonly proofs?: SurferScopedRuleProofPort,
  ) {}
  async remember(actor: unknown, input: unknown) {
    assertSurferJson(input);
    const r = structuredClone(input) as Remember;
    if (
      !r ||
      !exact(
        r,
        'contract,expectedActiveSnapshotId,expectedRevision,memoryId,operationId,proofId,schemaVersion',
      ) ||
      r.schemaVersion !== '1.0.0' ||
      r.contract !== revision ||
      !text(r.memoryId, 96) ||
      !text(r.operationId, 112) ||
      !text(r.proofId, 71) ||
      !/^sha256:[a-f0-9]{64}$/.test(r.proofId) ||
      (r.expectedRevision !== null &&
        (!Number.isSafeInteger(r.expectedRevision) || r.expectedRevision < 1)) ||
      (r.expectedActiveSnapshotId !== null && !text(r.expectedActiveSnapshotId, 256)) ||
      !this.proofs
    )
      throw surferFailure('Invalid scoped rule memory command/proof capability.');
    const prepared = this.proofs.prepared(r.proofId),
      proofs = this.proofs;
    return this.sessions.withSession(actor, async (s) => {
      const prior = await s.findCommit(r.operationId + ':publish'),
        selected = prior?.subjectId ?? r.expectedActiveSnapshotId;
      if (prior && prior.subjectKind !== 'SNAPSHOT')
        throw surferFailure('Invalid rule publication replay.');
      let retained: SurferArtifactRef[] = [];
      if (selected) {
        const read = await s.read(selected);
        if (read.status !== 'CURRENT' || (!prior && !read.result.isActive)) throw stale();
        const previousRule = read.result.artifacts.find((a) => a.artifactId === r.memoryId);
        if (
          !prior &&
          r.expectedRevision !== null &&
          (!previousRule || previousRule.revision !== r.expectedRevision)
        )
          throw surferFailure('An existing rule must be present at its expected active revision.');
        if (
          !prior &&
          previousRule &&
          (previousRule.payload as unknown as { contract?: string }).contract !==
            'surfer.scoped-rule-memory.v1'
        )
          throw surferFailure(
            'Reviewed rules require a separately evaluated replacement;ordinary remember cannot erase their history.',
          );
        retained = read.result.snapshot.entries
          .filter((e) => e.artifactId !== r.memoryId)
          .map((e) => ({ ...e }));
      }
      if (retained.length >= 16)
        throw surferFailure('Rule collection exceeds its 16-entry profile.');
      const view = await s.source.withCurrent(actor, prepared.basis, prepared.selections, (v) => v),
        payload = validateSurferScopedRuleProof(await proofs.read(r.proofId, view), view);
      if (
        payload.proofId !== r.proofId ||
        surferDigest(payload.basis) !== surferDigest(prepared.basis) ||
        surferDigest(payload.selections) !== surferDigest(prepared.selections)
      )
        throw surferFailure('Prepared proof capability changed its Source selection.');
      const priorAppend = await s.findCommit(r.operationId + ':append');
      let knowledgeBasis: SurferSourceBasisV2;
      if (priorAppend) {
        const old = await s.readArtifact({
            artifactId: priorAppend.subjectId,
            revision: priorAppend.revision,
            digest: priorAppend.digest,
          }),
          oldPayload = old.payload as unknown as Payload;
        validateBinding(oldPayload);
        if (surferDigest(oldPayload.proof) !== surferDigest(payload))
          throw surferFailure('Rule replay proof changed meaning.');
        knowledgeBasis = oldPayload.knowledgeBasis;
      } else {
        const sourceIds = payload.basis.sources.map((x) => x.sourceId).sort();
        knowledgeBasis = (
          await s.captureRule({
            schemaVersion: '2.0.0',
            sourceIds,
            artifacts: [],
            queries: [{ kind: 'EXPLICIT_SOURCE_SET', sourceIds }],
          })
        ).basis;
      }
      const storedPayload: Payload = { contract: revision, proof: payload, knowledgeBasis };
      validateBinding(storedPayload);
      const createdAt =
          (await s.priorCreatedAt(r.operationId + ':append')) ?? view.readReceipt.observedAt,
        draft = {
          schemaVersion: '1.0.0' as const,
          artifactId: r.memoryId,
          revision: (r.expectedRevision ?? 0) + 1,
          kind: 'RULE' as const,
          origin: 'INDUCTION' as const,
          scope: payload.candidate.scope,
          domain: revision,
          createdAt,
          observedAt: payload.basis.readWatermark.observedAt,
          producer: {
            engineRevision: revision,
            modelRevision: payload.candidate.proposer.model,
            policyRevision: payload.basis.authority.policyRevision,
            executionId: payload.candidate.proposer.executionId,
          },
          payloadSchema: 'surfer.opaque.v1' as const,
          payload: storedPayload,
          basis: knowledgeBasis.coreBasis,
        },
        appended = await s.commit({
          schemaVersion: '2.0.0',
          basis: knowledgeBasis,
          command: {
            action: 'APPEND_ARTIFACT',
            operationId: r.operationId + ':append',
            expectedRevision: r.expectedRevision,
            draft,
          },
        }),
        artifact = {
          artifactId: appended.commit.subjectId,
          revision: appended.commit.revision,
          digest: appended.commit.digest,
        },
        snapshotId = r.memoryId + ':rule-snapshot:' + artifact.revision,
        entries = [...retained, artifact].sort((a, b) =>
          a.artifactId < b.artifactId ? -1 : a.artifactId > b.artifactId ? 1 : 0,
        ),
        published = await s.commit({
          schemaVersion: '2.0.0',
          basis: null,
          command: {
            action: 'PUBLISH_SNAPSHOT',
            operationId: r.operationId + ':publish',
            snapshotId,
            expectedActiveSnapshotId: r.expectedActiveSnapshotId,
            entries,
            engineRevision: revision,
            createdAt,
          },
        });
      return {
        schemaVersion: '1.0.0',
        artifact,
        snapshotId,
        snapshotDigest: published.commit.digest,
        memoryCount: entries.length,
        replayed: appended.replayed && published.replayed,
        semanticAssessment: 'NOT_EVALUATED',
        execution: 'ADVISORY_NOT_ACTION',
        modelCalls: 0,
      } as const;
    });
  }
  async ask(actor: unknown, input: unknown) {
    assertSurferJson(input);
    const q = structuredClone(input) as Question;
    if (
      !q ||
      !exact(q, 'contract,features,kind,memoryId,schemaVersion,snapshotId') ||
      q.schemaVersion !== '1.0.0' ||
      q.contract !== 'surfer.scoped-rule-question.v1' ||
      !text(q.memoryId, 96) ||
      (q.snapshotId !== null && !text(q.snapshotId, 256)) ||
      !['RECALL', 'APPLY'].includes(q.kind) ||
      !q.features ||
      typeof q.features !== 'object' ||
      Array.isArray(q.features) ||
      Object.keys(q.features).length > 8 ||
      (q.kind === 'RECALL' && Object.keys(q.features).length)
    )
      throw surferFailure('Invalid scoped rule question.');
    try {
      return await readSurferRuleMemorySession(this.sessions, actor, async (s) => {
        const read = await s.read(q.snapshotId);
        if (read.status !== 'CURRENT')
          return { status: 'SOURCE_UNAVAILABLE', answers: [], modelCalls: 0 } as const;
        if (read.result.artifacts.length > 16)
          throw surferFailure('Rule collection read exceeds its profile.');
        const stored = read.result.artifacts.find(
          (a) => a.artifactId === q.memoryId && a.kind === 'RULE' && a.domain === revision,
        );
        if (!stored) return { status: 'UNKNOWN', answers: [], modelCalls: 0 } as const;
        if (
          (stored.payload as { contract?: string }).contract === 'surfer.superseded-rule-memory.v1'
        )
          return { status: 'UNKNOWN', answers: [], modelCalls: 0 } as const;
        if ((stored.payload as { contract?: string }).contract === 'surfer.rule-chain-memory.v1') {
          const state = await readSurferChainState(s, actor, stored),
            qualified = state.qualifications.at(-1),
            start = qualified?.plan.observations.length ?? 0,
            answer = {
              memory: {
                artifactId: stored.artifactId,
                revision: stored.revision,
                digest: stored.digest,
              },
              candidate: state.candidate,
              validation: qualified?.receipt ?? state.baseline.receipt,
              originalValidation: state.baseline.prepared.parent.proof.receipt,
              proofId: surferDigest({
                baseline: state.manifest!.baseline,
                qualifications: state.manifest!.qualifications,
              }),
              reviews: state.observations.slice(start).map((e, i) => ({
                eventId: e.observation.eventId,
                eventGroup: e.observation.eventGroup,
                observationDigest: e.observationDigest,
                diagnosis: state.diagnoses[i]!,
              })),
              parentReviews: surferRuleReviewDiagnoses(state.baseline.prepared.parent),
              state: state.state,
              generation: state.generation,
              lineage: {
                parent: state.manifest!.previous,
                reviewCount: state.observations.length,
                preparationDigest:
                  qualified?.plan.sourceDigest ?? surferDigest(state.baseline.prepared),
              },
              ...(state.state !== 'ACTIVE'
                ? { outcome: 'UNKNOWN', reasons: ['RULE_' + state.state] }
                : q.kind === 'RECALL'
                  ? { outcome: 'RECALLED', reasons: [] }
                  : applySurferObservedRule(state.candidate, state.cases, q.features)),
              citations: state.views
                .flatMap((v) => v.anchors)
                .map((a) => ({
                  sourceId: a.source.sourceId,
                  sourceVersionId: a.source.sourceVersionId,
                  evidenceId: a.source.evidenceId,
                  revisionId: a.source.revisionId,
                  start: a.position.start,
                  end: a.position.end,
                  quote: a.rawLiteral,
                })),
              assessment: 'SCOPED_CHAIN_EMPIRICAL_NOT_FACT',
            };
          return {
            status: answer.outcome === 'UNKNOWN' ? 'UNKNOWN' : 'ANSWER',
            answers: [answer],
            snapshot: {
              snapshotId: read.result.snapshot.snapshotId,
              digest: read.result.snapshot.digest,
              isActive: read.result.isActive,
            },
            semanticAssessment: 'NOT_EVALUATED',
            premisesOrigin: 'CALLER_SUPPLIED_SCENARIO',
            execution: 'ADVISORY_NOT_ACTION',
            modelCalls: 0,
          } as const;
        }
        if (
          (stored.payload as { contract?: string }).contract === 'surfer.rule-replacement-memory.v1'
        ) {
          const m = validateSurferReplacementMemory(stored.payload);
          if (
            m.prepared.input.successorId !== stored.artifactId ||
            stored.revision !== 1 ||
            surferDigest(stored.basis) !==
              surferDigest(m.prepared.parent.knowledgeBasis.coreBasis) ||
            surferDigest(stored.scope) !== surferDigest(m.prepared.scope)
          )
            throw surferFailure('Stored successor binding differs.');
          const views = await readSurferReplacementSources(s.source, actor, m.prepared),
            answer = {
              memory: {
                artifactId: stored.artifactId,
                revision: stored.revision,
                digest: stored.digest,
              },
              candidate: m.candidate,
              validation: m.receipt,
              originalValidation: m.prepared.parent.proof.receipt,
              proofId: surferDigest(m.prepared),
              reviews: [],
              parentReviews: surferRuleReviewDiagnoses(m.prepared.parent),
              state: 'ACTIVE',
              lineage: {
                parent: m.prepared.input.expectedArtifact,
                reviewCount: m.prepared.parent.reviews.length,
                preparationDigest: surferDigest(m.prepared),
              },
              ...(q.kind === 'RECALL'
                ? { outcome: 'RECALLED', reasons: [] }
                : applySurferObservedRule(m.candidate, m.prepared.development.cases, q.features)),
              citations: views
                .flatMap((v) => v.anchors)
                .map((a) => ({
                  sourceId: a.source.sourceId,
                  sourceVersionId: a.source.sourceVersionId,
                  evidenceId: a.source.evidenceId,
                  revisionId: a.source.revisionId,
                  start: a.position.start,
                  end: a.position.end,
                  quote: a.rawLiteral,
                })),
              assessment: 'SCOPED_AUTHORED_REPLACEMENT_NOT_FACT',
            };
          return {
            status: answer.outcome === 'UNKNOWN' ? 'UNKNOWN' : 'ANSWER',
            answers: [answer],
            snapshot: {
              snapshotId: read.result.snapshot.snapshotId,
              digest: read.result.snapshot.digest,
              isActive: read.result.isActive,
            },
            semanticAssessment: 'NOT_EVALUATED',
            premisesOrigin: 'CALLER_SUPPLIED_SCENARIO',
            execution: 'ADVISORY_NOT_ACTION',
            modelCalls: 0,
          } as const;
        }
        const memoryPayload = stored.payload as unknown as SurferAnyRuleMemoryPayload;
        validateBinding(memoryPayload);
        if (
          memoryPayload.contract === 'surfer.scoped-rule-memory.v2' &&
          (memoryPayload.previous.artifactId !== stored.artifactId ||
            memoryPayload.previous.revision + 1 !== stored.revision)
        )
          throw surferFailure('Stored rule revision lineage differs.');
        const payload = memoryPayload.proof,
          reviewViews = await readSurferRuleReviewViews(s.source, actor, memoryPayload),
          state = surferRuleUseState(memoryPayload);
        if (surferDigest(stored.basis) !== surferDigest(memoryPayload.knowledgeBasis.coreBasis))
          throw surferFailure('Stored rule Source premises differ.');
        const answer = await s.source.withCurrent(
          actor,
          payload.basis,
          payload.selections,
          (view) => {
            const p = validateSurferScopedRuleProof(payload, view);
            const anchors = [...view.anchors, ...reviewViews.flatMap((v) => v.anchors)],
              levels = { public: 0, internal: 1, private: 2, restricted: 3 },
              scope = {
                spaceId: p.candidate.scope.spaceId,
                accessScope: [...new Set(anchors.flatMap((a) => a.scope.accessScope))].sort(),
                sensitivity: anchors.reduce(
                  (level, a) =>
                    levels[a.scope.sensitivity] > levels[level] ? a.scope.sensitivity : level,
                  'public' as keyof typeof levels,
                ),
              };
            if (surferDigest(stored.scope) !== surferDigest(scope))
              throw surferFailure('Stored rule scope differs.');
            return {
              memory: {
                artifactId: stored.artifactId,
                revision: stored.revision,
                digest: stored.digest,
              },
              candidate: p.candidate,
              validation: p.receipt,
              proofId: p.proofId,
              state,
              reviews: surferRuleReviewDiagnoses(memoryPayload),
              ...(state !== 'ACTIVE'
                ? { outcome: 'UNKNOWN', reasons: ['RULE_' + state] }
                : q.kind === 'RECALL'
                  ? { outcome: 'RECALLED', reasons: [] }
                  : applySurferScopedRule(p, q.features)),
              citations: anchors.map((a) => ({
                sourceId: a.source.sourceId,
                sourceVersionId: a.source.sourceVersionId,
                evidenceId: a.source.evidenceId,
                revisionId: a.source.revisionId,
                start: a.position.start,
                end: a.position.end,
                quote: a.rawLiteral,
              })),
              assessment: 'SCOPED_AUTHORED_RULE_NOT_FACT',
            };
          },
        );
        return {
          status: answer.outcome === 'UNKNOWN' ? 'UNKNOWN' : 'ANSWER',
          answers: [answer],
          snapshot: {
            snapshotId: read.result.snapshot.snapshotId,
            digest: read.result.snapshot.digest,
            isActive: read.result.isActive,
          },
          semanticAssessment: 'NOT_EVALUATED',
          premisesOrigin: 'CALLER_SUPPLIED_SCENARIO',
          execution: 'ADVISORY_NOT_ACTION',
          modelCalls: 0,
        } as const;
      });
    } catch (e) {
      if (
        e instanceof ShotgunError &&
        ['POLICY_DENIED', 'STALE_VERSION', 'NOT_FOUND'].includes(e.code)
      )
        return {
          status:
            e.code === 'POLICY_DENIED'
              ? 'BLOCKED'
              : e.code === 'STALE_VERSION'
                ? 'SOURCE_UNAVAILABLE'
                : 'UNKNOWN',
          answers: [],
          modelCalls: 0,
        } as const;
      throw e;
    }
  }
}
