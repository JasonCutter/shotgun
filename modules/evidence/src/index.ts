import documentTransformedSchema from '../../../packages/contracts/schemas/document-transformed.v1.schema.json';
import evidenceIndexedSchema from '../../../packages/contracts/schemas/evidence-indexed.v1.schema.json';
import evidenceSpanSchema from '../../../packages/contracts/schemas/evidence-span.v1.schema.json';
import getDocumentRevisionOutputSchema from '../../../packages/contracts/schemas/get-document-revision-output.v1.schema.json';
import getDocumentRevisionSchema from '../../../packages/contracts/schemas/get-document-revision.v1.schema.json';
import getEvidenceSpanSchema from '../../../packages/contracts/schemas/get-evidence-span.v1.schema.json';
import listEvidenceSpansOutputSchema from '../../../packages/contracts/schemas/list-evidence-spans-output.v1.schema.json';
import listEvidenceSpansSchema from '../../../packages/contracts/schemas/list-evidence-spans.v1.schema.json';
import {
  type EvidenceSpan,
  type EventEnvelope,
  type QueryEnvelope,
  sha256Text,
  stableJson,
  ShotgunError,
  type SourceMapEntry,
  type TextPositionSelector,
  type TextQuoteSelector,
  type TransformationRevision,
  unicodeLength,
  unicodeSlice,
} from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';

export type EvidenceLocatorPort = {
  locate(source: string, quote: TextQuoteSelector): TextPositionSelector | undefined;
};

export type EvidenceCandidate = Omit<EvidenceSpan, 'evidenceId'>;

export type EvidenceRepositoryPort = {
  index(candidates: readonly EvidenceCandidate[]): Promise<{
    readonly items: readonly EvidenceSpan[];
    readonly reusedCount: number;
  }>;
  listBySourceVersion(projectId: string, sourceVersionId: string): Promise<readonly EvidenceSpan[]>;
  findById(projectId: string, evidenceId: string): Promise<EvidenceSpan | undefined>;
};

const assertContext = (envelope: EventEnvelope | QueryEnvelope) => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Evidence access requires complete security context.',
      module: 'stage3.evidence',
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
  accessScope: readonly string[],
  actualScopes: readonly string[],
  correlationId: string,
) => {
  const actual = new Set(actualScopes);
  if (accessScope.some((scope) => !actual.has(scope))) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'The caller cannot access this Evidence Span.',
      module: 'stage3.evidence',
      operation: 'read-evidence',
      correlationId,
    });
  }
};

const decodePointerToken = (token: string): string =>
  token.replaceAll('~1', '/').replaceAll('~0', '~');

const resolvePointerText = (revision: TransformationRevision, pointer: string): string => {
  if (pointer === '') {
    return revision.sourceMap.entries[0]?.quote.exact ?? '';
  }
  let current: unknown = revision.documentIR;
  for (const token of pointer.slice(1).split('/').map(decodePointerToken)) {
    if (Array.isArray(current)) {
      current = current[Number(token)];
    } else if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[token];
    } else {
      current = undefined;
    }
  }
  if (
    !current ||
    typeof current !== 'object' ||
    typeof (current as { text?: unknown }).text !== 'string'
  ) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: `SourceMap pointer '${pointer}' does not resolve to a DocumentIR text node.`,
      module: 'stage3.evidence',
      operation: 'validate-source-map-pointer',
    });
  }
  return (current as { readonly text: string }).text;
};

const invalidRevision = (message: string): never => {
  throw new ShotgunError({
    code: 'VALIDATION_ERROR',
    safeMessage: message,
    module: 'stage3.evidence',
    operation: 'validate-document-revision',
  });
};

const validateEntry = (
  revision: TransformationRevision,
  original: string,
  entry: SourceMapEntry,
  locator: EvidenceLocatorPort,
): void => {
  if (
    entry.sourceVersionId !== revision.sourceVersionId ||
    entry.sourceContentHash !== revision.sourceContentHash
  ) {
    invalidRevision('SourceMap entry refers to a different SourceVersion or content hash.');
  }
  if (
    entry.position.start < 0 ||
    entry.position.end < entry.position.start ||
    entry.position.end > unicodeLength(original)
  ) {
    invalidRevision('SourceMap entry contains an invalid text offset.');
  }
  const exact = unicodeSlice(original, entry.position.start, entry.position.end);
  if (
    exact !== entry.quote.exact ||
    sha256Text(exact) !== entry.exactHash ||
    resolvePointerText(revision, entry.pointer) !== exact
  ) {
    invalidRevision('SourceMap entry does not round-trip to the exact original text.');
  }
  const located = locator.locate(original, entry.quote);
  if (located && (located.start !== entry.position.start || located.end !== entry.position.end)) {
    invalidRevision('Text Quote Selector resolved to a conflicting Text Position.');
  }
};

export const buildEvidenceCandidates = (
  revision: TransformationRevision,
  locator: EvidenceLocatorPort,
): readonly EvidenceCandidate[] => {
  if (
    sha256Text(stableJson(revision.documentIR)) !== revision.documentHash ||
    sha256Text(stableJson(revision.sourceMap)) !== revision.sourceMapHash
  ) {
    invalidRevision('DocumentIR or SourceMap hash verification failed.');
  }
  const root =
    revision.sourceMap.entries.find((entry) => entry.pointer === '') ??
    invalidRevision('Document root is missing from SourceMap.');
  if (
    root.nodeKind !== 'document' ||
    root.position.start !== 0 ||
    root.position.end !== unicodeLength(root.quote.exact) ||
    root.exactHash !== sha256Text(root.quote.exact) ||
    (['text/plain', 'text/markdown'].includes(revision.documentIR.mediaType) &&
      sha256Text(root.quote.exact) !== revision.sourceContentHash)
  ) {
    invalidRevision('Document root does not match the immutable SourceVersion content hash.');
  }

  for (const entry of revision.sourceMap.entries) {
    validateEntry(revision, root.quote.exact, entry, locator);
  }

  return revision.sourceMap.entries
    .filter((entry) => entry.origin === 'source')
    .map((entry) => ({
      revisionId: revision.revisionId,
      projectId: revision.projectId,
      sourceId: revision.sourceId,
      sourceVersionId: revision.sourceVersionId,
      pointer: entry.pointer,
      nodeKind: entry.nodeKind,
      origin: 'source',
      position: entry.position,
      quote: entry.quote,
      selectors: entry.selectors ?? [],
      exactHash: entry.exactHash,
      accessScope: revision.accessScope,
      sensitivity: revision.sensitivity,
      createdAt: revision.createdAt,
    }));
};

export const createEvidenceModule = (
  repository: EvidenceRepositoryPort,
  locator: EvidenceLocatorPort,
): ShotgunModule => ({
  manifest: {
    id: 'stage3.evidence',
    version: '1.0.0',
    owner: 'Shotgun Evidence',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'DocumentTransformed', range: '>=1.0.0 <2.0.0' },
        { name: 'GetDocumentRevision', range: '>=1.0.0 <2.0.0' },
        { name: 'EvidenceIndexed', range: '>=1.0.0 <2.0.0' },
        { name: 'ListEvidenceSpans', range: '>=1.0.0 <2.0.0' },
        { name: 'GetEvidenceSpan', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: ['evidence.spans'],
      readsViaPorts: ['EvidenceLocatorPort', 'GetDocumentRevision query'],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [],
      events: [{ name: 'DocumentTransformed', range: '>=1.0.0 <2.0.0' }],
    },
    produces: {
      events: [{ name: 'EvidenceIndexed', range: '>=1.0.0 <2.0.0' }],
      handoffs: [
        {
          event: { name: 'EvidenceIndexed', range: '>=1.0.0 <2.0.0' },
          target: { kind: 'consumer', moduleId: 'stage4.candidate-generation' },
          tags: ['DURABLE_JOB'],
          authority: 'stage4.source-evidence.continuation-job',
        },
      ],
    },
    provides: {
      queries: [
        { name: 'ListEvidenceSpans', range: '>=1.0.0 <2.0.0' },
        { name: 'GetEvidenceSpan', range: '>=1.0.0 <2.0.0' },
      ],
      capabilities: [
        { name: 'evidence-index', priority: 100 },
        { name: 'evidence-resolver', priority: 100 },
      ],
    },
    requires: { capabilities: ['document-revision-provider'] },
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
      name: 'DocumentTransformed',
      version: '1.0.0',
      kind: 'event',
      inputSchema: documentTransformedSchema,
    },
    {
      name: 'GetDocumentRevision',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getDocumentRevisionSchema,
      outputSchema: getDocumentRevisionOutputSchema,
    },
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
      name: 'GetEvidenceSpan',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getEvidenceSpanSchema,
      outputSchema: evidenceSpanSchema,
    },
  ],
  handlers: {
    commands: [],
    events: [
      {
        messageType: 'DocumentTransformed',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const payload = envelope.payload as {
            readonly revisionId: string;
            readonly sourceVersionId: string;
          };
          assertContext(envelope);
          const revision = (
            await context.query<{ sourceVersionId: string }, TransformationRevision>({
              messageType: 'GetDocumentRevision',
              schemaVersion: '1.0.0',
              payload: { sourceVersionId: payload.sourceVersionId },
            })
          ).payload;
          if (revision.revisionId !== payload.revisionId) {
            invalidRevision('DocumentTransformed refers to a different stored revision.');
          }
          const indexed = await repository.index(buildEvidenceCandidates(revision, locator));
          await context.publish({
            messageType: 'EvidenceIndexed',
            schemaVersion: '1.0.0',
            idempotencyKey: `evidence-indexed:${revision.projectId}:${revision.revisionId}`,
            payload: {
              revisionId: revision.revisionId,
              sourceVersionId: revision.sourceVersionId,
              evidenceCount: indexed.items.length,
              reusedCount: indexed.reusedCount,
            },
          });
        },
      },
    ],
    queries: [
      {
        messageType: 'ListEvidenceSpans',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId, security } = assertContext(envelope);
          const payload = envelope.payload as { readonly sourceVersionId: string };
          const items = await repository.listBySourceVersion(projectId, payload.sourceVersionId);
          if (items.length === 0) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'No Evidence Spans were found for this SourceVersion.',
              module: 'stage3.evidence',
              operation: 'list-evidence-spans',
              correlationId: envelope.correlationId,
            });
          }
          items.forEach((item) =>
            assertScope(item.accessScope, security.accessScope, envelope.correlationId),
          );
          return {
            items: items.map((item) => ({
              evidenceId: item.evidenceId,
              pointer: item.pointer,
              nodeKind: item.nodeKind,
              position: item.position,
              selectors: item.selectors ?? [],
              exactHash: item.exactHash,
            })),
          };
        },
      },
      {
        messageType: 'GetEvidenceSpan',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId, security } = assertContext(envelope);
          const payload = envelope.payload as { readonly evidenceId: string };
          const evidence = await repository.findById(projectId, payload.evidenceId);
          if (!evidence) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The Evidence Span was not found.',
              module: 'stage3.evidence',
              operation: 'get-evidence-span',
              correlationId: envelope.correlationId,
            });
          }
          assertScope(evidence.accessScope, security.accessScope, envelope.correlationId);
          return evidence;
        },
      },
    ],
  },
});
