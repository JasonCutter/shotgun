import type { SurferArtifactRef } from './surfer-knowledge.js';
import { assertSurferJson, surferDigest, surferFailure } from './surfer-learning.js';
import { unicodeLength } from './document-evidence.js';
import { assertSurferAskScopeFrames, type SurferAskScopeFrames } from './surfer-ask-scope.js';
export type SurferAskDiscoveryPin = {
  revision: 'surfer.ask-meaning-discovery.v1' | 'surfer.ask-meaning-discovery.v2';
  scopeProfile?: 'surfer.ask-semantic-scopes.v1';
  evidence: {
    evidenceId: string;
    sourceId: string;
    sourceVersionId: string;
    revisionId: string;
    quoteDigest: string;
  }[];
};
export type SurferAskMeaningProposalReceipt = {
  revision: 'surfer.ask-meaning-proposal.v1' | 'surfer.ask-meaning-proposal.v2';
  semanticScopes?: SurferAskScopeFrames;
  contextDigest: string;
  questionDigest: string;
  responseDigest: string;
  producer: { provider: string; model: string; adapterVersion?: string };
  wire: unknown | null;
  assessment:
    'NO_CANDIDATE' | 'INVALID_OUTPUT' | 'EVIDENCE_REJECTED' | 'ANCHORED_CANDIDATES_UNVERIFIED';
  candidates: {
    rule: SurferArtifactRef;
    field: string;
    label: string;
    source: { evidenceId: string; sourceId: string; sourceVersionId: string; revisionId: string };
    sourceSpan: { start: number; end: number; quote: string };
    questionSpan: { start: number; end: number; quote: string };
    assessment: 'ANCHORED_UNVERIFIED';
    uncertainties: ['SEMANTIC_EQUIVALENCE_UNVERIFIED', 'SUBJECT_TIME_UNVERIFIED'];
  }[];
  rejected: { index: number; reason: string }[];
  semanticAssessment: 'NOT_EVALUATED';
  effect: 'NO_RULE_OR_KNOWLEDGE_CHANGE';
  digest: string;
};
export function assertSurferAskDiscoveryPin(
  value: unknown,
): asserts value is SurferAskDiscoveryPin {
  const p = value as SurferAskDiscoveryPin;
  if (
    !p ||
    Object.keys(p).sort().join(',') !==
      (p.revision === 'surfer.ask-meaning-discovery.v2'
        ? 'evidence,revision,scopeProfile'
        : 'evidence,revision') ||
    !['surfer.ask-meaning-discovery.v1', 'surfer.ask-meaning-discovery.v2'].includes(p.revision) ||
    (p.revision === 'surfer.ask-meaning-discovery.v2' &&
      p.scopeProfile !== 'surfer.ask-semantic-scopes.v1') ||
    !Array.isArray(p.evidence) ||
    !p.evidence.length ||
    p.evidence.length > 12 ||
    new Set(p.evidence.map((e) => e?.evidenceId)).size !== p.evidence.length
  )
    throw surferFailure('Invalid Ask meaning discovery pin.');
  for (const e of p.evidence)
    if (
      !e ||
      Object.keys(e).sort().join(',') !==
        'evidenceId,quoteDigest,revisionId,sourceId,sourceVersionId' ||
      Object.entries(e).some(
        ([k, v]) =>
          typeof v !== 'string' ||
          !v.length ||
          v.length > 256 ||
          (k === 'quoteDigest' && !/^sha256:[a-f0-9]{64}$/.test(v)),
      )
    )
      throw surferFailure('Invalid discovery Evidence pin.');
}
export function decodeSurferAskMeaningProposalReceipt(
  value: unknown,
): SurferAskMeaningProposalReceipt {
  assertSurferJson(value);
  const r = value as SurferAskMeaningProposalReceipt;
  if (
    !r ||
    Object.keys(r).sort().join(',') !==
      (r.revision === 'surfer.ask-meaning-proposal.v2'
        ? 'assessment,candidates,contextDigest,digest,effect,producer,questionDigest,rejected,responseDigest,revision,semanticAssessment,semanticScopes,wire'
        : 'assessment,candidates,contextDigest,digest,effect,producer,questionDigest,rejected,responseDigest,revision,semanticAssessment,wire') ||
    !['surfer.ask-meaning-proposal.v1', 'surfer.ask-meaning-proposal.v2'].includes(r.revision) ||
    r.semanticAssessment !== 'NOT_EVALUATED' ||
    r.effect !== 'NO_RULE_OR_KNOWLEDGE_CHANGE' ||
    ![
      'NO_CANDIDATE',
      'INVALID_OUTPUT',
      'EVIDENCE_REJECTED',
      'ANCHORED_CANDIDATES_UNVERIFIED',
    ].includes(r.assessment) ||
    !Array.isArray(r.candidates) ||
    r.candidates.length > 8 ||
    !Array.isArray(r.rejected) ||
    r.rejected.length > 8 ||
    !r.producer ||
    JSON.stringify(r).length > 48000
  )
    throw surferFailure('Invalid meaning proposal receipt.');
  const keys = (v: object, s: string) => Object.keys(v).sort().join(',') === s;
  const text = (v: unknown, n = 256) => typeof v === 'string' && v.length > 0 && v.length <= n;
  const digest = (v: unknown) => typeof v === 'string' && /^sha256:[a-f0-9]{64}$/.test(v);
  if (
    ![r.contextDigest, r.questionDigest, r.responseDigest, r.digest].every(digest) ||
    !keys(
      r.producer,
      r.producer.adapterVersion === undefined ? 'model,provider' : 'adapterVersion,model,provider',
    ) ||
    Object.values(r.producer).some((v) => !text(v)) ||
    JSON.stringify(r.wire).length >
      (r.revision === 'surfer.ask-meaning-proposal.v2' ? 12000 : 16384)
  )
    throw surferFailure('Invalid proposal origin or wire.');
  for (const c of r.candidates) {
    if (
      !c ||
      !keys(c, 'assessment,field,label,questionSpan,rule,source,sourceSpan,uncertainties') ||
      c.assessment !== 'ANCHORED_UNVERIFIED' ||
      JSON.stringify(c.uncertainties) !==
        '["SEMANTIC_EQUIVALENCE_UNVERIFIED","SUBJECT_TIME_UNVERIFIED"]' ||
      !text(c.field, 64) ||
      !text(c.label, 64) ||
      !c.rule ||
      !keys(c.rule, 'artifactId,digest,revision') ||
      !text(c.rule.artifactId) ||
      !digest(c.rule.digest) ||
      !Number.isSafeInteger(c.rule.revision) ||
      c.rule.revision < 1 ||
      !c.source ||
      !keys(c.source, 'evidenceId,revisionId,sourceId,sourceVersionId') ||
      Object.values(c.source).some((v) => !text(v))
    )
      throw surferFailure('Invalid anchored proposal.');
    for (const span of [c.sourceSpan, c.questionSpan])
      if (
        !span ||
        !keys(span, 'end,quote,start') ||
        !text(span.quote, 1024) ||
        !Number.isSafeInteger(span.start) ||
        !Number.isSafeInteger(span.end) ||
        span.start < 0 ||
        span.end - span.start !== unicodeLength(span.quote)
      )
        throw surferFailure('Invalid proposal span.');
    if (c.questionSpan.quote !== c.label) throw surferFailure('Proposal question label changed.');
  }
  for (const rejection of r.rejected)
    if (
      !rejection ||
      !keys(rejection, 'index,reason') ||
      !Number.isSafeInteger(rejection.index) ||
      rejection.index < 0 ||
      rejection.index > 7 ||
      !text(rejection.reason, 80)
    )
      throw surferFailure('Invalid rejected proposal.');
  if (
    r.assessment === 'ANCHORED_CANDIDATES_UNVERIFIED'
      ? !r.candidates.length
      : r.candidates.length > 0 ||
        (r.assessment === 'EVIDENCE_REJECTED' ? !r.rejected.length : r.rejected.length > 0)
  )
    throw surferFailure('Proposal assessment differs from candidates.');
  if (r.revision === 'surfer.ask-meaning-proposal.v2')
    assertSurferAskScopeFrames(r.semanticScopes, r.candidates);
  const { digest: expected, ...body } = r;
  if (surferDigest(body) !== expected)
    throw surferFailure('Meaning proposal receipt digest changed.');
  return structuredClone(r);
}
