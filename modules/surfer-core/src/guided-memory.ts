import type {
  SurferDirectiveMemoryPayload,
  SurferDirectiveMemorySession,
  SurferDirectiveMemorySessionPort,
  SurferDirectiveScenarioEvaluationPort,
} from '../../../packages/contracts/src/surfer-directive-memory.js';
import {
  decodeSurferMemoryQuestion,
  readSurferMemorySession,
} from '../../../packages/contracts/src/surfer-directive-memory.js';
import type {
  SurferGuidedAnswer,
  SurferGuidedCatalog,
  SurferGuidedQuestion,
} from '../../../packages/contracts/src/surfer-guided-memory.js';
import { decodeSurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import { groundSurferDirectiveV2 } from './directive-v2.js';
import { SurferDirectiveMemoryService } from './directive-memory.js';

const stale = (): never => {
  throw new ShotgunError({
    code: 'STALE_VERSION',
    safeMessage: 'Memory changed. Reload available memories.',
    module: 'surfer.core',
    operation: 'guided-question',
  });
};
/** Current display catalog and submission are each bound to one authorized Source MVCC snapshot. */
export class SurferGuidedMemoryService {
  constructor(
    private readonly sessions: SurferDirectiveMemorySessionPort,
    private readonly scenarios: SurferDirectiveScenarioEvaluationPort,
  ) {}
  private async current(
    s: SurferDirectiveMemorySession,
    actor: unknown,
  ): Promise<SurferGuidedCatalog> {
    const read = await s.read(null);
    if (read.status !== 'CURRENT')
      return { schemaVersion: '1.0.0', status: 'UNAVAILABLE', snapshot: null, items: [] };
    if (read.result.artifacts.length > 16)
      throw surferFailure('Guided catalog exceeds its bounded profile.');
    const items: SurferGuidedCatalog['items'] = [];
    const fieldSemantics = new Map<string, string>();
    for (const stored of read.result.artifacts) {
      if (stored.kind !== 'INTERPRETATION' || stored.domain !== 'surfer.directive-memory.v1')
        continue;
      const payload = stored.payload as unknown as SurferDirectiveMemoryPayload;
      if (
        Object.keys(payload).sort().join(',') !== 'basis,contract,packet,selections' ||
        payload.contract !== 'surfer.directive-memory.v1' ||
        surferDigest(stored.basis) !== surferDigest(payload.basis.coreBasis)
      )
        throw surferFailure('Stored memory schema is corrupt.');
      items.push(
        await s.source.withCurrent(actor, payload.basis, payload.selections, (view) => {
          const packet = groundSurferDirectiveV2(payload.packet, view),
            v = packet.clauses.proposal.interpretation;
          if (v.state !== 'RESOLVED' || !packet.meaning)
            throw surferFailure('Unresolved memory catalog.');
          const a = v.structure.assertion,
            target = v.structure.predicates.find((p) => p.id === a.target)!,
            mention = v.structure.entities.find((e) => e.id === target.subject)!.mention;
          const anchor = view.anchors.find((x) => x.anchorId === mention.anchorRef.anchorId)!;
          const bindings = packet.clauses.bindings.filter((b) => b.role !== 'ACTION');
          const fields: SurferGuidedCatalog['items'][number]['fields'] = [];
          const meanings: unknown[] = [];
          let supported =
            !a.quantifier && !a.scope.condition && ['IF', 'UNCONDITIONAL'].includes(a.direction);
          for (const p of v.structure.predicates.filter((p) =>
            bindings.some((b) => b.predicateId === p.id),
          )) {
            if (p.operand.type !== 'NUMBER' && p.operand.type !== 'BOOLEAN') {
              supported = false;
              continue;
            }
            fields.push({
              predicateId: p.id,
              quote: bindings.find((b) => b.predicateId === p.id)!.quote,
              type: p.operand.type,
              unit: p.operand.type === 'NUMBER' ? p.operand.unit : null,
            });
            const subjectMention = v.structure.entities.find((e) => e.id === p.subject)!.mention;
            const subjectAnchor = view.anchors.find(
              (x) => x.anchorId === subjectMention.anchorRef.anchorId,
            )!;
            meanings.push({
              id: p.id,
              subject: Array.from(subjectAnchor.rawLiteral)
                .slice(subjectMention.start, subjectMention.end)
                .join(''),
              attribute: p.attribute,
              comparison: p.comparison,
              operand: p.operand,
              quote: bindings.find((b) => b.predicateId === p.id)!.quote,
            });
          }
          fieldSemantics.set(stored.artifactId, surferDigest(meanings));
          if (fields.length > 8) supported = false;
          return {
            memory: {
              artifactId: stored.artifactId,
              revision: stored.revision,
              digest: stored.digest,
            },
            subject: Array.from(anchor.rawLiteral).slice(mention.start, mention.end).join(''),
            operation: packet.meaning.action.operationQuote,
            applySupported: supported,
            dateRequired: a.scope.time !== null,
            fields: fields.slice(0, 8),
          };
        }),
      );
    }
    // The existing Ask evaluates every matching subject/action, including conflicting memories.
    // Shared predicate IDs must have the same displayed meaning before one form can supply values.
    for (const item of items) {
      const peers = items.filter(
        (p) => p.subject === item.subject && p.operation === item.operation,
      );
      const signatures = peers.map((p) =>
        surferDigest({
          fields: [...p.fields].sort((a, b) => a.predicateId.localeCompare(b.predicateId)),
          dateRequired: p.dateRequired,
          semantics: fieldSemantics.get(p.memory.artifactId),
        }),
      );
      if (peers.some((p) => !p.applySupported) || new Set(signatures).size !== 1)
        item.applySupported = false;
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
    return readSurferMemorySession(this.sessions, actor, (s) => this.current(s, actor));
  }
  async ask(actor: unknown, input: unknown): Promise<SurferGuidedAnswer> {
    assertSurferJson(input);
    const r = input as SurferGuidedQuestion;
    if (
      !r ||
      Object.keys(r).sort().join(',') !==
        'atDate,kind,memory,observations,schemaVersion,snapshot' ||
      r.schemaVersion !== '1.0.0' ||
      !r.snapshot ||
      Object.keys(r.snapshot).sort().join(',') !== 'digest,snapshotId'
    )
      throw surferFailure('Invalid guided question.');
    const memory = decodeSurferArtifactRef(r.memory);
    return readSurferMemorySession(this.sessions, actor, async (s) => {
      const current = await this.current(s, actor);
      if (current.status !== 'READY' || surferDigest(current.snapshot) !== surferDigest(r.snapshot))
        return stale();
      const item = current.items.find((i) => surferDigest(i.memory) === surferDigest(memory));
      if (!item) return stale();
      if (r.kind === 'APPLY' && !item.applySupported)
        throw surferFailure(
          'These memories cannot share scenario inputs. Recall their statements instead.',
        );
      const question = decodeSurferMemoryQuestion({
        schemaVersion: '1.0.0',
        snapshotId: current.snapshot!.snapshotId,
        kind: r.kind,
        subject: item.subject,
        operation: item.operation,
        observations: r.observations,
        atDate: r.atDate,
      });
      const bound: SurferDirectiveMemorySessionPort = {
        withSession: (_a, fn) => fn(s),
        withReadSession: (_a, fn) => fn(s),
      };
      const answer = await new SurferDirectiveMemoryService(bound, this.scenarios).ask(
        actor,
        question,
      );
      const status = answer.status;
      if (
        status !== 'ANSWER' &&
        status !== 'UNKNOWN' &&
        status !== 'PARTIAL' &&
        status !== 'CONFLICT' &&
        status !== 'SOURCE_UNAVAILABLE' &&
        status !== 'BLOCKED'
      )
        throw surferFailure('Unexpected memory result.');
      return {
        schemaVersion: '1.0.0',
        status,
        answers: answer.answers.map((a) => ({
          outcome: a.outcome,
          declaredMode: a.declaredMode,
          citations: a.citations,
          needed: a.needed,
        })),
        semanticAssessment: 'NOT_EVALUATED',
        execution: 'ADVISORY_NOT_ACTION',
        premisesOrigin: 'CALLER_SUPPLIED_SCENARIO',
        modelCalls: 0,
      };
    });
  }
}
