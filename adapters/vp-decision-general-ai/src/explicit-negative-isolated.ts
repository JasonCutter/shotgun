import type { AIProviderAdapterPort } from '../../../modules/ai-provider/src/index.js';
import {
  assertVPDecisionEgress,
  VPDecisionOutcomeUnknownError,
  type VPRelationDecisionRequest,
} from '../../../modules/vp-decision/src/index.js';
import {
  classifyExplicitNegativeDeclaration,
  EXPLICIT_NEGATIVE_ISOLATED_REVISION,
  EXPLICIT_NEGATIVE_RESPONSE_SCHEMA,
  parseExplicitNegativeDeclaration,
  type IsolatedRecord,
} from '../../../modules/vp-decision/src/explicit-negative-isolated.js';
import { sha256Text, stableJson } from '../../../packages/contracts/src/index.js';
import { VP_RELATION_COMPARISON_SYSTEM_INSTRUCTION } from './index.js';

export const EXPLICIT_NEGATIVE_SYSTEM_INSTRUCTION =
  VP_RELATION_COMPARISON_SYSTEM_INSTRUCTION +
  ' Additional isolated policy: NO_RELATION is an explicit negative judgement when the supplied text is sufficient to rule out the defined positive relations, including meaningful topic overlap. It is not uncertainty, a withheld output, or proof that no connection could exist outside the supplied input. Keep the existing RELATED definition: do not require a direct mechanism link where meaningful topic overlap is sufficient. Shared words alone need not establish meaningful overlap. Use UNRESOLVED when missing context or material ambiguity prevents the judgement; a null excerpt alone does not force UNRESOLVED. NO_RELATION requires direction NONE and its own probability entry.';

export type { IsolatedRecord } from '../../../modules/vp-decision/src/explicit-negative-isolated.js';
/** Not a production VPDecisionProviderPort: it cannot be wired into the normal worker. */
export class IsolatedExplicitNegativeAdapter {
  constructor(private readonly fake: AIProviderAdapterPort) {
    if (fake.identity.provider !== 'isolated-fake')
      throw new Error('Explicit-negative experiment requires an isolated Fake provider.');
  }

  async compareIsolated(
    input: VPRelationDecisionRequest,
    mode: 'ISOLATED_FAKE',
  ): Promise<IsolatedRecord> {
    if (mode !== 'ISOLATED_FAKE' || this.fake.identity.provider !== 'isolated-fake')
      throw new Error('Explicit-negative transport is not isolated Fake.');
    if (input.policyRevision !== EXPLICIT_NEGATIVE_ISOLATED_REVISION || input.execution)
      throw new Error('Explicit-negative revision mismatch or production execution supplied.');
    const captured = structuredClone(input);
    assertVPDecisionEgress(captured);
    const providerIdentity = structuredClone(this.fake.identity);
    const schema = structuredClone(EXPLICIT_NEGATIVE_RESPONSE_SCHEMA);
    const prompt = JSON.stringify({
      left: {
        claim: captured.left.text,
        evidenceContext: captured.left.evidenceContext ?? null,
        evidenceContextTruncated: captured.left.evidenceContextTruncated ?? false,
      },
      right: {
        claim: captured.right.text,
        evidenceContext: captured.right.evidenceContext ?? null,
        evidenceContextTruncated: captured.right.evidenceContextTruncated ?? false,
      },
    });
    const base = {
      transportKind: 'ISOLATED_FAKE' as const,
      policyRevision:
        EXPLICIT_NEGATIVE_ISOLATED_REVISION as typeof EXPLICIT_NEGATIVE_ISOLATED_REVISION,
      schemaDigest: sha256Text(stableJson(schema)),
      providerIdentity,
      providerObservation: null,
      requestDigest: sha256Text(
        stableJson({
          captured,
          providerIdentity,
          systemInstruction: EXPLICIT_NEGATIVE_SYSTEM_INSTRUCTION,
          schema,
          prompt,
          maxOutputTokens: 256,
        }),
      ),
    };
    let response;
    try {
      response = await this.fake.generateStructured({
        systemInstruction: EXPLICIT_NEGATIVE_SYSTEM_INSTRUCTION,
        prompt,
        responseSchema: schema,
        maxOutputTokens: 256,
      });
    } catch (error) {
      if (error instanceof VPDecisionOutcomeUnknownError)
        return { ...base, rawResponse: null, disposition: { status: 'OUTCOME_UNKNOWN' } };
      throw error;
    }
    const observed = {
      ...base,
      providerObservation: {
        responseId: response.providerResponseId ?? null,
        modelVersion: response.modelVersion ?? null,
        inputTokens: response.inputTokens ?? null,
        outputTokens: response.outputTokens ?? null,
      },
    };
    let declaration;
    try {
      declaration = parseExplicitNegativeDeclaration(JSON.parse(response.rawText));
    } catch {
      return {
        ...observed,
        rawResponse: response.rawText,
        disposition: { status: 'INVALID', reason: 'OUTPUT_SCHEMA_INVALID' },
      };
    }
    const usage = {
      inputTokens: response.inputTokens ?? Number.NaN,
      outputTokens: response.outputTokens ?? Number.NaN,
    };
    if (![usage.inputTokens, usage.outputTokens].every((n) => Number.isSafeInteger(n) && n >= 0))
      return {
        ...observed,
        rawResponse: response.rawText,
        disposition: { status: 'INVALID', reason: 'PROVIDER_USAGE_INVALID' },
      };
    return {
      ...observed,
      rawResponse: response.rawText,
      disposition: classifyExplicitNegativeDeclaration(declaration, usage),
    };
  }
}
