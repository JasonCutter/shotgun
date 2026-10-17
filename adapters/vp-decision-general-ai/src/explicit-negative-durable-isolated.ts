import type { AIProviderExecutionResolverPort } from '../../../modules/ai-provider/src/index.js';
import {
  assertVPDecisionEgress,
  VPDecisionOutcomeUnknownError,
  type VPDecisionExecutionRepositoryPort,
  type VPRelationDecisionRequest,
} from '../../../modules/vp-decision/src/index.js';
import {
  classifyExplicitNegativeDeclaration,
  EXPLICIT_NEGATIVE_ISOLATED_REVISION,
  EXPLICIT_NEGATIVE_RESPONSE_SCHEMA,
  parseExplicitNegativeDeclaration,
  EXPLICIT_NEGATIVE_DURABLE_CONTRACT,
  EXPLICIT_NEGATIVE_PRODUCT_FAKE_CONTRACT,
  isProductExplicitNegativeRevision,
  type DurableExplicitNegativeOutput,
} from '../../../modules/vp-decision/src/explicit-negative-isolated.js';
import type { VPRelationDecisionPort } from '../../../modules/vp-knowledge-ledger/src/index.js';
import { sha256Text, stableJson } from '../../../packages/contracts/src/index.js';
import {
  EXPLICIT_NEGATIVE_SYSTEM_INSTRUCTION,
  IsolatedExplicitNegativeAdapter,
} from './explicit-negative-isolated.js';

/** Byte/shape consistency only; does not establish that a model's semantic judgement is true. */
export const validDurableExplicitNegativeOutput = (
  output: DurableExplicitNegativeOutput,
): boolean =>
  validExplicitNegativeOutput(
    output,
    EXPLICIT_NEGATIVE_ISOLATED_REVISION,
    EXPLICIT_NEGATIVE_DURABLE_CONTRACT,
  );

/** Product Fake output has a separate contract and an exact, caller-pinned revision. */
export const validProductExplicitNegativeOutput = (
  output: DurableExplicitNegativeOutput,
  revision: string,
): boolean =>
  isProductExplicitNegativeRevision(revision) &&
  validExplicitNegativeOutput(output, revision, EXPLICIT_NEGATIVE_PRODUCT_FAKE_CONTRACT);

const validExplicitNegativeOutput = (
  output: DurableExplicitNegativeOutput,
  revision: string,
  contract: DurableExplicitNegativeOutput['contract'],
): boolean => {
  try {
    if (output.contract !== contract || 'execution' in output.input) return false;
    assertVPDecisionEgress(output.input);
    const { record, input } = output;
    if (
      input.policyRevision !== revision ||
      record.policyRevision !== input.policyRevision ||
      record.transportKind !== 'ISOLATED_FAKE' ||
      record.providerIdentity.provider !== 'isolated-fake' ||
      !record.providerObservation ||
      typeof record.rawResponse !== 'string'
    )
      return false;
    const schema = EXPLICIT_NEGATIVE_RESPONSE_SCHEMA;
    const prompt = JSON.stringify({
      left: {
        claim: input.left.text,
        evidenceContext: input.left.evidenceContext ?? null,
        evidenceContextTruncated: input.left.evidenceContextTruncated ?? false,
      },
      right: {
        claim: input.right.text,
        evidenceContext: input.right.evidenceContext ?? null,
        evidenceContextTruncated: input.right.evidenceContextTruncated ?? false,
      },
    });
    if (
      record.schemaDigest !== sha256Text(stableJson(schema)) ||
      record.requestDigest !==
        sha256Text(
          stableJson({
            captured: input,
            providerIdentity: record.providerIdentity,
            systemInstruction: EXPLICIT_NEGATIVE_SYSTEM_INSTRUCTION,
            schema,
            prompt,
            maxOutputTokens: 256,
          }),
        )
    )
      return false;
    let declaration;
    try {
      declaration = parseExplicitNegativeDeclaration(JSON.parse(record.rawResponse));
    } catch {
      return (
        stableJson(record.disposition) ===
        stableJson({ status: 'INVALID', reason: 'OUTPUT_SCHEMA_INVALID' })
      );
    }
    const usage = {
      inputTokens: record.providerObservation.inputTokens ?? NaN,
      outputTokens: record.providerObservation.outputTokens ?? NaN,
    };
    const disposition = [usage.inputTokens, usage.outputTokens].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    )
      ? classifyExplicitNegativeDeclaration(declaration, usage)
      : { status: 'INVALID', reason: 'PROVIDER_USAGE_INVALID' };
    return stableJson(record.disposition) === stableJson(disposition);
  } catch {
    return false;
  }
};

/** Explicit opt-in Fake composition. The normal app never imports or selects this router. */
export class DurableIsolatedExplicitNegativeRouter implements VPRelationDecisionPort {
  constructor(
    private readonly resolver: AIProviderExecutionResolverPort,
    private readonly executions: VPDecisionExecutionRepositoryPort<DurableExplicitNegativeOutput>,
    private readonly profile?: { readonly mode: 'PRODUCT_FAKE'; readonly revision: string },
  ) {
    if (
      profile &&
      (profile.mode !== 'PRODUCT_FAKE' || !isProductExplicitNegativeRevision(profile.revision))
    )
      throw new Error('Invalid explicit-negative product Fake profile.');
  }

  async resolve(input: VPRelationDecisionRequest): ReturnType<VPRelationDecisionPort['resolve']> {
    assertVPDecisionEgress(input);
    const revision = this.profile?.revision ?? EXPLICIT_NEGATIVE_ISOLATED_REVISION;
    const contract = this.profile
      ? EXPLICIT_NEGATIVE_PRODUCT_FAKE_CONTRACT
      : EXPLICIT_NEGATIVE_DURABLE_CONTRACT;
    if (input.policyRevision !== revision || !input.execution)
      throw new Error('Durable isolated policy requires its exact revision and lease.');
    const captured = structuredClone(input);
    const { execution, ...semanticInput } = captured;
    if (!execution) throw new Error('Missing isolated lease.');
    const stored = await this.executions.readStoredByJob?.({
      projectId: input.projectId,
      ...execution,
    });
    if (stored) return this.project(stored, semanticInput);
    const scope = captured.left.accessScope.filter((entry) =>
      captured.right.accessScope.includes(entry),
    );
    if (!scope.length) throw new Error('Isolated pair has no shared scope.');
    const { adapter, executionIdentity } = await this.resolver.resolve({
      projectId: captured.projectId,
      requestId: `vp-relation:${captured.policyRevision}:${[captured.left.assertionId, captured.right.assertionId].sort().join(':')}`,
      sourceVersionId: captured.left.sourceVersionId,
      dataClassification: 'source-content',
      accessScope: scope,
      sensitivity: ['public', 'internal', 'private', 'restricted'].findLast(
        (level) => level === captured.left.sensitivity || level === captured.right.sensitivity,
      ) as VPRelationDecisionRequest['left']['sensitivity'],
    });
    // Fail before claim or activation; no live provider identity may enter this experiment.
    const comparison = new IsolatedExplicitNegativeAdapter(adapter, this.profile);
    const providerIdentity = `${adapter.identity.provider}/${adapter.identity.model}`;
    const executionKey = sha256Text(
      stableJson({
        contract,
        providerIdentity: adapter.identity,
        executionIdentity,
      }),
    );
    const requestDigest = sha256Text(
      stableJson({
        contract,
        semanticInput,
        executionIdentity,
        systemInstruction: EXPLICIT_NEGATIVE_SYSTEM_INSTRUCTION,
        schema: EXPLICIT_NEGATIVE_RESPONSE_SCHEMA,
      }),
    );
    const identity = {
      projectId: captured.projectId,
      jobId: execution.jobId,
      executionKey,
      requestDigest,
    };
    const claim = await this.executions.claim({
      ...identity,
      leaseToken: execution.leaseToken,
      providerIdentity,
    });
    if (claim.status === 'OUTPUT_STORED') return this.project(claim.decision, semanticInput);
    if (claim.status === 'OUTCOME_UNKNOWN') return { status: 'OUTCOME_UNKNOWN' };
    try {
      const record = await comparison.compareIsolated(semanticInput, 'ISOLATED_FAKE');
      if (record.disposition.status === 'OUTCOME_UNKNOWN')
        throw new VPDecisionOutcomeUnknownError();
      const output = {
        contract,
        input: semanticInput,
        record,
      } as const;
      if (!this.validOutput(output)) throw new Error('Isolated output integrity failed.');
      const saved = await this.executions.storeOutput({ ...identity, decision: output });
      return this.project(saved, semanticInput);
    } catch {
      try {
        await this.executions.markOutcomeUnknown({
          ...identity,
          code: 'ISOLATED_OUTPUT_NOT_DURABLY_STORED',
        });
      } catch {
        /* RUNNING remains a durable fence. */
      }
      return { status: 'OUTCOME_UNKNOWN' };
    }
  }

  private project(
    output: DurableExplicitNegativeOutput,
    input: DurableExplicitNegativeOutput['input'],
  ): Awaited<ReturnType<VPRelationDecisionPort['resolve']>> {
    if (!this.validOutput(output) || stableJson(output.input) !== stableJson(input))
      throw new Error('Stored isolated input or output identity mismatch.');
    const { disposition, providerObservation, providerIdentity } = output.record;
    if (disposition.status === 'OUTCOME_UNKNOWN') return { status: 'OUTCOME_UNKNOWN' };
    if (disposition.status !== 'DECIDED')
      return {
        status: 'RECORDED_NO_EDGE',
        outcome: disposition.status === 'UNRESOLVED' ? 'MODEL_ABSTAINED' : disposition.status,
      };
    const { choice, direction, confidence } = disposition.declaration;
    if (choice === 'NO_RELATION' || choice === 'UNRESOLVED')
      throw new Error('Non-positive declaration cannot create an edge.');
    return {
      status: 'DECIDED',
      provider: 'GENERAL_AI',
      decision: {
        choice,
        direction,
        confidence,
        model: `${providerIdentity.provider}/${providerObservation!.modelVersion ?? providerIdentity.model}`,
        inputTokens: providerObservation!.inputTokens!,
        outputTokens: providerObservation!.outputTokens!,
      },
    };
  }

  private validOutput(output: DurableExplicitNegativeOutput): boolean {
    return this.profile
      ? validProductExplicitNegativeOutput(output, this.profile.revision)
      : validDurableExplicitNegativeOutput(output);
  }
}
