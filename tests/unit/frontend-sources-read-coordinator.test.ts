import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  InMemoryAssetStorage,
  InMemoryOriginalAssetRepository,
} from '../../adapters/stage2-in-memory/src/index.js';
import { InMemoryEvidenceRepository } from '../../adapters/stage3-in-memory/src/index.js';
import { FrontendSourcesReadCoordinator } from '../../modules/frontend-sources-product/src/index.js';
import { sha256Text, type SourcesSensitivity } from '../../packages/contracts/src/index.js';

const now = '2026-07-30T12:00:00.000Z';

const scope = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  authorizedProjectId: 'project-1',
  accessScopes: ['owner'],
  sensitivityClearance: 'private' as SourcesSensitivity,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
};

const hashBytes = (bytes: Uint8Array) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const seed = async (
  repository: InMemoryOriginalAssetRepository,
  storage: InMemoryAssetStorage,
  input: {
    submissionId: string;
    projectId?: string;
    requestedSourceId?: string;
    text: string;
    fileName?: string;
    sensitivity?: SourcesSensitivity;
  },
) => {
  const bytes = Buffer.from(input.text, 'utf8');
  const contentHash = hashBytes(bytes);
  const storageKey = await storage.put(contentHash, bytes);
  return repository.store({
    submissionId: input.submissionId,
    projectId: input.projectId ?? 'project-1',
    actorId: 'principal-1',
    ...(input.requestedSourceId === undefined
      ? {}
      : { requestedSourceId: input.requestedSourceId }),
    channel: input.fileName ? 'file_upload' : 'direct_text',
    materialKind: 'plain_text',
    mediaType: input.fileName ? 'text/markdown' : 'text/plain',
    ...(input.fileName === undefined ? {} : { originalFileName: input.fileName }),
    contentHash,
    sizeBytes: bytes.byteLength,
    storageKey,
    accessScope: ['owner'],
    sensitivity: input.sensitivity ?? 'internal',
    createdAt: now,
  });
};

describe('FrontendSourcesReadCoordinator', () => {
  it('composes bounded project-scoped Library, detail and pinned Version history', async () => {
    const repository = new InMemoryOriginalAssetRepository();
    const storage = new InMemoryAssetStorage();
    const evidence = new InMemoryEvidenceRepository();
    const first = await seed(repository, storage, {
      submissionId: 'submission-1',
      text: '# First',
      fileName: 'first.md',
    });
    await seed(repository, storage, {
      submissionId: 'submission-2',
      requestedSourceId: first.sourceId,
      text: '# Second',
      fileName: 'second.md',
    });
    await seed(repository, storage, {
      submissionId: 'submission-other-project',
      projectId: 'project-2',
      text: 'Hidden',
    });
    const coordinator = new FrontendSourcesReadCoordinator(repository, storage, evidence);

    const page = await coordinator.list(scope, {
      schemaVersion: '1.0.0',
      query: 'second',
      filters: {},
      sort: 'UPDATED_DESC',
      limit: 20,
    });
    expect(page.projectId).toBe('project-1');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      sourceId: first.sourceId,
      selectedSourceVersionId: expect.any(String),
      versionCount: 2,
      askUsageState: 'SOURCE_VERSION_READY',
    });

    const detail = await coordinator.detail(scope, first.sourceId);
    expect(detail).toMatchObject({
      sourceId: first.sourceId,
      versionCount: 2,
      currentSourceVersionId: page.items[0]?.selectedSourceVersionId,
    });

    const history = await coordinator.history(scope, first.sourceId, first.sourceVersionId);
    expect(history?.selectedSourceVersionId).toBe(first.sourceVersionId);
    expect(history?.versions.map((version) => version.versionNumber)).toEqual([2, 1]);
  });

  it('returns original text and exact Evidence locators for an explicit SourceVersion', async () => {
    const repository = new InMemoryOriginalAssetRepository();
    const storage = new InMemoryAssetStorage();
    const evidence = new InMemoryEvidenceRepository();
    const stored = await seed(repository, storage, {
      submissionId: 'submission-1',
      text: 'Original evidence',
    });
    await evidence.index([
      {
        revisionId: 'revision-1',
        projectId: 'project-1',
        sourceId: stored.sourceId,
        sourceVersionId: stored.sourceVersionId,
        pointer: '/blocks/0',
        nodeKind: 'paragraph',
        origin: 'source',
        position: {
          type: 'TextPositionSelector',
          start: 0,
          end: 17,
          unit: 'unicode-code-point',
        },
        quote: { type: 'TextQuoteSelector', exact: 'Original evidence' },
        exactHash: sha256Text('Original evidence'),
        accessScope: ['owner'],
        sensitivity: 'internal',
        createdAt: now,
      },
    ]);
    const coordinator = new FrontendSourcesReadCoordinator(repository, storage, evidence);

    const preview = await coordinator.preview(
      scope,
      stored.sourceId,
      stored.sourceVersionId,
      'ORIGINAL',
    );
    expect(preview?.text).toBe('Original evidence');
    expect(preview?.locators.map((locator) => locator.type)).toEqual([
      'TextPositionSelector',
      'TextQuoteSelector',
    ]);

    const list = await coordinator.evidenceList(scope, stored.sourceId, stored.sourceVersionId);
    expect(list?.items[0]).toMatchObject({
      sourceVersionId: stored.sourceVersionId,
      origin: 'ORIGINAL',
      exactText: 'Original evidence',
    });
  });

  it('masks cross-project, missing-scope and over-clearance Sources', async () => {
    const repository = new InMemoryOriginalAssetRepository();
    const storage = new InMemoryAssetStorage();
    const evidence = new InMemoryEvidenceRepository();
    const privateSource = await seed(repository, storage, {
      submissionId: 'submission-private',
      text: 'Private',
      sensitivity: 'private',
    });
    const otherProject = await seed(repository, storage, {
      submissionId: 'submission-other',
      projectId: 'project-2',
      text: 'Other',
    });
    const coordinator = new FrontendSourcesReadCoordinator(repository, storage, evidence);
    const restrictedScope = {
      ...scope,
      accessScopes: [],
      sensitivityClearance: 'internal' as const,
    };

    await expect(coordinator.detail(restrictedScope, privateSource.sourceId)).resolves.toBeNull();
    await expect(coordinator.detail(scope, otherProject.sourceId)).resolves.toBeNull();
    await expect(
      coordinator.list(restrictedScope, {
        schemaVersion: '1.0.0',
        filters: {},
        sort: 'UPDATED_DESC',
        limit: 20,
      }),
    ).resolves.toMatchObject({ items: [] });
  });

  it('binds pagination cursor to Project, query, projection and current authority revisions', async () => {
    const repository = new InMemoryOriginalAssetRepository();
    const storage = new InMemoryAssetStorage();
    const evidence = new InMemoryEvidenceRepository();
    await seed(repository, storage, { submissionId: 'submission-1', text: 'One' });
    await seed(repository, storage, { submissionId: 'submission-2', text: 'Two' });
    const coordinator = new FrontendSourcesReadCoordinator(repository, storage, evidence);
    const query = {
      schemaVersion: '1.0.0' as const,
      filters: {},
      sort: 'UPDATED_DESC' as const,
      limit: 1,
    };
    const first = await coordinator.list(scope, query);
    expect(first.nextCursor).toBeDefined();

    await expect(
      coordinator.list(
        { ...scope, policyContextRevision: 'policy-2' },
        { ...query, cursor: first.nextCursor },
      ),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
    await expect(
      coordinator.list(
        { ...scope, accessRevision: 'access-2' },
        { ...query, cursor: first.nextCursor },
      ),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
    await expect(
      coordinator.list(
        { ...scope, authorizedProjectId: 'project-2' },
        { ...query, cursor: first.nextCursor },
      ),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });

    await seed(repository, storage, { submissionId: 'submission-3', text: 'Three' });
    await expect(
      coordinator.list(scope, { ...query, cursor: first.nextCursor }),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
  });
});
