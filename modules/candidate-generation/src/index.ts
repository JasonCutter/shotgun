import { randomUUID } from 'node:crypto';

import candidateGeneratedSchema from '../../../packages/contracts/schemas/candidate-generated.v1.schema.json';
import candidateMaterializationFailedSchema from '../../../packages/contracts/schemas/candidate-materialization-failed.v1.schema.json';
import candidateMaterializedSchema from '../../../packages/contracts/schemas/candidate-materialized.v1.schema.json';
import candidateValidationEventSchema from '../../../packages/contracts/schemas/candidate-validation-event.v1.schema.json';
import claimCandidateSchema from '../../../packages/contracts/schemas/claim-candidate.v1.schema.json';
import evidenceIndexedSchema from '../../../packages/contracts/schemas/evidence-indexed.v1.schema.json';
import generateStructuredOutputSchema from '../../../packages/contracts/schemas/generate-structured-output.v1.schema.json';
import generateStructuredSchema from '../../../packages/contracts/schemas/generate-structured.v1.schema.json';
import getClaimCandidateSchema from '../../../packages/contracts/schemas/get-claim-candidate.v1.schema.json';
import getEvidenceSpansByIdsOutputSchema from '../../../packages/contracts/schemas/get-evidence-spans-by-ids-output.v1.schema.json';
import getEvidenceSpansByIdsSchema from '../../../packages/contracts/schemas/get-evidence-spans-by-ids.v1.schema.json';
import listClaimCandidatesOutputSchema from '../../../packages/contracts/schemas/list-claim-candidates-output.v1.schema.json';
import listClaimCandidatesSchema from '../../../packages/contracts/schemas/list-claim-candidates.v1.schema.json';
import listClaimCandidatesByRevisionOutputSchema from '../../../packages/contracts/schemas/list-claim-candidates-by-revision-output.v1.schema.json';
import listClaimCandidatesByRevisionSchema from '../../../packages/contracts/schemas/list-claim-candidates-by-revision.v1.schema.json';
import {
  alignDirectClaimToEvidence,
  findCompleteSourceStatement,
  isClearlyIncompleteDirectClaimFragment,
  splitAtCompletePhysicalLines,
} from './direct-claim-shape.js';
import listEvidenceSpansOutputSchema from '../../../packages/contracts/schemas/list-evidence-spans-output.v1.schema.json';
import listEvidenceSpansSchema from '../../../packages/contracts/schemas/list-evidence-spans.v1.schema.json';
import listEvidenceSpansByRevisionOutputSchema from '../../../packages/contracts/schemas/list-evidence-spans-by-revision-output.v1.schema.json';
import listEvidenceSpansByRevisionSchema from '../../../packages/contracts/schemas/list-evidence-spans-by-revision.v1.schema.json';
import reextractCandidateMaterializationSchema from '../../../packages/contracts/schemas/reextract-candidate-materialization.v1.schema.json';
import reextractCandidateMaterializationV11Schema from '../../../packages/contracts/schemas/reextract-candidate-materialization.v1.1.schema.json';
import resumeCandidateMaterializationSchema from '../../../packages/contracts/schemas/resume-candidate-materialization.v1.schema.json';
import {
  type AIProviderCall,
  type AIProviderOutputReference,
  type CandidateMaterializationRef,
  type ClaimCandidate,
  type ClaimCandidateStatus,
  type EventEnvelope,
  type CommandEnvelope,
  type EvidenceSpan,
  type ErrorCode,
  type GeneratedClaim,
  type QueryEnvelope,
  sha256Text,
  stableJson,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';

export type CandidateBatch = {
  readonly batchId: string;
  readonly projectId: string;
  readonly sourceVersionId: string;
  readonly revisionId?: string;
  readonly idempotencyKey: string;
  readonly providerCall: AIProviderCall;
  readonly materialization?: CandidateMaterializationRef & { readonly requestId: string };
  readonly candidates: readonly ClaimCandidate[];
  readonly createdAt: string;
};

export type CandidateRepositoryPort = {
  saveBatch(batch: CandidateBatch): Promise<CandidateBatch>;
  failMaterialization(
    projectId: string,
    materialization: CandidateMaterializationRef,
    errorCode: ErrorCode,
    createdAt: string,
  ): Promise<void>;
  findBatchByIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
  ): Promise<CandidateBatch | undefined>;
  findById(projectId: string, candidateId: string): Promise<ClaimCandidate | undefined>;
  listBySourceVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<readonly ClaimCandidate[]>;
  listByRevision?(
    projectId: string,
    sourceVersionId: string,
    revisionId: string,
  ): Promise<readonly ClaimCandidate[]>;
  findMaterializationRevision?(
    projectId: string,
    requestId: string,
  ): Promise<
    | {
        readonly sourceVersionId: string;
        readonly revisionId: string;
      }
    | undefined
  >;
  /** Records the durable provider-call pin before materialization can fail. */
  recordProviderPin?(
    projectId: string,
    requestId: string,
    pin: { readonly sourceVersionId: string; readonly revisionId: string },
  ): Promise<void>;
  recordEvidencePins?(
    projectId: string,
    sourceVersionId: string,
    revisionId: string,
    evidenceIds: readonly string[],
  ): Promise<void>;
  validateRevisionScope?(
    projectId: string,
    sourceVersionId: string,
    revisionId: string,
    candidates: readonly ClaimCandidate[],
  ): Promise<void>;
  updateStatus(
    projectId: string,
    candidateId: string,
    status: Extract<ClaimCandidateStatus, 'READY' | 'REJECTED'>,
  ): Promise<void>;
};

type EvidenceIndexedPayload = {
  readonly sourceVersionId: string;
  readonly revisionId: string;
};

type EvidenceSummary = {
  readonly evidenceId: string;
  readonly nodeKind: string;
};

type GeneratedOutput = {
  readonly call: AIProviderCall;
  readonly candidates: readonly GeneratedClaim[];
  readonly output: AIProviderOutputReference;
};

const assertContext = (envelope: EventEnvelope | QueryEnvelope | CommandEnvelope) => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Candidate access requires complete security context.',
      module: 'stage4.candidate-generation',
      operation: envelope.messageType,
      correlationId: envelope.correlationId,
    });
  }
  return {
    projectId: envelope.projectId,
    security: envelope.security,
  };
};

const assertScope = (
  candidate: ClaimCandidate,
  actualScopes: readonly string[],
  correlationId: string,
) => {
  const actual = new Set(actualScopes);
  if (candidate.accessScope.some((scope) => !actual.has(scope))) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'The caller cannot access this Claim Candidate.',
      module: 'stage4.candidate-generation',
      operation: 'read-candidate',
      correlationId,
    });
  }
};

const batchKey = (projectId: string, sourceVersionId: string, revisionId: string) =>
  `${projectId}:${sourceVersionId}:${revisionId}:candidate-extraction:direct-claim-v2:direct-only-v1`;

const reextractBatchKey = (
  projectId: string,
  sourceVersionId: string,
  revisionId: string,
  requestId: string,
) =>
  `${projectId}:${sourceVersionId}:${revisionId}:candidate-reextract:${requestId}:direct-claim-v2:direct-only-v1`;

const materialQualifierPatterns = [
  /[-+]?\d[\d,]*(?:\.\d+)?\s*(?:%|％|퍼센트|(?:천만|백만|조|억|천|백|십|만)?(?:원|달러|유로|위안)|개|명|건|회|배|년|개월|주|일|시간|분|초|kg|mg|g|km|cm|mm|m|L|ml|℃|°C)?/giu,
  /(?:이상이면|이하이면|초과하면|미만이면|이내이면|이상|이하|초과|미만|이내|까지|부터|동안|이후|이전|현재|당시|전후|불가|없(?:다|는|으며|습니다)|않(?:다|는|으며|습니다)|아니(?:다|며|고)|\bnot\b|\bnever\b|\bonly\b|\bif\b|\bwhen\b|\bunless\b|\bbefore\b|\bafter\b|\bduring\b|\bwithin\b|\bat least\b|\bat most\b|\bmore than\b|\bless than\b|\bapproximately\b|\babout\b)/giu,
];

const materialQualifiers = (statement: string): readonly string[] =>
  materialQualifierPatterns.flatMap((pattern) =>
    [...statement.matchAll(pattern)].map((match) => match[0].trim()).filter(Boolean),
  );

const splitV4CandidateStatements = (claimText: string): readonly string[] =>
  claimText
    // Markdown headings label the following text; the label itself is not a
    // factual claim. Strip heading-only lines before splitting a model span.
    .replace(/^#{1,6}[ \t]+[^\r\n]*(?:\r?\n|$)/gmu, '')
    .split(
      /(?<=[.!?。！？])(?:\s+|(?=[\p{L}]))|(?=예를\s*들어|예컨대|for example\b|for instance\b|따라서|결론적으로|반면|다만|그러나|이때)|(?<=[%％원건개명회배년개월주일시간분초])[ \t]+(?=[가-힣]{2,}[\s)\]\uFFFD]{0,6}(?:은|는)|(?:현재가치|순현재가치|내부수익률|매출총이익|영업이익|유동비율)\s+(?:PV|NPV|IRR|FV)\b)/giu,
    )
    .map((statement) => statement.trim())
    .flatMap(splitAtCompletePhysicalLines)
    .filter(Boolean);

const preserveQualifiedV4Claim = (sourceText: string, modelClaimText: string): string => {
  if (!modelClaimText || !sourceText.includes(modelClaimText)) return modelClaimText;
  const sentence = findCompleteSourceStatement(sourceText, modelClaimText);
  if (!sentence) return modelClaimText;
  const statement =
    splitV4CandidateStatements(sentence).find((part) => part.includes(modelClaimText)) ?? sentence;
  const claimLower = modelClaimText.toLocaleLowerCase();
  const omittedQualifier = materialQualifiers(statement).some(
    (qualifier) => !claimLower.includes(qualifier.toLocaleLowerCase()),
  );
  return omittedQualifier ? statement : modelClaimText;
};

const publishGenerated = async (
  context: Parameters<NonNullable<ShotgunModule['handlers']['events'][number]['handle']>>[1],
  batch: CandidateBatch,
) => {
  await context.publish({
    messageType: 'CandidateGenerated',
    schemaVersion: '1.0.0',
    idempotencyKey: `candidate-generated:${batch.projectId}:${batch.batchId}`,
    payload: {
      batchId: batch.batchId,
      sourceVersionId: batch.sourceVersionId,
      candidateIds: batch.candidates.map((candidate) => candidate.candidateId),
      providerCallId: batch.providerCall.callId,
      candidateCount: batch.candidates.length,
    },
  });
};

export const createCandidateGenerationModule = (
  repository: CandidateRepositoryPort,
): ShotgunModule => {
  type HandlerContext = Parameters<
    NonNullable<ShotgunModule['handlers']['events'][number]['handle']>
  >[1];

  const materialize = async (
    envelope: EventEnvelope | CommandEnvelope,
    context: HandlerContext,
    payload: {
      readonly sourceVersionId: string;
      readonly revisionId?: string;
      readonly requestId?: string;
    },
    mode: 'event' | 'resume' | 'reextract',
  ) => {
    const { projectId, security } = assertContext(envelope);
    let revisionId = payload.revisionId;
    if (mode === 'resume') {
      const pinned = await repository.findMaterializationRevision?.(
        projectId,
        payload.requestId ?? '',
      );
      if (!pinned || pinned.sourceVersionId !== payload.sourceVersionId) {
        throw new ShotgunError({
          code: 'REVISION_CONFLICT',
          safeMessage: 'Resume requires the original durable Provider revision pin.',
          module: 'stage4.candidate-generation',
          operation: 'resolve-resume-revision',
          correlationId: envelope.correlationId,
          retryable: false,
        });
      }
      revisionId = pinned.revisionId;
    }
    if (!revisionId) {
      throw new ShotgunError({
        code: 'REVISION_CONFLICT',
        safeMessage: 'Candidate materialization requires an exact active Evidence revision.',
        module: 'stage4.candidate-generation',
        operation: 'resolve-materialization-revision',
        correlationId: envelope.correlationId,
        retryable: false,
      });
    }
    const requestId = payload.requestId ?? batchKey(projectId, payload.sourceVersionId, revisionId);
    const idempotencyKey =
      mode === 'reextract'
        ? reextractBatchKey(projectId, payload.sourceVersionId, revisionId, requestId)
        : batchKey(projectId, payload.sourceVersionId, revisionId);
    const generationRequestId = mode === 'reextract' ? idempotencyKey : requestId;
    if (mode === 'event' && requestId !== idempotencyKey) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The durable materialization request does not match this source version.',
        module: 'stage4.candidate-generation',
        operation: 'verify-materialization-request',
        correlationId: envelope.correlationId,
      });
    }
    const existing = await repository.findBatchByIdempotencyKey(projectId, idempotencyKey);
    if (existing && mode !== 'resume') {
      await publishGenerated(context, existing);
      return;
    }

    const summaries = (
      await context.query<
        { sourceVersionId: string; revisionId: string },
        {
          items: readonly (EvidenceSummary & {
            readonly sourceVersionId: string;
            readonly revisionId: string;
          })[];
        }
      >({
        messageType: 'ListEvidenceSpansByRevision',
        schemaVersion: '1.0.0',
        payload: { sourceVersionId: payload.sourceVersionId, revisionId },
      })
    ).payload.items.filter((item) => item.nodeKind === 'sentence');
    summaries.forEach((item) => {
      if (item.sourceVersionId !== payload.sourceVersionId || item.revisionId !== revisionId) {
        throw new ShotgunError({
          code: 'VALIDATION_ERROR',
          safeMessage: 'Evidence query returned a different SourceVersion or revision.',
          module: 'stage4.candidate-generation',
          operation: 'verify-evidence-revision',
          correlationId: envelope.correlationId,
          retryable: false,
        });
      }
    });
    const evidenceIds = summaries.map((summary) => summary.evidenceId);
    if (evidenceIds.length === 0) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Direct claim extraction requires sentence Evidence Spans.',
        module: 'stage4.candidate-generation',
        operation: 'load-evidence',
        correlationId: envelope.correlationId,
      });
    }
    const bulkEvidence = (
      await context.query<
        {
          readonly sourceVersionId: string;
          readonly revisionId: string;
          readonly evidenceIds: readonly string[];
        },
        {
          readonly sourceVersionId: string;
          readonly revisionId: string;
          readonly items: readonly EvidenceSpan[];
        }
      >({
        messageType: 'GetEvidenceSpansByIds',
        schemaVersion: '1.0.0',
        payload: {
          sourceVersionId: payload.sourceVersionId,
          revisionId,
          evidenceIds,
        },
      })
    ).payload;
    if (
      bulkEvidence.sourceVersionId !== payload.sourceVersionId ||
      bulkEvidence.revisionId !== revisionId ||
      bulkEvidence.items.length !== evidenceIds.length
    ) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Bulk Evidence query returned a different project or revision.',
        module: 'stage4.candidate-generation',
        operation: 'verify-bulk-evidence-revision',
        correlationId: envelope.correlationId,
        retryable: false,
      });
    }
    const seenEvidenceIds = new Set<string>();
    const evidence = bulkEvidence.items.map((item, index) => {
      const expectedEvidenceId = evidenceIds[index];
      if (
        !expectedEvidenceId ||
        item.evidenceId !== expectedEvidenceId ||
        seenEvidenceIds.has(item.evidenceId) ||
        item.projectId !== projectId ||
        item.sourceVersionId !== payload.sourceVersionId ||
        item.revisionId !== revisionId
      ) {
        throw new ShotgunError({
          code: 'VALIDATION_ERROR',
          safeMessage: 'Bulk Evidence query returned a different evidence or revision.',
          module: 'stage4.candidate-generation',
          operation: 'verify-bulk-evidence-revision',
          correlationId: envelope.correlationId,
          retryable: false,
        });
      }
      seenEvidenceIds.add(item.evidenceId);
      return item;
    });
    if (evidence.length === 0) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Direct claim extraction requires sentence Evidence Spans.',
        module: 'stage4.candidate-generation',
        operation: 'load-evidence',
        correlationId: envelope.correlationId,
      });
    }
    await repository.recordEvidencePins?.(
      projectId,
      payload.sourceVersionId,
      revisionId,
      evidence.map((item) => item.evidenceId),
    );

    const generated = (
      await context.query<
        {
          requestId: string;
          generationEpochId?: string;
          taskProfile: 'candidate-extraction';
          schemaName: 'ClaimCandidateBatch.v1';
          policyVersion: 'direct-only-v1';
          dataClassification: string;
          sourceVersionId: string;
          accessScope: readonly string[];
          sensitivity: typeof security.sensitivity;
          evidence: readonly {
            evidenceId: string;
            text: string;
            exactHash: string;
            revisionId: string;
          }[];
        },
        GeneratedOutput
      >({
        messageType: 'GenerateStructured',
        schemaVersion: '1.0.0',
        payload: {
          requestId: generationRequestId,
          ...(mode === 'reextract' ? { generationEpochId: idempotencyKey } : {}),
          taskProfile: 'candidate-extraction',
          schemaName: 'ClaimCandidateBatch.v1',
          policyVersion: 'direct-only-v1',
          dataClassification: security.dataClassification,
          sourceVersionId: payload.sourceVersionId,
          accessScope: [...security.accessScope],
          sensitivity: security.sensitivity,
          evidence: evidence.map((item) => ({
            evidenceId: item.evidenceId,
            text: item.quote.exact,
            exactHash: item.exactHash,
            revisionId: item.revisionId,
          })),
        },
      })
    ).payload;
    const materialization = {
      requestId: generationRequestId,
      outputId: generated.output.outputId,
      outputDigest: generated.output.contentDigest,
      inputSnapshotDigest: generated.output.inputSnapshotDigest,
      materializerVersion: 'stage12-1-v1' as const,
    };
    await repository.recordProviderPin?.(projectId, generationRequestId, {
      sourceVersionId: payload.sourceVersionId,
      revisionId,
    });
    let batch: CandidateBatch;
    try {
      const evidenceById = new Map(evidence.map((item) => [item.evidenceId, item]));
      const seen = new Set<string>();
      const candidates = generated.candidates.flatMap((item): ClaimCandidate[] => {
        const sourceEvidence = evidenceById.get(item.evidenceId);
        if (!sourceEvidence) {
          throw new ShotgunError({
            code: 'VALIDATION_ERROR',
            safeMessage: 'AI output referred to evidence outside the request.',
            module: 'stage4.candidate-generation',
            operation: 'create-candidate',
            correlationId: envelope.correlationId,
          });
        }
        const modelClaimText = item.claimText.trim();
        const usesV4CandidatePolicy =
          generated.call.promptVersion === 'direct-claim-v4' ||
          generated.call.promptVersion === 'direct-claim-v5' ||
          generated.call.promptVersion === 'direct-claim-v6' ||
          generated.call.promptVersion === 'direct-claim-v7' ||
          generated.call.promptVersion === 'direct-claim-v8' ||
          generated.call.promptVersion === 'direct-claim-v9' ||
          generated.call.promptVersion === 'direct-claim-v10';
        const sourceAlignedModelClaimText = usesV4CandidatePolicy
          ? (alignDirectClaimToEvidence(sourceEvidence.quote.exact, modelClaimText) ??
            modelClaimText)
          : modelClaimText;
        const candidateTexts =
          usesV4CandidatePolicy &&
          sourceAlignedModelClaimText.length > 0 &&
          sourceEvidence.quote.exact.includes(sourceAlignedModelClaimText)
            ? splitV4CandidateStatements(sourceAlignedModelClaimText)
            : [sourceAlignedModelClaimText];
        return candidateTexts.flatMap((candidateText): ClaimCandidate[] => {
          const claimText =
            generated.call.promptVersion === 'direct-claim-v3' &&
            modelClaimText.length > 0 &&
            sourceEvidence.quote.exact.includes(modelClaimText)
              ? sourceEvidence.quote.exact
              : generated.call.promptVersion === 'direct-claim-v4' ||
                  generated.call.promptVersion === 'direct-claim-v5' ||
                  generated.call.promptVersion === 'direct-claim-v6' ||
                  generated.call.promptVersion === 'direct-claim-v7' ||
                  generated.call.promptVersion === 'direct-claim-v8' ||
                  generated.call.promptVersion === 'direct-claim-v9' ||
                  generated.call.promptVersion === 'direct-claim-v10'
                ? preserveQualifiedV4Claim(sourceEvidence.quote.exact, candidateText)
                : candidateText;
          const fingerprint = sha256Text(stableJson({ claimText, evidenceId: item.evidenceId }));
          if (
            !claimText ||
            seen.has(fingerprint) ||
            ((generated.call.promptVersion === 'direct-claim-v7' ||
              generated.call.promptVersion === 'direct-claim-v8' ||
              generated.call.promptVersion === 'direct-claim-v9' ||
              generated.call.promptVersion === 'direct-claim-v10') &&
              isClearlyIncompleteDirectClaimFragment(claimText))
          ) {
            return [];
          }
          seen.add(fingerprint);
          return [
            {
              candidateId: randomUUID(),
              batchId: '',
              revisionNumber: 1,
              projectId,
              sourceVersionId: payload.sourceVersionId,
              claimText,
              evidenceIds: [item.evidenceId],
              evidenceMode: 'DIRECT_EVIDENCE',
              extractionProfile: 'direct-only',
              status: 'PENDING_VALIDATION',
              providerCall: generated.call,
              accessScope: [...security.accessScope],
              sensitivity: security.sensitivity,
              createdAt: envelope.createdAt,
            },
          ];
        });
      });
      const batchId = existing?.batchId ?? randomUUID();
      batch = await repository.saveBatch({
        batchId,
        projectId,
        sourceVersionId: payload.sourceVersionId,
        revisionId,
        idempotencyKey,
        providerCall: generated.call,
        materialization,
        candidates:
          existing?.candidates ?? candidates.map((candidate) => ({ ...candidate, batchId })),
        createdAt: existing?.createdAt ?? envelope.createdAt,
      });
    } catch (error) {
      const code = error instanceof ShotgunError ? error.code : 'TERMINAL_FAILURE';
      await repository.failMaterialization(projectId, materialization, code, envelope.createdAt);
      await context.publish({
        messageType: 'CandidateMaterializationFailed',
        schemaVersion: '1.0.0',
        idempotencyKey: `candidate-materialization-failed:${projectId}:${generated.output.outputId}`,
        payload: {
          requestId: generationRequestId,
          outputId: generated.output.outputId,
          errorCode: code,
        },
      });
      throw error;
    }

    // saveBatch is the authoritative materialization commit. Downstream
    // handoff failures must not retroactively turn that committed state into
    // CandidateMaterializationFailed.
    await context.publish({
      messageType: 'CandidateMaterialized',
      schemaVersion: '1.0.0',
      idempotencyKey: `candidate-materialized:${projectId}:${generated.output.outputId}`,
      payload: {
        requestId: generationRequestId,
        outputId: generated.output.outputId,
        batchId: batch.batchId,
      },
    });
    await publishGenerated(context, batch);
  };

  return {
    manifest: {
      id: 'stage4.candidate-generation',
      version: '1.0.0',
      owner: 'Shotgun Candidate Generation',
      compatibility: {
        runtime: '>=1.0.0 <2.0.0',
        contracts: [
          { name: 'EvidenceIndexed', range: '>=1.0.0 <2.0.0' },
          { name: 'ListEvidenceSpans', range: '>=1.0.0 <2.0.0' },
          { name: 'ListEvidenceSpansByRevision', range: '>=1.0.0 <2.0.0' },
          { name: 'GetEvidenceSpansByIds', range: '>=1.0.0 <2.0.0' },
          { name: 'GenerateStructured', range: '>=1.0.0 <2.0.0' },
          { name: 'CandidateGenerated', range: '>=1.0.0 <2.0.0' },
          { name: 'CandidateValidated', range: '>=1.0.0 <2.0.0' },
          { name: 'CandidateRejected', range: '>=1.0.0 <2.0.0' },
          { name: 'GetClaimCandidate', range: '>=1.0.0 <2.0.0' },
          { name: 'ListClaimCandidates', range: '>=1.0.0 <2.0.0' },
          { name: 'ListClaimCandidatesByRevision', range: '>=1.0.0 <2.0.0' },
        ],
      },
      deployment: { modes: ['in_process', 'worker'] },
      dataOwnership: {
        owns: ['candidate.batches', 'candidate.claim_candidates', 'candidate.materializations'],
        readsViaPorts: ['Evidence queries', 'GenerateStructured query'],
        directSchemaAccess: false,
      },
      consumes: {
        commands: [
          { name: 'ResumeCandidateMaterialization', range: '>=1.0.0 <2.0.0' },
          { name: 'ReextractCandidateMaterialization', range: '>=1.0.0 <2.0.0' },
        ],
        events: [
          { name: 'EvidenceIndexed', range: '>=1.0.0 <2.0.0' },
          { name: 'CandidateValidated', range: '>=1.0.0 <2.0.0' },
          { name: 'CandidateRejected', range: '>=1.0.0 <2.0.0' },
        ],
      },
      produces: {
        events: [
          { name: 'CandidateGenerated', range: '>=1.0.0 <2.0.0' },
          { name: 'CandidateMaterialized', range: '>=1.0.0 <2.0.0' },
          { name: 'CandidateMaterializationFailed', range: '>=1.0.0 <2.0.0' },
        ],
        handoffs: [
          {
            event: { name: 'CandidateGenerated', range: '>=1.0.0 <2.0.0' },
            target: { kind: 'consumer', moduleId: 'stage4.validation' },
            tags: ['DURABLE_JOB', 'REQUIRED_ACK'],
            authority: 'connector-runtime.candidate-validation-job',
          },
          {
            event: { name: 'CandidateMaterialized', range: '>=1.0.0 <2.0.0' },
            target: { kind: 'consumer', moduleId: 'stage4.ai-provider' },
            tags: ['DURABLE_JOB'],
            authority: 'stage4.ai-provider.provider-call-state',
          },
          {
            event: {
              name: 'CandidateMaterializationFailed',
              range: '>=1.0.0 <2.0.0',
            },
            target: { kind: 'consumer', moduleId: 'stage4.ai-provider' },
            tags: ['DURABLE_JOB'],
            authority: 'stage4.ai-provider.provider-call-state',
          },
        ],
      },
      provides: {
        queries: [
          { name: 'GetClaimCandidate', range: '>=1.0.0 <2.0.0' },
          { name: 'ListClaimCandidates', range: '>=1.0.0 <2.0.0' },
          { name: 'ListClaimCandidatesByRevision', range: '>=1.0.0 <2.0.0' },
        ],
        capabilities: [{ name: 'claim-candidate-provider', priority: 100 }],
      },
      requires: {
        capabilities: ['evidence-resolver', 'structured-ai-provider'],
      },
      security: {
        requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
        defaultOnMissingContext: 'deny',
      },
      approvalPolicy: {
        canWriteCanonical: false,
        canExecuteExternalAction: false,
      },
    },
    contracts: [
      {
        name: 'EvidenceIndexed',
        version: '1.0.0',
        kind: 'event',
        inputSchema: evidenceIndexedSchema,
      },
      {
        name: 'ListEvidenceSpans',
        version: '1.0.0',
        kind: 'query',
        inputSchema: listEvidenceSpansSchema,
        outputSchema: listEvidenceSpansOutputSchema,
      },
      {
        name: 'ListEvidenceSpansByRevision',
        version: '1.0.0',
        kind: 'query',
        inputSchema: listEvidenceSpansByRevisionSchema,
        outputSchema: listEvidenceSpansByRevisionOutputSchema,
      },
      {
        name: 'GetEvidenceSpansByIds',
        version: '1.0.0',
        kind: 'query',
        inputSchema: getEvidenceSpansByIdsSchema,
        outputSchema: getEvidenceSpansByIdsOutputSchema,
      },
      {
        name: 'GenerateStructured',
        version: '1.0.0',
        kind: 'query',
        inputSchema: generateStructuredSchema,
        outputSchema: generateStructuredOutputSchema,
      },
      {
        name: 'CandidateGenerated',
        version: '1.0.0',
        kind: 'event',
        inputSchema: candidateGeneratedSchema,
      },
      {
        name: 'CandidateMaterialized',
        version: '1.0.0',
        kind: 'event',
        inputSchema: candidateMaterializedSchema,
      },
      {
        name: 'CandidateMaterializationFailed',
        version: '1.0.0',
        kind: 'event',
        inputSchema: candidateMaterializationFailedSchema,
      },
      {
        name: 'ResumeCandidateMaterialization',
        version: '1.0.0',
        kind: 'command',
        inputSchema: resumeCandidateMaterializationSchema,
      },
      {
        name: 'ReextractCandidateMaterialization',
        version: '1.0.0',
        kind: 'command',
        inputSchema: reextractCandidateMaterializationSchema,
      },
      {
        name: 'ReextractCandidateMaterialization',
        version: '1.1.0',
        kind: 'command',
        inputSchema: reextractCandidateMaterializationV11Schema,
      },
      {
        name: 'CandidateValidated',
        version: '1.0.0',
        kind: 'event',
        inputSchema: candidateValidationEventSchema,
      },
      {
        name: 'CandidateRejected',
        version: '1.0.0',
        kind: 'event',
        inputSchema: candidateValidationEventSchema,
      },
      {
        name: 'GetClaimCandidate',
        version: '1.0.0',
        kind: 'query',
        inputSchema: getClaimCandidateSchema,
        outputSchema: claimCandidateSchema,
      },
      {
        name: 'ListClaimCandidates',
        version: '1.0.0',
        kind: 'query',
        inputSchema: listClaimCandidatesSchema,
        outputSchema: listClaimCandidatesOutputSchema,
      },
      {
        name: 'ListClaimCandidatesByRevision',
        version: '1.0.0',
        kind: 'query',
        inputSchema: listClaimCandidatesByRevisionSchema,
        outputSchema: listClaimCandidatesByRevisionOutputSchema,
      },
    ],
    handlers: {
      commands: [
        {
          messageType: 'ResumeCandidateMaterialization',
          version: '1.0.0',
          requiredAccessScopes: ['owner'],
          async handle(envelope, context) {
            const payload = envelope.payload as {
              readonly sourceVersionId: string;
              readonly requestId: string;
              readonly revisionId?: string;
            };
            await materialize(envelope, context, payload, 'resume');
          },
        },
        {
          messageType: 'ReextractCandidateMaterialization',
          version: '1.0.0',
          requiredAccessScopes: ['owner'],
          async handle(envelope, context) {
            const payload = envelope.payload as {
              readonly sourceVersionId: string;
              readonly requestId: string;
              readonly revisionId?: string;
            };
            await materialize(envelope, context, payload, 'reextract');
          },
        },
      ],
      events: [
        {
          messageType: 'EvidenceIndexed',
          version: '1.0.0',
          requiredAccessScopes: ['owner'],
          async handle(envelope, context) {
            await materialize(
              envelope,
              context,
              envelope.payload as EvidenceIndexedPayload,
              'event',
            );
          },
        },
        {
          messageType: 'CandidateValidated',
          version: '1.0.0',
          requiredAccessScopes: ['owner'],
          requiredForPublisherAcknowledgement: true,
          async handle(envelope) {
            const { projectId } = assertContext(envelope);
            const payload = envelope.payload as { readonly candidateId: string };
            await repository.updateStatus(projectId, payload.candidateId, 'READY');
          },
        },
        {
          messageType: 'CandidateRejected',
          version: '1.0.0',
          requiredAccessScopes: ['owner'],
          requiredForPublisherAcknowledgement: true,
          async handle(envelope) {
            const { projectId } = assertContext(envelope);
            const payload = envelope.payload as { readonly candidateId: string };
            await repository.updateStatus(projectId, payload.candidateId, 'REJECTED');
          },
        },
      ],
      queries: [
        {
          messageType: 'GetClaimCandidate',
          version: '1.0.0',
          requiredAccessScopes: ['owner'],
          async handle(envelope) {
            const { projectId, security } = assertContext(envelope);
            const payload = envelope.payload as { readonly candidateId: string };
            const candidate = await repository.findById(projectId, payload.candidateId);
            if (!candidate) {
              throw new ShotgunError({
                code: 'NOT_FOUND',
                safeMessage: 'The Claim Candidate was not found.',
                module: 'stage4.candidate-generation',
                operation: 'get-candidate',
                correlationId: envelope.correlationId,
              });
            }
            assertScope(candidate, security.accessScope, envelope.correlationId);
            return candidate;
          },
        },
        {
          messageType: 'ListClaimCandidatesByRevision',
          version: '1.0.0',
          requiredAccessScopes: ['owner'],
          async handle(envelope) {
            const { projectId, security } = assertContext(envelope);
            if (!repository.listByRevision) {
              throw new ShotgunError({
                code: 'CAPABILITY_DENIED',
                safeMessage: 'Exact Candidate revision reads are unavailable in this runtime.',
                module: 'stage4.candidate-generation',
                operation: 'list-candidates-by-revision',
                correlationId: envelope.correlationId,
              });
            }
            const payload = envelope.payload as {
              readonly sourceVersionId: string;
              readonly revisionId: string;
            };
            const items = await repository.listByRevision(
              projectId,
              payload.sourceVersionId,
              payload.revisionId,
            );
            await repository.validateRevisionScope?.(
              projectId,
              payload.sourceVersionId,
              payload.revisionId,
              items,
            );
            items.forEach((candidate) =>
              assertScope(candidate, security.accessScope, envelope.correlationId),
            );
            return {
              sourceVersionId: payload.sourceVersionId,
              revisionId: payload.revisionId,
              items,
            };
          },
        },
        {
          messageType: 'ListClaimCandidates',
          version: '1.0.0',
          requiredAccessScopes: ['owner'],
          async handle(envelope) {
            const { projectId, security } = assertContext(envelope);
            const payload = envelope.payload as { readonly sourceVersionId: string };
            const items = await repository.listBySourceVersion(projectId, payload.sourceVersionId);
            items.forEach((candidate) =>
              assertScope(candidate, security.accessScope, envelope.correlationId),
            );
            return { items };
          },
        },
      ],
    },
  };
};
