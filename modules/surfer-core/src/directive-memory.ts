import { readSurferMemorySession } from '../../../packages/contracts/src/surfer-directive-memory.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import type {
  SurferDirectiveMemoryPayload,
  SurferDirectiveMemorySessionPort,
  SurferMemoryAnswer,
  SurferDirectiveScenarioEvaluationPort,
} from '../../../packages/contracts/src/surfer-directive-memory.js';
import { decodeSurferMemoryQuestion } from '../../../packages/contracts/src/surfer-directive-memory.js';
import type { SurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import { decodeSurferObservationSelections } from '../../../packages/contracts/src/surfer-cognition.js';
import { assertSurferSourceBasisV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { groundSurferDirectiveV2 } from './directive-v2.js';
import { parseSurferLiteral } from './cognition.js';

export type SurferRememberDirectiveRequest = SurferDirectiveMemoryPayload & {
  schemaVersion: '1.0.0';
  operationId: string;
  memoryId: string;
  expectedRevision: number | null;
  expectedActiveSnapshotId: string | null;
};
const levels = { public: 0, internal: 1, private: 2, restricted: 3 };
/** Stores unverified interpretation memories and consumes only currently authorized Source-bound snapshots. */
export class SurferDirectiveMemoryService {
  constructor(
    private readonly sessions: SurferDirectiveMemorySessionPort,
    private readonly scenarios: SurferDirectiveScenarioEvaluationPort,
  ) {}
  async remember(actor: unknown, input: unknown) {
    assertSurferJson(input);
    const r = structuredClone(input) as SurferRememberDirectiveRequest;
    if (
      !r ||
      Object.keys(r).sort().join(',') !==
        'basis,contract,expectedActiveSnapshotId,expectedRevision,memoryId,operationId,packet,schemaVersion,selections' ||
      r.schemaVersion !== '1.0.0' ||
      r.contract !== 'surfer.directive-memory.v1' ||
      typeof r.memoryId !== 'string' ||
      !r.memoryId.length ||
      r.memoryId.length > 96 ||
      typeof r.operationId !== 'string' ||
      !r.operationId.length ||
      r.operationId.length > 128 ||
      (r.expectedRevision !== null &&
        (!Number.isSafeInteger(r.expectedRevision) || r.expectedRevision < 1)) ||
      (r.expectedActiveSnapshotId !== null &&
        (typeof r.expectedActiveSnapshotId !== 'string' || !r.expectedActiveSnapshotId.length))
    )
      throw surferFailure('Invalid directive memory command.');
    assertSurferSourceBasisV2(r.basis);
    r.selections = decodeSurferObservationSelections({
      schemaVersion: '1.0.0',
      selections: r.selections,
    }).selections;
    if (!r.selections.length || r.selections.length > 8)
      throw surferFailure('Memory observation count exceeds its bounded profile.');
    return this.sessions.withSession(actor, async (session) => {
      const priorCreatedAt = await session.priorCreatedAt(r.operationId + ':append');
      const draft = await session.source.withCurrent(actor, r.basis, r.selections, (view) => {
        const packet = groundSurferDirectiveV2(r.packet, view);
        if (packet.clauses.proposal.interpretation.state !== 'RESOLVED' || !packet.meaning)
          throw surferFailure(
            'Only a resolved proposed interpretation can enter this memory slice.',
          );
        const payload: SurferDirectiveMemoryPayload = {
          contract: r.contract,
          basis: r.basis,
          selections: r.selections,
          packet,
        };
        const scope = {
          spaceId: r.basis.authority.projectId,
          accessScope: [...new Set(view.anchors.flatMap((a) => a.scope.accessScope))].sort(),
          sensitivity: view.anchors.reduce(
            (n, a) => (levels[a.scope.sensitivity] > levels[n] ? a.scope.sensitivity : n),
            'public' as keyof typeof levels,
          ),
        };
        return {
          schemaVersion: '1.0.0' as const,
          artifactId: r.memoryId,
          revision: (r.expectedRevision ?? 0) + 1,
          kind: 'INTERPRETATION' as const,
          origin: 'INTERPRETATION' as const,
          scope,
          domain: 'surfer.directive-memory.v1',
          createdAt: priorCreatedAt ?? view.readReceipt.observedAt,
          observedAt: r.basis.readWatermark.observedAt,
          producer: {
            engineRevision: 'surfer.directive-memory.v1',
            modelRevision: packet.clauses.frame.producer.modelRevision,
            policyRevision: r.basis.authority.policyRevision,
            executionId: packet.clauses.frame.producer.executionRef,
          },
          payloadSchema: 'surfer.opaque.v1' as const,
          payload,
          basis: r.basis.coreBasis,
        };
      });
      const appended = await session.commit({
          schemaVersion: '2.0.0',
          basis: r.basis,
          command: {
            action: 'APPEND_ARTIFACT',
            operationId: r.operationId + ':append',
            expectedRevision: r.expectedRevision,
            draft,
          },
        }),
        artifact: SurferArtifactRef = {
          artifactId: appended.commit.subjectId,
          revision: appended.commit.revision,
          digest: appended.commit.digest,
        },
        snapshotId = r.memoryId + ':snapshot:' + artifact.revision;
      const published = await session.commit({
        schemaVersion: '2.0.0',
        basis: null,
        command: {
          action: 'PUBLISH_SNAPSHOT',
          operationId: r.operationId + ':publish',
          snapshotId,
          expectedActiveSnapshotId: r.expectedActiveSnapshotId,
          entries: [artifact],
          engineRevision: 'surfer.directive-memory.v1',
          createdAt: draft.createdAt,
        },
      });
      return {
        schemaVersion: '1.0.0' as const,
        artifact,
        snapshotId,
        snapshotDigest: published.commit.digest,
        replayed: appended.replayed && published.replayed,
        semanticAssessment: 'NOT_EVALUATED' as const,
        modelCalls: 0,
      };
    });
  }
  async ask(actor: unknown, input: unknown) {
    const q = decodeSurferMemoryQuestion(input);
    if (new Set(q.observations.map((o) => o.predicateId)).size !== q.observations.length)
      throw surferFailure('Duplicate question observations.');
    if (q.atDate && parseSurferLiteral(q.atDate).kind !== 'DATE')
      throw surferFailure('Invalid scenario date.');
    if (q.kind === 'RECALL' && (q.observations.length || q.atDate))
      throw surferFailure('Recall cannot silently consume unused scenario premises.');
    try {
      return await readSurferMemorySession(this.sessions, actor, async (session) => {
        const read = await session.read(q.snapshotId);
        if (read.status !== 'CURRENT')
          return { status: 'SOURCE_UNAVAILABLE', answers: [], modelCalls: 0 } as const;
        if (read.result.artifacts.length > 16)
          throw surferFailure('Memory read exceeds its bounded profile.');
        const answers: SurferMemoryAnswer[] = [];
        for (const stored of read.result.artifacts) {
          if (stored.kind !== 'INTERPRETATION' || stored.domain !== 'surfer.directive-memory.v1')
            continue;
          const payload = stored.payload as unknown as SurferDirectiveMemoryPayload;
          if (
            Object.keys(payload).sort().join(',') !== 'basis,contract,packet,selections' ||
            payload.contract !== 'surfer.directive-memory.v1'
          )
            throw surferFailure('Stored memory schema is corrupt.');
          if (surferDigest(stored.basis) !== surferDigest(payload.basis.coreBasis))
            throw surferFailure('Stored memory payload uses different Source premises.');
          const answer = await session.source.withCurrent(
            actor,
            payload.basis,
            payload.selections,
            (view) => {
              const packet = groundSurferDirectiveV2(payload.packet, view),
                v = packet.clauses.proposal.interpretation;
              if (v.state !== 'RESOLVED' || !packet.meaning)
                throw surferFailure('Stored memory is unresolved.');
              const subject = v.structure.entities.find(
                  (e) =>
                    e.id ===
                    v.structure.predicates.find((p) => p.id === v.structure.assertion.target)!
                      .subject,
                )!.mention,
                anchor = view.anchors.find((a) => a.anchorId === subject.anchorRef.anchorId)!,
                subjectText = Array.from(anchor.rawLiteral)
                  .slice(subject.start, subject.end)
                  .join('');
              if (subjectText !== q.subject || packet.meaning.action.operationQuote !== q.operation)
                return null;
              return {
                memory: {
                  artifactId: stored.artifactId,
                  revision: stored.revision,
                  digest: stored.digest,
                },
                ...this.scenarios.evaluate(packet, q),
                declaredMode: packet.meaning.action.mode,
                citations: [
                  ...packet.clauses.bindings.map((b) => {
                    const a = view.anchors.find(
                      (a) => a.anchorId === b.mention.anchorRef.anchorId,
                    )!;
                    return {
                      role: b.role,
                      predicateId: b.predicateId,
                      sourceId: a.source.sourceId,
                      sourceVersionId: a.source.sourceVersionId,
                      evidenceId: a.source.evidenceId,
                      revisionId: a.source.revisionId,
                      start: a.position.start + b.mention.start,
                      end: a.position.start + b.mention.end,
                      quote: b.quote,
                    };
                  }),
                  (() => {
                    const e = packet.meaning!.action.evidence,
                      a = view.anchors.find((a) => a.anchorId === e.anchorRef.anchorId)!;
                    return {
                      role: 'ACTION_CONTEXT' as const,
                      predicateId: v.structure.assertion.target,
                      sourceId: a.source.sourceId,
                      sourceVersionId: a.source.sourceVersionId,
                      evidenceId: a.source.evidenceId,
                      revisionId: a.source.revisionId,
                      start: a.position.start + e.start,
                      end: a.position.start + e.end,
                      quote: packet.meaning!.action.evidenceQuote,
                    };
                  })(),
                ],
                producer: packet.clauses.frame.producer,
                assessment: 'DECLARED_INTERPRETATION_NOT_VERIFIED_RULE' as const,
              };
            },
          );
          if (answer) answers.push(answer);
        }
        const modes = new Set(
            answers.map((a) => (q.kind === 'RECALL' ? a.declaredMode : a.outcome)),
          ),
          conflict =
            (modes.has('REQUIRED') && modes.has('PROHIBITED')) ||
            (modes.has('ASSERTED') && modes.has('DENIED'));
        return {
          status: conflict
            ? 'CONFLICT'
            : !answers.length || answers.every((a) => a.outcome === 'UNKNOWN')
              ? 'UNKNOWN'
              : answers.some((a) => a.outcome === 'UNKNOWN')
                ? 'PARTIAL'
                : 'ANSWER',
          answers,
          snapshot: {
            snapshotId: read.result.snapshot.snapshotId,
            digest: read.result.snapshot.digest,
            isActive: read.result.isActive,
          },
          readReceipt: read.readReceipt,
          semanticAssessment: 'NOT_EVALUATED',
          premisesOrigin: 'CALLER_SUPPLIED_SCENARIO',
          execution: 'ADVISORY_NOT_ACTION',
          modelCalls: 0,
        };
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
              : e.code === 'NOT_FOUND'
                ? 'UNKNOWN'
                : 'SOURCE_UNAVAILABLE',
          answers: [],
          modelCalls: 0,
        };
      throw e;
    }
  }
}
