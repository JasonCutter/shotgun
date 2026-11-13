import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { boundedSourceFixture } from './surfer-bounded-source-fixture.js';
import { SurferBoundedRuleProofReader } from '../../adapters/surfer-document-memory/src/bounded-rule-proof.js';
import { SurferScopedRuleMemoryService } from '../../modules/surfer-learning/src/rule-memory.js';
import { SurferScopedRuleReviewService } from '../../modules/surfer-learning/src/rule-review.js';
import { ShotgunSurferScopedRuleMemorySession } from '../../adapters/surfer-shotgun-bridge/src/rule-memory.js';
import type { SurferRuleObservation } from '../../packages/contracts/src/surfer-rule-review.js';
import { unicodeLength } from '../../packages/contracts/src/document-evidence.js';
export async function ruleReviewFixture(
  pool: Pool,
  principalId: string,
  root: string,
  seed?: string,
  corpusFactory?: Parameters<typeof boundedSourceFixture>[5],
  existingActual?: Parameters<typeof boundedSourceFixture>[6],
) {
  const f = await boundedSourceFixture(
    pool,
    principalId,
    root,
    seed,
    undefined,
    corpusFactory,
    existingActual,
  );
  let trial;
  try {
    trial = await f.trial().run(f.actual.request, f.task);
  } finally {
    f.proposer.close();
  }
  const reader = new SurferBoundedRuleProofReader(
      {
        task: f.task,
        development: f.development,
        descriptor: await f.corpus.evaluation.describe(f.context),
      },
      f.ledger,
      f.experiments,
    ),
    sessions = new ShotgunSurferScopedRuleMemorySession(f.sessions),
    memory = new SurferScopedRuleMemoryService(sessions, reader),
    remember = {
      schemaVersion: '1.0.0',
      contract: 'surfer.scoped-rule-memory.v1',
      operationId: 'remember:' + randomUUID(),
      memoryId: 'rule:' + randomUUID(),
      proofId: reader.proofId,
      expectedRevision: null,
      expectedActiveSnapshotId: null,
    },
    saved = await memory.remember(f.actual.request, remember);
  const observation = (patch: Partial<SurferRuleObservation> = {}): SurferRuleObservation => ({
    schemaVersion: '1.0.0',
    contract: 'surfer.rule-observation.v1',
    datasetId: f.development.datasetId,
    domain: f.development.cases[0]!.domain,
    eventId: 'event:' + randomUUID(),
    eventGroup: 'group:' + randomUUID(),
    features: structuredClone(f.development.cases[0]!.features),
    observedOutcome: false,
    ...patch,
  });
  const ground = async (o: SurferRuleObservation) => {
    const text = JSON.stringify(o),
      stored = await f.actual.source(text),
      material = await f.sessions.withSnapshotV2(
        f.actual.request,
        async (s) => (await s.readMaterialV2(stored.sourceId)).material,
      ),
      selection = {
        sourceId: stored.sourceId,
        evidenceId: material.rootEvidenceId,
        start: 0,
        end: unicodeLength(text),
        targetUnit: null,
      },
      view = await f.source.observe(f.actual.request, {
        schemaVersion: '1.0.0',
        selections: [selection],
      });
    return { observation: o, stored, view, selections: [selection] };
  };
  const command = (
    g: Awaited<ReturnType<typeof ground>>,
    current: { artifact: typeof saved.artifact; snapshotId: string } = saved,
  ) => ({
    schemaVersion: '1.0.0',
    contract: 'surfer.rule-review.v1',
    operationId: 'review:' + randomUUID(),
    expectedArtifact: current.artifact,
    expectedActiveSnapshotId: current.snapshotId,
    action: 'ASSESS',
    basis: g.view.basis,
    selections: g.selections,
  });
  const question = {
    schemaVersion: '1.0.0',
    contract: 'surfer.scoped-rule-question.v1',
    snapshotId: null,
    memoryId: remember.memoryId,
    kind: 'APPLY',
    features: structuredClone(f.development.cases[0]!.features),
  };
  return {
    ...f,
    trial,
    reader,
    sessions,
    memory,
    remember,
    saved,
    observation,
    ground,
    command,
    question,
    review: new SurferScopedRuleReviewService(sessions),
  };
}
