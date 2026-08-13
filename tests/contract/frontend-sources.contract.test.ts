import { describe, expect, it } from 'vitest';

import {
  FrontendContractError,
  decodeCitationReturnTarget,
  decodeEvidenceListView,
  decodeExactDuplicateDecisionView,
  decodeIntakeSubmissionSnapshot,
  decodeIntakeDraftSeed,
  decodeSourceDetailView,
  decodeSourceLibraryPageView,
  decodeSourceLibraryQuery,
  decodeSourcePreviewView,
  decodeSourceVersionHistoryView,
  SOURCES_FRONTEND_COMMAND_TYPES,
  validateSourcesFrontendCommandRequest,
  validateStagedSourcesFrontendCommandRequest,
} from '../../packages/contracts/src/index.js';

const now = '2026-07-30T12:00:00.000Z';
const hash = `sha256:${'a'.repeat(64)}`;

const revisions = {
  projectionRevision: 'projection-7',
  accessRevision: 'access-3',
  policyContextRevision: 'policy-5',
  fetchedAt: now,
};

const libraryItem = {
  sourceId: 'source-1',
  projectId: 'project-1',
  label: 'Architecture notes',
  mediaType: 'text/markdown',
  lifecycle: 'ACTIVE',
  previewReadiness: 'READY',
  askUsageState: 'EVIDENCE_READY',
  askUsageExplanation: 'The selected version has indexed evidence.',
  selectedSourceVersionId: 'version-1',
  versionCount: 1,
  capabilities: ['PREVIEW', 'DOWNLOAD_ORIGINAL', 'SELECT_FOR_ASK'],
  sensitivity: 'internal',
  updatedAt: now,
};

describe('Frontend Phase 2 Section 1 Sources contracts', () => {
  it('validates versioned project-bound Sources commands and typed payloads', () => {
    const request = validateSourcesFrontendCommandRequest(
      {
        envelopeVersion: '1.0.0',
        commandType: SOURCES_FRONTEND_COMMAND_TYPES.submit,
        commandSchemaVersion: '1.0.0',
        clientRequestId: 'request-1',
        idempotencyKey: 'idempotency-1',
        projectContext: {
          activeProjectId: 'project-1',
          targetProjectId: 'project-1',
        },
        policyBinding: {
          mode: 'CURRENT',
          observedPolicyContextRevision: '5',
        },
        preconditions: [],
        clientIssuedAt: now,
        payload: {
          draftId: 'draft-1',
          inputs: [
            {
              itemId: 'item-1',
              kind: 'DIRECT_TEXT',
              label: 'Pasted text',
              text: 'Original text',
            },
            {
              itemId: 'item-2',
              kind: 'FILE',
              label: 'Notes',
              fileName: 'notes.md',
              mediaType: 'text/markdown',
              contentBase64: Buffer.from('# Notes').toString('base64'),
            },
          ],
        },
      },
      SOURCES_FRONTEND_COMMAND_TYPES.submit,
    );

    expect(request.payload).toMatchObject({ draftId: 'draft-1' });
  });

  it('accepts an enum-only Source classification request but rejects malformed classification', () => {
    const request = {
      envelopeVersion: '1.0.0',
      commandType: SOURCES_FRONTEND_COMMAND_TYPES.submit,
      commandSchemaVersion: '1.0.0',
      clientRequestId: 'request-classification',
      idempotencyKey: 'idempotency-classification',
      projectContext: { activeProjectId: 'project-1', targetProjectId: 'project-1' },
      policyBinding: { mode: 'CURRENT' },
      preconditions: [],
      clientIssuedAt: now,
      payload: {
        draftId: 'draft-classification',
        inputs: [
          {
            itemId: 'item-classification',
            kind: 'DIRECT_TEXT',
            label: 'Synthetic public text',
            stagingReference: 'sources-stage-v1.sealed',
            requestedClassification: 'public',
          },
        ],
      },
    };
    expect(validateStagedSourcesFrontendCommandRequest(request).payload.inputs[0]).toMatchObject({
      requestedClassification: 'public',
    });
    expect(() =>
      validateStagedSourcesFrontendCommandRequest({
        ...request,
        payload: {
          ...request.payload,
          inputs: [{ ...request.payload.inputs[0], requestedClassification: 'unbounded' }],
        },
      }),
    ).toThrow(FrontendContractError);
  });

  it('rejects browser-created Source authority and invalid duplicate disposition shape', () => {
    const envelope = {
      envelopeVersion: '1.0.0',
      commandType: SOURCES_FRONTEND_COMMAND_TYPES.submit,
      commandSchemaVersion: '1.0.0',
      clientRequestId: 'request-1',
      idempotencyKey: 'idempotency-1',
      projectContext: {
        activeProjectId: 'project-1',
        targetProjectId: 'project-1',
        resourceProjectId: 'project-1',
      },
      policyBinding: { mode: 'CURRENT' },
      preconditions: [],
      clientIssuedAt: now,
    };

    expect(() =>
      validateSourcesFrontendCommandRequest(
        {
          ...envelope,
          payload: {
            draftId: 'draft-1',
            sourceId: 'browser-source',
            inputs: [
              {
                itemId: 'item-1',
                kind: 'DIRECT_TEXT',
                label: 'Text',
                text: 'Original text',
              },
            ],
          },
        },
        SOURCES_FRONTEND_COMMAND_TYPES.submit,
      ),
    ).toThrow(/unsupported fields/);

    expect(() =>
      validateSourcesFrontendCommandRequest(
        {
          ...envelope,
          commandType: SOURCES_FRONTEND_COMMAND_TYPES.resolveDuplicate,
          projectContext: {
            ...envelope.projectContext,
            resourceProjectId: 'project-1',
          },
          payload: {
            decisionId: 'decision-1',
            disposition: 'REUSE_EXISTING_VERSION',
            targetSourceId: 'source-1',
          },
        },
        SOURCES_FRONTEND_COMMAND_TYPES.resolveDuplicate,
      ),
    ).toThrow(/only valid/);
  });

  it('deeply decodes a bounded Source Library page', () => {
    const decoded = decodeSourceLibraryPageView({
      schemaVersion: '1.0.0',
      principalId: 'principal-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      items: [libraryItem],
      queryDigest: hash,
      ...revisions,
      stale: false,
    });

    expect(decoded.items[0]?.askUsageState).toBe('EVIDENCE_READY');
    expect(decoded.items[0]?.selectedSourceVersionId).toBe('version-1');
  });

  it('rejects unknown nested Source state and unbounded result sets', () => {
    expect(() =>
      decodeSourceLibraryPageView({
        schemaVersion: '1.0.0',
        principalId: 'principal-1',
        sessionId: 'session-1',
        projectId: 'project-1',
        items: [{ ...libraryItem, askUsageState: 'READY_ENOUGH' }],
        queryDigest: hash,
        ...revisions,
        stale: false,
      }),
    ).toThrow(FrontendContractError);

    expect(() =>
      decodeSourceLibraryPageView({
        schemaVersion: '1.0.0',
        principalId: 'principal-1',
        sessionId: 'session-1',
        projectId: 'project-1',
        items: Array.from({ length: 101 }, () => libraryItem),
        queryDigest: hash,
        ...revisions,
        stale: false,
      }),
    ).toThrow(/at most 100/);
  });

  it('decodes a project-bound query and rejects oversized search or limits', () => {
    expect(
      decodeSourceLibraryQuery({
        schemaVersion: '1.0.0',
        query: 'architecture',
        filters: {
          mediaTypes: ['text/markdown'],
          lifecycle: ['ACTIVE'],
          askUsageStates: ['EVIDENCE_READY'],
          attentionOnly: false,
        },
        sort: 'UPDATED_DESC',
        limit: 50,
      }),
    ).toMatchObject({ limit: 50, sort: 'UPDATED_DESC' });

    expect(() =>
      decodeSourceLibraryQuery({
        schemaVersion: '1.0.0',
        query: 'x'.repeat(501),
        filters: {},
        sort: 'UPDATED_DESC',
        limit: 50,
      }),
    ).toThrow(/500/);

    expect(() =>
      decodeSourceLibraryQuery({
        schemaVersion: '1.0.0',
        filters: {},
        sort: 'UPDATED_DESC',
        limit: 101,
      }),
    ).toThrow(/100/);
  });

  it('decodes authoritative per-item partial submission state', () => {
    const decoded = decodeIntakeSubmissionSnapshot({
      schemaVersion: '1.0.0',
      submissionId: 'submission-1',
      principalId: 'principal-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      state: 'PARTIAL',
      items: [
        {
          itemId: 'item-1',
          manifest: {
            kind: 'DIRECT_TEXT',
            itemId: 'item-1',
            label: 'Pasted notes',
            mediaType: 'text/plain',
            sizeBytes: 12,
            contentHash: hash,
          },
          state: 'SUCCEEDED',
          validation: [{ code: 'VALID', valid: true, message: 'Valid input.' }],
          producedResource: {
            sourceId: 'source-1',
            sourceVersionId: 'version-1',
            projectId: 'project-1',
            versionNumber: 1,
          },
          capabilities: ['PREVIEW'],
        },
        {
          itemId: 'item-2',
          manifest: {
            kind: 'FILE',
            itemId: 'item-2',
            label: 'Encrypted file',
            fileName: 'secret.pdf',
            mediaType: 'application/pdf',
            sizeBytes: 2048,
          },
          state: 'FAILED',
          validation: [
            {
              code: 'ENCRYPTED',
              valid: false,
              message: 'Encrypted documents are not supported.',
            },
          ],
          safeFailure: {
            code: 'ENCRYPTED_INPUT',
            message: 'The document could not be processed.',
            retryable: false,
          },
          capabilities: [],
          attentionReason: 'Remove encryption and create a new submission.',
        },
      ],
      capabilities: [],
      acceptedPolicyContextId: 'policy-context-1',
      submissionRevision: 'submission-4',
      accessRevision: 'access-3',
      policyContextRevision: 'policy-5',
      createdAt: now,
      updatedAt: now,
      stale: false,
    });

    expect(decoded.state).toBe('PARTIAL');
    expect(decoded.items.map((item) => item.state)).toEqual(['SUCCEEDED', 'FAILED']);
  });

  it('rejects invalid URL descriptors and inconsistent validation flags', () => {
    const base = {
      schemaVersion: '1.0.0',
      submissionId: 'submission-1',
      principalId: 'principal-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      state: 'VALIDATING',
      capabilities: ['CANCEL'],
      acceptedPolicyContextId: 'policy-context-1',
      submissionRevision: 'submission-1',
      accessRevision: 'access-3',
      policyContextRevision: 'policy-5',
      createdAt: now,
      updatedAt: now,
      stale: false,
    };

    expect(() =>
      decodeIntakeSubmissionSnapshot({
        ...base,
        items: [
          {
            itemId: 'item-1',
            manifest: {
              kind: 'URL',
              itemId: 'item-1',
              label: 'Local file',
              requestedUrl: 'file:///etc/passwd',
            },
            state: 'VALIDATING',
            validation: [],
            capabilities: [],
          },
        ],
      }),
    ).toThrow(/HTTP/);

    expect(() =>
      decodeIntakeSubmissionSnapshot({
        ...base,
        items: [
          {
            itemId: 'item-1',
            manifest: {
              kind: 'DIRECT_TEXT',
              itemId: 'item-1',
              label: 'Text',
              mediaType: 'text/plain',
              sizeBytes: 1,
            },
            state: 'VALIDATING',
            validation: [{ code: 'VALID', valid: false, message: 'Not valid.' }],
            capabilities: [],
          },
        ],
      }),
    ).toThrow(/inconsistent/);
  });

  it('decodes exact duplicate evidence and only approved dispositions', () => {
    const decoded = decodeExactDuplicateDecisionView({
      schemaVersion: '1.0.0',
      decisionId: 'decision-1',
      submissionId: 'submission-1',
      itemId: 'item-1',
      projectId: 'project-1',
      contentHash: hash,
      existingSource: {
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        label: 'Existing source',
        versionNumber: 1,
      },
      allowedDispositions: ['REUSE_EXISTING_VERSION', 'CREATE_SEPARATE_SOURCE'],
      decisionRevision: 'decision-1',
      sourceRevision: 'source-2',
      accessRevision: 'access-3',
      policyContextRevision: 'policy-5',
      createdAt: now,
    });

    expect(decoded.allowedDispositions).toEqual([
      'REUSE_EXISTING_VERSION',
      'CREATE_SEPARATE_SOURCE',
    ]);

    expect(() =>
      decodeExactDuplicateDecisionView({
        ...decoded,
        allowedDispositions: ['AUTO_MERGE'],
      }),
    ).toThrow(FrontendContractError);
  });

  it('pins Source detail and ordered Version history to explicit identities', () => {
    expect(
      decodeSourceDetailView({
        schemaVersion: '1.0.0',
        sourceId: 'source-1',
        projectId: 'project-1',
        label: 'Architecture notes',
        lifecycle: 'ACTIVE',
        mediaType: 'text/markdown',
        sensitivity: 'internal',
        currentSourceVersionId: 'version-2',
        versionCount: 2,
        previewReadiness: 'READY',
        askUsageState: 'EVIDENCE_READY',
        askUsageExplanation: 'Evidence is indexed.',
        capabilities: ['PREVIEW', 'SELECT_FOR_ASK'],
        sourceRevision: 'source-3',
        ...revisions,
        createdAt: now,
        updatedAt: now,
      }).currentSourceVersionId,
    ).toBe('version-2');

    expect(
      decodeSourceVersionHistoryView({
        schemaVersion: '1.0.0',
        sourceId: 'source-1',
        projectId: 'project-1',
        selectedSourceVersionId: 'version-1',
        versions: [
          {
            sourceVersionId: 'version-2',
            versionNumber: 2,
            contentHash: hash,
            mediaType: 'text/markdown',
            sizeBytes: 24,
            createdAt: now,
            transformationState: 'READY',
            evidenceCount: 2,
          },
          {
            sourceVersionId: 'version-1',
            versionNumber: 1,
            contentHash: hash,
            mediaType: 'text/markdown',
            sizeBytes: 12,
            createdAt: now,
            transformationState: 'READY',
            evidenceCount: 1,
          },
        ],
        ...revisions,
      }).selectedSourceVersionId,
    ).toBe('version-1');

    expect(() =>
      decodeSourceVersionHistoryView({
        schemaVersion: '1.0.0',
        sourceId: 'source-1',
        projectId: 'project-1',
        selectedSourceVersionId: 'version-missing',
        versions: [],
        ...revisions,
      }),
    ).toThrow(/absent/);
  });

  it('deeply decodes Preview and Evidence locators', () => {
    const preview = decodeSourcePreviewView({
      schemaVersion: '1.0.0',
      sourceId: 'source-1',
      sourceVersionId: 'version-1',
      projectId: 'project-1',
      mediaType: 'application/pdf',
      contentHash: hash,
      mode: 'TRANSFORMED',
      readiness: 'READY',
      text: 'Selected evidence',
      locators: [
        { type: 'PageSelector', page: 2 },
        {
          type: 'BoundingBoxSelector',
          page: 2,
          x: 10,
          y: 20,
          width: 100,
          height: 30,
          unit: 'pt',
        },
      ],
      capabilities: ['PREVIEW', 'DOWNLOAD_ORIGINAL'],
      ...revisions,
    });
    expect(preview.locators).toHaveLength(2);

    expect(
      decodeEvidenceListView({
        schemaVersion: '1.0.0',
        projectId: 'project-1',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        items: [
          {
            evidenceId: 'evidence-1',
            sourceId: 'source-1',
            sourceVersionId: 'version-1',
            revisionId: 'revision-1',
            label: 'Evidence paragraph',
            origin: 'ORIGINAL',
            exactText: 'Selected evidence',
            locators: [
              {
                type: 'TextPositionSelector',
                start: 0,
                end: 17,
                unit: 'unicode-code-point',
              },
            ],
            createdAt: now,
          },
        ],
        ...revisions,
      }).items[0]?.origin,
    ).toBe('ORIGINAL');

    expect(() =>
      decodeSourcePreviewView({
        ...preview,
        locators: [{ type: 'PageSelector', page: 0 }],
      }),
    ).toThrow(/greater than or equal to 1/);
  });

  it('accepts only internal Citation return routes and explicit pinned identities', () => {
    expect(
      decodeCitationReturnTarget({
        schemaVersion: '1.0.0',
        originRoute: '/ask/conversations/conversation-1',
        resourceKind: 'conversation',
        resourceId: 'conversation-1',
        resourceRevision: 'conversation-7',
        citationId: 'citation-1',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        evidenceId: 'evidence-1',
        scrollAnchor: 'message-4',
        focusTarget: 'citation-1',
        panelId: 'evidence-panel',
      }).sourceVersionId,
    ).toBe('version-1');

    expect(() =>
      decodeCitationReturnTarget({
        schemaVersion: '1.0.0',
        originRoute: 'https://attacker.invalid/',
        resourceKind: 'conversation',
        resourceId: 'conversation-1',
        resourceRevision: 'conversation-7',
        citationId: 'citation-1',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        evidenceId: 'evidence-1',
      }),
    ).toThrow(/internal absolute route/);
  });

  it('decodes bounded Draft Seeds and rejects browser-created Source authority', () => {
    expect(
      decodeIntakeDraftSeed({
        schemaVersion: '1.0.0',
        seedId: 'seed-1',
        projectId: 'project-1',
        originatingWorkspace: 'ask',
        input: {
          kind: 'DIRECT_TEXT',
          label: 'Question context',
          text: 'Evidence supplied by the user.',
        },
      }).projectId,
    ).toBe('project-1');

    expect(() =>
      decodeIntakeDraftSeed({
        schemaVersion: '1.0.0',
        seedId: 'seed-2',
        projectId: 'project-1',
        originatingWorkspace: 'ask',
        sourceId: 'browser-source',
        input: {
          kind: 'URL',
          label: 'Reference',
          requestedUrl: 'https://example.com/reference',
        },
      }),
    ).toThrow(/unsupported fields/);

    expect(() =>
      decodeIntakeDraftSeed({
        schemaVersion: '1.0.0',
        seedId: 'seed-3',
        projectId: 'project-1',
        originatingWorkspace: 'ask',
        input: {
          kind: 'FILE_METADATA',
          label: 'Oversized file',
          fileName: 'large.pdf',
          mediaType: 'application/pdf',
          sizeBytes: 10 * 1024 * 1024 + 1,
        },
      }),
    ).toThrow(/10 MiB/);
  });
});
