import { reviewSurferChain } from './rule-chain-review.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import type { SurferScopedRuleMemorySessionPort } from '../../../packages/contracts/src/surfer-rule-memory.js';
import {
  assertSurferSourceBasisV2,
  type SurferSourceBasisV2,
} from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import {
  decodeSurferObservationSelections,
  type SurferObservationSelection,
} from '../../../packages/contracts/src/surfer-cognition.js';
import {
  decodeSurferRuleObservation,
  type SurferRuleReviewAction,
} from '../../../packages/contracts/src/surfer-rule-review.js';
import type { SurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { validateSurferScopedRuleProof } from './scoped-rule-proof.js';
import { diagnoseSurferRuleObservation } from './rule-review-diagnosis.js';
import {
  validateSurferRuleMemoryBinding,
  surferRuleUseState,
  readSurferRuleReviewViews,
  SURFER_RULE_MEMORY_DOMAIN,
  type SurferAnyRuleMemoryPayload,
  type SurferReviewedRuleMemoryPayload,
} from './rule-memory-state.js';
type Request = {
  schemaVersion: '1.0.0';
  contract: 'surfer.rule-review.v1';
  operationId: string;
  expectedArtifact: SurferArtifactRef;
  expectedActiveSnapshotId: string;
  action: SurferRuleReviewAction;
  basis: SurferSourceBasisV2;
  selections: SurferObservationSelection[];
};
const exact = (v: object, keys: string) => Object.keys(v).sort().join(',') === keys;
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const stale = () =>
  new ShotgunError({
    code: 'STALE_VERSION',
    safeMessage: 'The expected rule/snapshot is no longer current.',
    module: 'surfer.learning',
    operation: 'review-rule',
  });
const eventMeaning = (v: ReturnType<typeof decodeSurferRuleObservation>) => {
  const { eventId: _id, ...rest } = v;
  return surferDigest(rest);
};
/** Source-grounded empirical review; no generator/evaluator/Fact/Action capability. */
export class SurferScopedRuleReviewService {
  constructor(private readonly sessions: SurferScopedRuleMemorySessionPort) {}
  async review(actor: unknown, input: unknown) {
    assertSurferJson(input);
    const r = structuredClone(input) as Request;
    if (
      !r ||
      !exact(
        r,
        'action,basis,contract,expectedActiveSnapshotId,expectedArtifact,operationId,schemaVersion,selections',
      ) ||
      r.schemaVersion !== '1.0.0' ||
      r.contract !== 'surfer.rule-review.v1' ||
      !text(r.operationId, 112) ||
      !text(r.expectedActiveSnapshotId, 256) ||
      !['ASSESS', 'RETRACT'].includes(r.action) ||
      !r.expectedArtifact ||
      !exact(r.expectedArtifact, 'artifactId,digest,revision') ||
      !text(r.expectedArtifact.artifactId, 96) ||
      !Number.isSafeInteger(r.expectedArtifact.revision) ||
      r.expectedArtifact.revision < 1 ||
      !/^sha256:[a-f0-9]{64}$/.test(r.expectedArtifact.digest)
    )
      throw surferFailure('Invalid rule review command.');
    assertSurferSourceBasisV2(r.basis);
    r.selections = decodeSurferObservationSelections({
      schemaVersion: '1.0.0',
      selections: r.selections,
    }).selections;
    if (r.selections.length !== 1)
      throw surferFailure('One grounded observation is required per review.');
    return this.sessions.withSession(actor, async (s) => {
      const prior = await s.findCommit(r.operationId + ':publish'),
        selected = prior?.subjectId ?? r.expectedActiveSnapshotId,
        read = await s.read(selected);
      if (read.status !== 'CURRENT' || (!prior && !read.result.isActive)) throw stale();
      const stored = read.result.artifacts.find(
        (a) =>
          a.artifactId === r.expectedArtifact.artifactId &&
          a.kind === 'RULE' &&
          a.domain === SURFER_RULE_MEMORY_DOMAIN,
      );
      if (!stored) throw stale();
      if (
        ['surfer.rule-replacement-memory.v1', 'surfer.rule-chain-memory.v1'].includes(
          (stored.payload as { contract: string }).contract,
        )
      )
        return reviewSurferChain(s, actor, r);
      const p = validateSurferRuleMemoryBinding(
        stored.payload as unknown as SurferAnyRuleMemoryPayload,
      );
      if (
        p.contract === 'surfer.scoped-rule-memory.v2' &&
        (p.previous.artifactId !== stored.artifactId || p.previous.revision + 1 !== stored.revision)
      )
        throw surferFailure('Stored rule revision lineage differs.');
      if (surferDigest(stored.basis) !== surferDigest(p.knowledgeBasis.coreBasis))
        throw surferFailure('Rule review premises differ.');
      await readSurferRuleReviewViews(s.source, actor, p);
      const training = await s.source.withCurrent(
        actor,
        p.proof.basis,
        p.proof.selections,
        (v) => v,
      );
      validateSurferScopedRuleProof(p.proof, training);
      const view = await s.source.withCurrent(actor, r.basis, r.selections, (v) => v);
      if (view.anchors.length !== 1) throw surferFailure('Review observation anchor differs.');
      let observation;
      try {
        observation = decodeSurferRuleObservation(JSON.parse(view.anchors[0]!.rawLiteral));
      } catch {
        throw surferFailure('Review Source must contain one canonical typed observation.');
      }
      const observationDigest = surferDigest(observation),
        existing = p.contract === 'surfer.scoped-rule-memory.v2' ? p.reviews : [],
        known = existing.find(
          (e) =>
            e.observation.eventId === observation.eventId ||
            e.observation.eventGroup === observation.eventGroup,
        );
      if (prior) {
        if (
          p.contract !== 'surfer.scoped-rule-memory.v2' ||
          surferDigest(p.previous) !== surferDigest(r.expectedArtifact) ||
          known !== existing.at(-1) ||
          !known ||
          known.observationDigest !== observationDigest ||
          known.action !== r.action ||
          surferDigest(known.basis) !== surferDigest(r.basis) ||
          surferDigest(known.selections) !== surferDigest(r.selections)
        )
          throw surferFailure('Rule review replay changed meaning.');
        await s.commit({
          schemaVersion: '2.0.0',
          basis: null,
          command: {
            action: 'PUBLISH_SNAPSHOT',
            operationId: r.operationId + ':publish',
            snapshotId: selected,
            expectedActiveSnapshotId: r.expectedActiveSnapshotId,
            entries: [...read.result.snapshot.entries],
            engineRevision: 'surfer.empirical-rule-review.v1',
            createdAt: stored.createdAt,
          },
        });
        const before = existing
          .slice(0, -1)
          .reduce(
            (state, e) =>
              diagnoseSurferRuleObservation(p.proof, e.observation, e.action, state).nextState,
            'ACTIVE' as typeof p.state,
          );
        return {
          status: 'REPLAYED',
          artifact: {
            artifactId: stored.artifactId,
            revision: stored.revision,
            digest: stored.digest,
          },
          snapshotId: selected,
          state: p.state,
          diagnosis: diagnoseSurferRuleObservation(p.proof, observation, r.action, before),
          modelCalls: 0,
        } as const;
      }
      if (
        surferDigest({
          artifactId: stored.artifactId,
          revision: stored.revision,
          digest: stored.digest,
        }) !== surferDigest(r.expectedArtifact)
      )
        throw stale();
      const delivery = await s.findCommit(r.operationId + ':duplicate');
      if (delivery) {
        const receipt = await s.readArtifact({
            artifactId: delivery.subjectId,
            revision: delivery.revision,
            digest: delivery.digest,
          }),
          payload = receipt.payload as unknown as {
            contract: string;
            requestDigest: string;
            result: {
              status: 'DUPLICATE_EVENT';
              artifact: SurferArtifactRef;
              snapshotId: string;
              state: ReturnType<typeof surferRuleUseState>;
              modelCalls: 0;
            };
          };
        if (
          receipt.kind !== 'EPISODE' ||
          payload.contract !== 'surfer.rule-review-delivery.v1' ||
          payload.requestDigest !== surferDigest(r)
        )
          throw surferFailure('Duplicate delivery operation changed meaning.');
        return { ...payload.result, replayed: true };
      }
      const recordDuplicate = async (result: {
        status: 'DUPLICATE_EVENT';
        artifact: SurferArtifactRef;
        snapshotId: string;
        state: ReturnType<typeof surferRuleUseState>;
        modelCalls: 0;
      }) => {
        const sourceIds = [
            ...new Set([...p.knowledgeBasis.sources, ...r.basis.sources].map((x) => x.sourceId)),
          ].sort(),
          binding = await s.captureRule({
            schemaVersion: '2.0.0',
            sourceIds,
            artifacts: [],
            queries: [{ kind: 'EXPLICIT_SOURCE_SET', sourceIds }],
          }),
          draft = {
            schemaVersion: '1.0.0' as const,
            artifactId: 'review-delivery:' + surferDigest(r.operationId).slice(7),
            revision: 1,
            kind: 'EPISODE' as const,
            origin: 'EXPERIENCE' as const,
            scope: binding.knowledgeScope,
            domain: 'surfer.rule-review-delivery.v1',
            createdAt: view.readReceipt.observedAt,
            observedAt: r.basis.readWatermark.observedAt,
            producer: { ...stored.producer, engineRevision: 'surfer.empirical-rule-review.v1' },
            payloadSchema: 'surfer.opaque.v1' as const,
            payload: {
              contract: 'surfer.rule-review-delivery.v1',
              requestDigest: surferDigest(r),
              result,
            },
            basis: binding.basis.coreBasis,
          };
        await s.commit({
          schemaVersion: '2.0.0',
          basis: binding.basis,
          command: {
            action: 'APPEND_ARTIFACT',
            operationId: r.operationId + ':duplicate',
            expectedRevision: null,
            draft,
          },
        });
        return result;
      };
      if (known) {
        if (
          (known.observation.eventId === observation.eventId &&
            known.observationDigest !== observationDigest) ||
          eventMeaning(known.observation) !== eventMeaning(observation)
        )
          throw surferFailure('Declared event identity was reused with different evidence.');
        if (r.action !== 'ASSESS')
          throw surferFailure('A duplicate event cannot request a new transition.');
        return recordDuplicate({
          status: 'DUPLICATE_EVENT',
          artifact: r.expectedArtifact,
          snapshotId: selected,
          state: surferRuleUseState(p),
          modelCalls: 0,
        } as const);
      }
      const diagnosis = diagnoseSurferRuleObservation(
        p.proof,
        observation,
        r.action,
        surferRuleUseState(p),
      );
      if (diagnosis.classification === 'DUPLICATE_TRAINING_EVENT')
        return recordDuplicate({
          status: 'DUPLICATE_EVENT',
          artifact: r.expectedArtifact,
          snapshotId: selected,
          state: surferRuleUseState(p),
          modelCalls: 0,
        } as const);
      if (existing.length >= 8)
        throw surferFailure('Rule review history exceeds its bounded profile.');
      const reviews = [
          ...existing,
          {
            basis: r.basis,
            selections: r.selections,
            observation,
            observationDigest,
            action: r.action,
          },
        ],
        sourceIds = [
          ...new Set(
            [p.proof.basis, ...reviews.map((e) => e.basis)].flatMap((b) =>
              b.sources.map((x) => x.sourceId),
            ),
          ),
        ].sort(),
        captured = await s.captureRule({
          schemaVersion: '2.0.0',
          sourceIds,
          artifacts: [],
          queries: [{ kind: 'EXPLICIT_SOURCE_SET', sourceIds }],
        }),
        payload: SurferReviewedRuleMemoryPayload = {
          contract: 'surfer.scoped-rule-memory.v2',
          proof: p.proof,
          knowledgeBasis: captured.basis,
          previous: r.expectedArtifact,
          state: diagnosis.nextState,
          reviews,
        };
      validateSurferRuleMemoryBinding(payload);
      const createdAt =
          (await s.priorCreatedAt(r.operationId + ':append')) ?? view.readReceipt.observedAt,
        draft = {
          schemaVersion: '1.0.0' as const,
          artifactId: stored.artifactId,
          revision: stored.revision + 1,
          kind: 'RULE' as const,
          origin: 'INDUCTION' as const,
          scope: captured.knowledgeScope,
          domain: SURFER_RULE_MEMORY_DOMAIN,
          createdAt,
          observedAt: r.basis.readWatermark.observedAt,
          producer: { ...stored.producer, engineRevision: 'surfer.empirical-rule-review.v1' },
          payloadSchema: 'surfer.opaque.v1' as const,
          payload,
          basis: captured.basis.coreBasis,
        },
        appended = await s.commit({
          schemaVersion: '2.0.0',
          basis: captured.basis,
          command: {
            action: 'APPEND_ARTIFACT',
            operationId: r.operationId + ':append',
            expectedRevision: stored.revision,
            draft,
          },
        }),
        artifact = {
          artifactId: appended.commit.subjectId,
          revision: appended.commit.revision,
          digest: appended.commit.digest,
        },
        snapshotId = stored.artifactId + ':rule-snapshot:' + artifact.revision,
        entries = [
          ...read.result.snapshot.entries.filter((e) => e.artifactId !== stored.artifactId),
          artifact,
        ].sort((a, b) => (a.artifactId < b.artifactId ? -1 : a.artifactId > b.artifactId ? 1 : 0));
      await s.commit({
        schemaVersion: '2.0.0',
        basis: null,
        command: {
          action: 'PUBLISH_SNAPSHOT',
          operationId: r.operationId + ':publish',
          snapshotId,
          expectedActiveSnapshotId: r.expectedActiveSnapshotId,
          entries,
          engineRevision: 'surfer.empirical-rule-review.v1',
          createdAt,
        },
      });
      return {
        status: 'REVIEWED',
        artifact,
        snapshotId,
        state: payload.state,
        diagnosis,
        modelCalls: 0,
      } as const;
    });
  }
}
