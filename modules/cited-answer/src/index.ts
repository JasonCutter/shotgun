import askCanonicalKnowledgeSchema from '../../../packages/contracts/schemas/ask-canonical-knowledge.v1.schema.json';
import canonicalSearchResponseSchema from '../../../packages/contracts/schemas/canonical-search-response.v1.schema.json';
import citedAnswerSchema from '../../../packages/contracts/schemas/cited-answer.v1.schema.json';
import evidenceSpanSchema from '../../../packages/contracts/schemas/evidence-span.v1.schema.json';
import getEvidenceSpanSchema from '../../../packages/contracts/schemas/get-evidence-span.v1.schema.json';
import searchCanonicalKnowledgeSchema from '../../../packages/contracts/schemas/search-canonical-knowledge.v1.schema.json';
import {
  type CanonicalSearchResponse,
  type CitedAnswer,
  type EvidenceSpan,
  type QueryEnvelope,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';

const assertContext = (envelope: QueryEnvelope) => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Cited answers require complete security context.',
      module: 'stage7.cited-answer',
      operation: envelope.messageType,
      correlationId: envelope.correlationId,
    });
  }
};

export const createCitedAnswerModule = (): ShotgunModule => ({
  manifest: {
    id: 'stage7.cited-answer',
    version: '1.0.0',
    owner: 'Shotgun Cited Answer',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'AskCanonicalKnowledge', range: '>=1.0.0 <2.0.0' },
        { name: 'SearchCanonicalKnowledge', range: '>=1.0.0 <2.0.0' },
        { name: 'GetEvidenceSpan', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: [],
      readsViaPorts: ['SearchCanonicalKnowledge query', 'GetEvidenceSpan query'],
      directSchemaAccess: false,
    },
    consumes: { commands: [], events: [] },
    produces: { events: [], handoffs: [] },
    provides: {
      queries: [{ name: 'AskCanonicalKnowledge', range: '>=1.0.0 <2.0.0' }],
      capabilities: [{ name: 'cited-answer-provider', priority: 100 }],
    },
    requires: { capabilities: ['canonical-search-provider', 'evidence-resolver'] },
    security: {
      requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
      defaultOnMissingContext: 'deny',
    },
    approvalPolicy: { canWriteCanonical: false, canExecuteExternalAction: false },
  },
  contracts: [
    {
      name: 'AskCanonicalKnowledge',
      version: '1.0.0',
      kind: 'query',
      inputSchema: askCanonicalKnowledgeSchema,
      outputSchema: citedAnswerSchema,
    },
    {
      name: 'SearchCanonicalKnowledge',
      version: '1.0.0',
      kind: 'query',
      inputSchema: searchCanonicalKnowledgeSchema,
      outputSchema: canonicalSearchResponseSchema,
    },
    {
      name: 'GetEvidenceSpan',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getEvidenceSpanSchema,
      outputSchema: evidenceSpanSchema,
    },
  ],
  handlers: {
    commands: [],
    events: [],
    queries: [
      {
        messageType: 'AskCanonicalKnowledge',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context): Promise<CitedAnswer> {
          assertContext(envelope);
          const payload = envelope.payload as { question: string; limit?: number };
          const question = payload.question.trim();
          const search = (
            await context.query<{ query: string; limit: number }, CanonicalSearchResponse>({
              messageType: 'SearchCanonicalKnowledge',
              schemaVersion: '1.0.0',
              payload: { query: question, limit: payload.limit ?? 5 },
            })
          ).payload;
          if (search.readiness.status !== 'READY') {
            return {
              status: 'STALE_PROJECTION',
              question,
              statements: [],
              readiness: search.readiness,
              uncertainty:
                '검색 Projection이 최신 Canonical Commit을 반영할 때까지 답변을 보류합니다.',
            };
          }
          const statements = await Promise.all(
            search.items.map(async (item) => {
              const evidence = await Promise.all(
                item.evidenceIds.map(
                  async (evidenceId) =>
                    (
                      await context.query<{ evidenceId: string }, EvidenceSpan>({
                        messageType: 'GetEvidenceSpan',
                        schemaVersion: '1.0.0',
                        payload: { evidenceId },
                      })
                    ).payload,
                ),
              );
              return {
                text: item.claimText,
                certainty: 'CANONICAL' as const,
                citations: evidence.map((span) => ({
                  citationId: `evidence:${span.evidenceId}`,
                  claimId: item.claimId,
                  revisionId: item.revisionId,
                  evidenceId: span.evidenceId,
                  sourceVersionId: span.sourceVersionId,
                  exactQuote: span.quote.exact,
                })),
              };
            }),
          );
          if (statements.length === 0) {
            return {
              status: 'NO_MATCH',
              question,
              statements: [],
              readiness: search.readiness,
              uncertainty: '승인된 Canonical Claim에서 근거 있는 답을 찾지 못했습니다.',
            };
          }
          return { status: 'ANSWERED', question, statements, readiness: search.readiness };
        },
      },
    ],
  },
});
