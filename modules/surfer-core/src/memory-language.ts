import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import type {
  SurferDirectiveMemoryPayload,
  SurferDirectiveMemorySession,
  SurferDirectiveMemorySessionPort,
  SurferDirectiveScenarioEvaluationPort,
} from '../../../packages/contracts/src/surfer-directive-memory.js';
import { decodeSurferMemoryQuestion } from '../../../packages/contracts/src/surfer-directive-memory.js';
import {
  decodeSurferNaturalQuestion,
  decodeSurferInquiryValue,
  surferMemoryLanguageContextDigest,
  type SurferMemoryLanguageContext,
  type SurferMemoryLanguageCandidate,
  type SurferNaturalQuestionProposal,
  type SurferInquiryPayload,
  type SurferInquiryField,
} from '../../../packages/contracts/src/surfer-memory-language.js';
import {
  decodeSurferArtifactRef,
  type SurferArtifactRef,
} from '../../../packages/contracts/src/surfer-knowledge.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { groundSurferDirectiveV2 } from './directive-v2.js';
import { parseSurferLiteral } from './cognition.js';
import { SurferDirectiveMemoryService } from './directive-memory.js';

const stale = (): never => {
  throw new ShotgunError({
    code: 'STALE_VERSION',
    safeMessage: 'Question memory/Source context changed.',
    module: 'surfer.core',
    operation: 'memory-question',
  });
};
const ref = (commit: {
  subjectId: string;
  revision: number;
  digest: string;
}): SurferArtifactRef => ({
  artifactId: commit.subjectId,
  revision: commit.revision,
  digest: commit.digest,
});
/** Bounded catalog and persisted inquiry owner. A model call never occurs inside this service's transaction. */
export class SurferMemoryLanguageService {
  constructor(
    private readonly sessions: SurferDirectiveMemorySessionPort,
    private readonly scenarios: SurferDirectiveScenarioEvaluationPort,
  ) {}
  private consumer(s: SurferDirectiveMemorySession) {
    return new SurferDirectiveMemoryService(
      { withSession: (_a, apply) => apply(s) },
      this.scenarios,
    );
  }
  private async catalog(
    s: SurferDirectiveMemorySession,
    actor: unknown,
    input: unknown,
  ): Promise<SurferMemoryLanguageContext> {
    const request = decodeSurferNaturalQuestion(input),
      read = await s.read(request.snapshotId);
    if (read.status !== 'CURRENT') return stale();
    const candidates: SurferMemoryLanguageCandidate[] = [],
      selections = new Map<string, SurferDirectiveMemoryPayload['selections'][number]>();
    if (read.result.artifacts.length > 16)
      throw surferFailure('Language memory catalog exceeds its bounded profile.');
    for (const stored of [...read.result.artifacts].sort((a, b) =>
      a.artifactId < b.artifactId ? -1 : a.artifactId > b.artifactId ? 1 : 0,
    )) {
      if (stored.kind !== 'INTERPRETATION' || stored.domain !== 'surfer.directive-memory.v1')
        continue;
      const payload = stored.payload as unknown as SurferDirectiveMemoryPayload;
      if (
        payload.contract !== 'surfer.directive-memory.v1' ||
        surferDigest(payload.basis.coreBasis) !== surferDigest(stored.basis)
      )
        throw surferFailure('Memory catalog premises are corrupt.');
      const c = await s.source.withCurrent(actor, payload.basis, payload.selections, (v) => {
        const packet = groundSurferDirectiveV2(payload.packet, v),
          p = packet.clauses.proposal.interpretation;
        if (p.state !== 'RESOLVED' || !packet.meaning)
          throw surferFailure('Unresolved memory cannot supply a language catalog.');
        const target = p.structure.predicates.find(
            (pred) => pred.id === p.structure.assertion.target,
          )!,
          m = p.structure.entities.find((e) => e.id === target.subject)!.mention,
          a = v.anchors.find((a) => a.anchorId === m.anchorRef.anchorId)!;
        return {
          candidateId: 'C' + candidates.length,
          memory: {
            artifactId: stored.artifactId,
            revision: stored.revision,
            digest: stored.digest,
          },
          subject: Array.from(a.rawLiteral).slice(m.start, m.end).join(''),
          operation: packet.meaning.action.operationQuote,
          packet,
        };
      });
      candidates.push(c);
      payload.selections.forEach((v) => selections.set(surferDigest(v), v));
    }
    if (!candidates.length)
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'No current interpretation memories.',
        module: 'surfer.core',
        operation: 'memory-question',
      });
    const chosen = [...selections.values()].sort((a, b) =>
        surferDigest(a).localeCompare(surferDigest(b)),
      ),
      view = await s.source.observe(actor, { schemaVersion: '1.0.0', selections: chosen });
    const content = {
      schemaVersion: '1.0.0' as const,
      request,
      snapshot: {
        snapshotId: read.result.snapshot.snapshotId,
        digest: read.result.snapshot.digest,
      },
      basis: view.basis,
      selections: chosen,
      candidates,
    };
    return { ...content, digest: surferMemoryLanguageContextDigest(content) };
  }
  capture(actor: unknown, input: unknown) {
    return this.sessions.withSession(actor, (s) => this.catalog(s, actor, input));
  }
  private field(
    candidate: SurferMemoryLanguageCandidate,
    result: Awaited<ReturnType<SurferDirectiveMemoryService['ask']>>,
  ): SurferInquiryField | null {
    if (result.answers.length !== 1 || result.answers[0]!.outcome !== 'UNKNOWN') return null;
    const answer = result.answers[0]!;
    if (answer.reasons.includes('DATE_REQUIRED'))
      return {
        predicateId: '$date',
        type: 'DATE',
        unit: null,
        quote: '적용 날짜',
        prompt: '적용할 날짜를 YYYY-MM-DD로 알려주세요.',
        valueSemantics: 'UNDERLYING_STATE_NOT_PREDICATE_RESULT',
      };
    const n = [...answer.needed].sort(
      (a, b) =>
        (a.predicateId === 'exception1' ? -1 : 0) - (b.predicateId === 'exception1' ? -1 : 0),
    )[0];
    if (!n) return null;
    const p = candidate.packet.clauses.proposal.interpretation;
    if (p.state !== 'RESOLVED') return null;
    const pred = p.structure.predicates.find((p) => p.id === n.predicateId)!;
    if (!['NUMBER', 'BOOLEAN'].includes(pred.operand.type)) return null;
    return {
      predicateId: n.predicateId,
      type: pred.operand.type as 'NUMBER' | 'BOOLEAN',
      unit: pred.operand.type === 'NUMBER' ? pred.operand.unit : null,
      quote: n.quote,
      prompt:
        pred.operand.type === 'NUMBER'
          ? `현재 측정값과 단위를 알려주세요: ${n.quote}`
          : `다음 조건이 가리키는 상태 자체의 현재 참/거짓 값을 알려주세요: ${n.quote}`,
      valueSemantics: 'UNDERLYING_STATE_NOT_PREDICATE_RESULT',
    };
  }
  private async append(
    s: SurferDirectiveMemorySession,
    payload: SurferInquiryPayload,
    expected: SurferArtifactRef | null,
    operationId: string,
  ) {
    const captured = await s.capture({
        schemaVersion: '2.0.0',
        sourceIds: [],
        artifacts: payload.catalogMemories,
        queries: [],
      }),
      createdAt = (await s.priorCreatedAt(operationId)) ?? captured.readReceipt.observedAt;
    const receipt = await s.commit({
      schemaVersion: '2.0.0',
      basis: captured.basis,
      command: {
        action: 'APPEND_ARTIFACT',
        operationId,
        expectedRevision: expected?.revision ?? null,
        draft: {
          schemaVersion: '1.0.0',
          artifactId: 'inquiry:' + payload.requestId,
          revision: (expected?.revision ?? 0) + 1,
          kind: 'EPISODE',
          origin: 'EXPERIENCE',
          scope: {
            ...captured.knowledgeScope,
            sensitivity:
              captured.knowledgeScope.sensitivity === 'restricted' ? 'restricted' : 'private',
          },
          domain: 'surfer.memory-inquiry.v1',
          createdAt,
          observedAt: createdAt,
          producer: {
            engineRevision: 'surfer.memory-language.v1',
            modelRevision: payload.proposal.producer.modelRevision,
            policyRevision: captured.basis.authority.policyRevision,
            executionId: payload.proposal.producer.executionRef,
          },
          payloadSchema: 'surfer.opaque.v1',
          payload,
          basis: captured.basis.coreBasis,
        },
      },
    });
    return {
      inquiry: ref(receipt.commit),
      nextQuestion: payload.requested,
      result: payload.result,
      replayed: receipt.replayed,
      modelCalls: 0,
    };
  }
  async finish(
    actor: unknown,
    context: SurferMemoryLanguageContext,
    proposal: SurferNaturalQuestionProposal,
  ) {
    assertSurferJson(context);
    assertSurferJson(proposal);
    if (
      context.digest !== surferMemoryLanguageContextDigest(context) ||
      proposal.contextDigest !== context.digest ||
      proposal.questionDigest !== surferDigest(context.request.question)
    )
      throw surferFailure('Natural question proposal changed its context.');
    return this.sessions.withSession(actor, async (s) => {
      const current = await this.catalog(s, actor, {
        ...context.request,
        snapshotId: context.snapshot.snapshotId,
      });
      if (
        surferMemoryLanguageContextDigest({ ...current, request: context.request }) !==
        context.digest
      )
        stale();
      if (proposal.interpretation.state !== 'RESOLVED')
        return {
          inquiry: null,
          nextQuestion: null,
          result: {
            status: proposal.interpretation.state,
            reason: proposal.interpretation.reason,
            answers: [],
          },
          replayed: false,
          modelCalls: 0,
        };
      const interpretation = proposal.interpretation;
      const c = context.candidates.find((c) => c.candidateId === interpretation.candidateId);
      if (!c) throw surferFailure('Unknown memory candidate.');
      const previous = await s.findCommit('inquiry-open:' + context.request.requestId);
      if (previous) {
        const artifact = await s.readArtifact(ref(previous));
        const p = artifact.payload as unknown as SurferInquiryPayload;
        if (
          p.contract !== 'surfer.memory-inquiry.v1' ||
          surferDigest(p.proposal) !== surferDigest(proposal)
        )
          throw surferFailure('Request ID was reused with a different proposal.');
        return {
          inquiry: ref(previous),
          nextQuestion: p.requested,
          result: p.result,
          replayed: true,
          modelCalls: 0,
        };
      }
      const question = decodeSurferMemoryQuestion(interpretation.question);
      if (
        question.subject !== c.subject ||
        question.operation !== c.operation ||
        question.snapshotId !== context.snapshot.snapshotId
      )
        throw surferFailure('Selected question does not match its catalog.');
      const result = await this.consumer(s).ask(actor, question),
        payload: SurferInquiryPayload = {
          contract: 'surfer.memory-inquiry.v1',
          requestId: context.request.requestId,
          questionText: context.request.question,
          request: context.request,
          snapshot: context.snapshot,
          catalogDigest: context.digest,
          catalogMemories: context.candidates.map((c) => c.memory),
          proposal,
          question,
          memory: c.memory,
          requested: this.field(c, result),
          previous: null,
          turnId: 'INITIAL',
          answerDigest: null,
          result,
        };
      return this.append(s, payload, null, 'inquiry-open:' + payload.requestId);
    });
  }
  async resume(actor: unknown, input: unknown) {
    assertSurferJson(input);
    const r = structuredClone(input) as {
      schemaVersion: string;
      inquiry: SurferArtifactRef;
      turnId: string;
      value: unknown;
    };
    if (
      !r ||
      Object.keys(r).sort().join(',') !== 'inquiry,schemaVersion,turnId,value' ||
      r.schemaVersion !== '1.0.0' ||
      typeof r.turnId !== 'string' ||
      !r.turnId.length ||
      r.turnId.length > 96
    )
      throw surferFailure('Invalid inquiry continuation.');
    const inquiry = decodeSurferArtifactRef(r.inquiry),
      value = decodeSurferInquiryValue(r.value),
      operationId = 'inquiry-turn:' + r.turnId;
    return this.sessions.withSession(actor, async (s) => {
      const previous = await s.findCommit(operationId);
      if (previous) {
        const artifact = await s.readArtifact(ref(previous)),
          p = artifact.payload as unknown as SurferInquiryPayload;
        if (
          p.contract !== 'surfer.memory-inquiry.v1' ||
          surferDigest(p.previous) !== surferDigest(inquiry) ||
          p.answerDigest !== surferDigest(value)
        )
          throw surferFailure('Turn ID was reused with a different answer.');
        return {
          inquiry: ref(previous),
          nextQuestion: p.requested,
          result: p.result,
          replayed: true,
          modelCalls: 0,
        };
      }
      const artifact = await s.readArtifact(inquiry),
        p = artifact.payload as unknown as SurferInquiryPayload;
      if (
        artifact.kind !== 'EPISODE' ||
        artifact.domain !== 'surfer.memory-inquiry.v1' ||
        p.contract !== 'surfer.memory-inquiry.v1' ||
        !p.requested
      )
        throw surferFailure('Inquiry is not awaiting an answer.');
      const current = await this.catalog(s, actor, {
        ...p.request,
        snapshotId: p.snapshot.snapshotId,
      });
      if (surferMemoryLanguageContextDigest({ ...current, request: p.request }) !== p.catalogDigest)
        stale();
      if (value.type !== p.requested.type)
        throw surferFailure('Reply type does not match the requested premise.');
      const question = structuredClone(p.question);
      if (value.type === 'DATE') {
        if (parseSurferLiteral(value.value).kind !== 'DATE')
          throw surferFailure('Invalid continuation date.');
        question.atDate = value.value;
      } else
        question.observations = [
          ...question.observations.filter((o) => o.predicateId !== p.requested!.predicateId),
          { predicateId: p.requested.predicateId, value },
        ];
      const c = current.candidates.find((c) => surferDigest(c.memory) === surferDigest(p.memory));
      if (!c) return stale();
      const result = await this.consumer(s).ask(actor, question),
        payload: SurferInquiryPayload = {
          ...p,
          question,
          requested: this.field(c, result),
          previous: inquiry,
          turnId: r.turnId,
          answerDigest: surferDigest(value),
          result,
        };
      return this.append(s, payload, inquiry, operationId);
    });
  }
}
