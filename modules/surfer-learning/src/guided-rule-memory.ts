import type {
  SurferScopedRuleMemorySession,
  SurferScopedRuleMemorySessionPort,
} from '../../../packages/contracts/src/surfer-rule-memory.js';
import { readSurferRuleMemorySession } from '../../../packages/contracts/src/surfer-rule-memory.js';
import type {
  SurferGuidedRuleCatalog,
  SurferGuidedRuleQuestion,
  SurferGuidedRuleAnswer,
} from '../../../packages/contracts/src/surfer-guided-rule.js';
import { decodeSurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
  type SurferLearningCase,
  type SurferObservation,
  type SurferScalar,
} from '../../../packages/contracts/src/surfer-learning.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import { SurferScopedRuleMemoryService } from './rule-memory.js';
import { readSurferChainState } from './rule-chain-state.js';
import { validateSurferReplacementMemory } from './replacement-proof.js';
import type { SurferAnyRuleMemoryPayload } from './rule-memory-state.js';

const stale = (): never => {
  throw new ShotgunError({
    code: 'STALE_VERSION',
    safeMessage: 'Rule memory changed. Reload available rules.',
    module: 'surfer.learning',
    operation: 'guided-rule',
  });
};
const unavailable = (): SurferGuidedRuleCatalog => ({
  schemaVersion: '1.0.0',
  status: 'UNAVAILABLE',
  snapshot: null,
  items: [],
});
const bound = (s: SurferScopedRuleMemorySession) =>
  new SurferScopedRuleMemoryService({
    withSession: (_a, fn) => fn(s),
    withReadSession: (_a, fn) => fn(s),
  });

/** Presentation adapter over the existing validated rule consumer. No proposer, holdout or write capability. */
export class SurferGuidedRuleMemoryService {
  constructor(private readonly sessions: SurferScopedRuleMemorySessionPort) {}
  private async current(
    s: SurferScopedRuleMemorySession,
    actor: unknown,
  ): Promise<SurferGuidedRuleCatalog> {
    const read = await s.read(null);
    if (read.status !== 'CURRENT') return unavailable();
    if (read.result.artifacts.length > 16)
      throw surferFailure('Rule catalog exceeds its bounded profile.');
    const items: SurferGuidedRuleCatalog['items'] = [];
    for (const stored of read.result.artifacts) {
      if (stored.kind !== 'RULE' || stored.domain !== 'surfer.scoped-rule-memory.v1') continue;
      const result = await bound(s).ask(actor, {
        schemaVersion: '1.0.0',
        contract: 'surfer.scoped-rule-question.v1',
        snapshotId: read.result.snapshot.snapshotId,
        memoryId: stored.artifactId,
        kind: 'RECALL',
        features: {},
      });
      if (result.status === 'SOURCE_UNAVAILABLE' || result.status === 'BLOCKED')
        return unavailable();
      const a = result.answers[0];
      if (!a) continue;
      if (
        surferDigest(a.memory) !==
        surferDigest({
          artifactId: stored.artifactId,
          revision: stored.revision,
          digest: stored.digest,
        })
      )
        return stale();
      // Read only development/known observations, after the existing consumer has validated proof + Source.
      let cases: readonly SurferLearningCase[];
      const contract = (stored.payload as { contract?: string }).contract;
      if (contract === 'surfer.rule-chain-memory.v1')
        cases = (await readSurferChainState(s, actor, stored)).cases;
      else if (contract === 'surfer.rule-replacement-memory.v1')
        cases = validateSurferReplacementMemory(stored.payload).prepared.development.cases;
      else
        cases = (stored.payload as unknown as SurferAnyRuleMemoryPayload).proof.development.cases;
      const names = Object.keys(cases[0]!.features).sort();
      let supported = names.length > 0 && names.length <= 8;
      const fields: SurferGuidedRuleCatalog['items'][number]['fields'] = [];
      for (const name of names.slice(0, 8)) {
        const values = cases.map((c) => c.features[name]!);
        const first = values[0]!;
        if (
          !first ||
          first.value === null ||
          values.some(
            (v) =>
              !v ||
              v.value === null ||
              typeof v.value !== typeof first.value ||
              v.unit !== first.unit,
          )
        ) {
          supported = false;
          continue;
        }
        const distinct = [
          ...new Map(values.map((v) => [surferDigest(v.value), v.value as SurferScalar])).values(),
        ];
        if (distinct.length > 64) {
          supported = false;
          continue;
        }
        fields.push({
          name,
          type:
            typeof first.value === 'number'
              ? 'NUMBER'
              : typeof first.value === 'boolean'
                ? 'BOOLEAN'
                : 'TEXT',
          unit: first.unit ?? null,
          values: distinct,
        });
      }
      if (a.state !== 'ACTIVE' && a.state !== 'QUARANTINED' && a.state !== 'RETRACTED')
        throw surferFailure('Unsupported rule use state.');
      items.push({
        memory: a.memory,
        description: a.candidate.description,
        domain: a.candidate.domain,
        state: a.state,
        applySupported: supported && a.state === 'ACTIVE',
        fields,
      });
    }
    return {
      schemaVersion: '1.0.0',
      status: 'READY',
      snapshot: {
        snapshotId: read.result.snapshot.snapshotId,
        digest: read.result.snapshot.digest,
      },
      items,
    };
  }
  catalog(actor: unknown) {
    return readSurferRuleMemorySession(this.sessions, actor, (s) => this.current(s, actor));
  }
  async ask(actor: unknown, input: unknown): Promise<SurferGuidedRuleAnswer> {
    assertSurferJson(input);
    const r = input as SurferGuidedRuleQuestion;
    if (
      !r ||
      Object.keys(r).sort().join(',') !== 'kind,memory,schemaVersion,snapshot,values' ||
      r.schemaVersion !== '1.0.0' ||
      !r.snapshot ||
      Object.keys(r.snapshot).sort().join(',') !== 'digest,snapshotId' ||
      !['RECALL', 'APPLY'].includes(r.kind) ||
      !Array.isArray(r.values) ||
      r.values.length > 8 ||
      new Set(r.values.map((v) => v?.name)).size !== r.values.length ||
      (r.kind === 'RECALL' && r.values.length)
    )
      throw surferFailure('Invalid guided rule question.');
    for (const v of r.values)
      if (
        !v ||
        Object.keys(v).sort().join(',') !== 'name,valueIndex' ||
        typeof v.name !== 'string' ||
        !Number.isSafeInteger(v.valueIndex) ||
        v.valueIndex < 0
      )
        throw surferFailure('Invalid rule value selection.');
    const ref = decodeSurferArtifactRef(r.memory);
    return readSurferRuleMemorySession(this.sessions, actor, async (s) => {
      const c = await this.current(s, actor);
      if (c.status !== 'READY' || surferDigest(c.snapshot) !== surferDigest(r.snapshot))
        return stale();
      const item = c.items.find((i) => surferDigest(i.memory) === surferDigest(ref));
      if (!item) return stale();
      const features: Record<string, SurferObservation> = Object.fromEntries(
        r.values.map((v) => {
          const f = item.fields.find((f) => f.name === v.name);
          if (!f || v.valueIndex >= f.values.length)
            throw surferFailure('Rule value selection differs from the current catalog.');
          return [
            f.name,
            { value: f.values[v.valueIndex]!, ...(f.unit === null ? {} : { unit: f.unit }) },
          ];
        }),
      );
      if (r.kind === 'APPLY' && !item.applySupported && item.state === 'ACTIVE')
        throw surferFailure('Rule field catalog is unsupported.');
      const result = await bound(s).ask(actor, {
        schemaVersion: '1.0.0',
        contract: 'surfer.scoped-rule-question.v1',
        snapshotId: c.snapshot!.snapshotId,
        memoryId: item.memory.artifactId,
        kind: r.kind,
        features,
      });
      return {
        schemaVersion: '1.0.0',
        status: result.status,
        answers: result.answers.map((a) => ({
          description: a.candidate.description,
          state: a.state as SurferGuidedRuleCatalog['items'][number]['state'],
          outcome: a.outcome as SurferGuidedRuleAnswer['answers'][number]['outcome'],
          reasons: [...(a.reasons ?? [])],
          citations: a.citations,
        })),
        semanticAssessment: 'NOT_EVALUATED',
        execution: 'ADVISORY_NOT_ACTION',
        premisesOrigin: 'CALLER_SUPPLIED_SCENARIO',
        modelCalls: 0,
      };
    });
  }
}
