import { createHash } from 'node:crypto';

import {
  decodeEvidenceListView,
  decodeSourceDetailView,
  decodeSourceLibraryPageView,
  decodeSourcePreviewView,
  decodeSourceVersionHistoryView,
  ShotgunError,
  stableJson,
  type EvidenceListView,
  type EvidenceSpan,
  type SourceDetailView,
  type SourceLibraryPageView,
  type SourceLibraryQuery,
  type SourcePreviewView,
  type SourcesSensitivity,
  type SourceVersionHistoryView,
} from '../../../packages/contracts/src/index.js';

export type SourcesProjectionRecord = {
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly versionNumber: number;
  readonly mediaType: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly displayLabel?: string;
  readonly originalFileName?: string;
  readonly storageKey: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: SourcesSensitivity;
  readonly createdAt: string;
  readonly stage3State?:
    | 'MATERIALIZED'
    | 'STAGE3_RUNNING'
    | 'STAGE3_COMPLETED'
    | 'NO_EVIDENCE'
    | 'STAGE3_RETRYABLE'
    | 'RECONCILIATION_REQUIRED';
};

export type SourcesProjectionRepositoryPort = {
  listProjectSourceVersions(projectId: string): Promise<readonly SourcesProjectionRecord[]>;
};

export type SourcesAssetReaderPort = {
  read(storageKey: string): Promise<Uint8Array | undefined>;
};

export type SourcesEvidenceReaderPort = {
  listBySourceVersion(projectId: string, sourceVersionId: string): Promise<readonly EvidenceSpan[]>;
};

export type ServerAuthorizedProjectSourcesReadScope = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly authorizedProjectId: string;
  readonly accessScopes: readonly string[];
  readonly sensitivityClearance: SourcesSensitivity;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
};

type CursorPayload = {
  readonly projectId: string;
  readonly queryDigest: string;
  readonly projectionRevision: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly offset: number;
};

const sensitivityRank: Readonly<Record<SourcesSensitivity, number>> = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
};

const sha256 = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

const projectionRevision = (records: readonly SourcesProjectionRecord[]): string =>
  sha256(
    stableJson(
      records.map((record) => ({
        sourceId: record.sourceId,
        sourceVersionId: record.sourceVersionId,
        versionNumber: record.versionNumber,
        contentHash: record.contentHash,
        createdAt: record.createdAt,
      })),
    ),
  );

const assertAuthorized = (
  record: SourcesProjectionRecord,
  scope: ServerAuthorizedProjectSourcesReadScope,
): boolean => {
  if (record.projectId !== scope.authorizedProjectId) return false;
  if (sensitivityRank[record.sensitivity] > sensitivityRank[scope.sensitivityClearance]) {
    return false;
  }
  const available = new Set(scope.accessScopes);
  return record.accessScope.every((required) => available.has(required));
};

const labelFor = (record: SourcesProjectionRecord): string =>
  record.displayLabel?.trim() ||
  record.originalFileName?.trim() ||
  (record.mediaType === 'text/plain' ? 'Untitled direct text' : 'Untitled source');

const transformationStateFor = (
  stage3State: SourcesProjectionRecord['stage3State'],
  evidenceCount: number,
): 'NOT_STARTED' | 'RUNNING' | 'RETRYING' | 'BLOCKED' | 'NO_EVIDENCE' | 'READY' => {
  if (stage3State === 'STAGE3_RUNNING') return 'RUNNING';
  if (stage3State === 'STAGE3_RETRYABLE') return 'RETRYING';
  if (stage3State === 'RECONCILIATION_REQUIRED') return 'BLOCKED';
  if (stage3State === 'NO_EVIDENCE') return 'NO_EVIDENCE';
  if (stage3State === 'STAGE3_COMPLETED' || evidenceCount > 0) return 'READY';
  if (stage3State === 'MATERIALIZED') return 'RUNNING';
  return 'NOT_STARTED';
};

const latestBySource = (
  records: readonly SourcesProjectionRecord[],
): readonly SourcesProjectionRecord[] => {
  const latest = new Map<string, SourcesProjectionRecord>();
  for (const record of records) {
    const current = latest.get(record.sourceId);
    if (!current || record.versionNumber > current.versionNumber) {
      latest.set(record.sourceId, record);
    }
  }
  return [...latest.values()];
};

const queryDigestFor = (query: SourceLibraryQuery): string =>
  sha256(
    stableJson({
      query: query.query?.trim().toLocaleLowerCase() ?? '',
      filters: query.filters,
      sort: query.sort,
    }),
  );

const encodeCursor = (payload: CursorPayload): string =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

const decodeCursor = (value: string): CursorPayload | undefined => {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      typeof (parsed as CursorPayload).projectId !== 'string' ||
      typeof (parsed as CursorPayload).queryDigest !== 'string' ||
      typeof (parsed as CursorPayload).projectionRevision !== 'string' ||
      typeof (parsed as CursorPayload).accessRevision !== 'string' ||
      typeof (parsed as CursorPayload).policyContextRevision !== 'string' ||
      !Number.isInteger((parsed as CursorPayload).offset) ||
      (parsed as CursorPayload).offset < 0
    ) {
      return undefined;
    }
    return parsed as CursorPayload;
  } catch {
    return undefined;
  }
};

const sortLibrary = (
  records: readonly SourcesProjectionRecord[],
  sort: SourceLibraryQuery['sort'],
): readonly SourcesProjectionRecord[] =>
  [...records].sort((left, right) => {
    if (sort === 'LABEL_ASC' || sort === 'LABEL_DESC') {
      const compared = labelFor(left).localeCompare(labelFor(right));
      return sort === 'LABEL_ASC' ? compared : -compared;
    }
    const compared = left.createdAt.localeCompare(right.createdAt);
    return sort === 'UPDATED_ASC' ? compared : -compared;
  });

export class FrontendSourcesReadCoordinator {
  constructor(
    private readonly sources: SourcesProjectionRepositoryPort,
    private readonly storage: SourcesAssetReaderPort,
    private readonly evidence: SourcesEvidenceReaderPort,
  ) {}

  private async authorizedRecords(scope: ServerAuthorizedProjectSourcesReadScope) {
    return (await this.sources.listProjectSourceVersions(scope.authorizedProjectId)).filter(
      (record) => assertAuthorized(record, scope),
    );
  }

  async list(
    scope: ServerAuthorizedProjectSourcesReadScope,
    query: SourceLibraryQuery,
  ): Promise<SourceLibraryPageView> {
    const records = await this.authorizedRecords(scope);
    const revision = projectionRevision(records);
    const digest = queryDigestFor(query);
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    if (
      query.cursor !== undefined &&
      (!cursor ||
        cursor.projectId !== scope.authorizedProjectId ||
        cursor.queryDigest !== digest ||
        cursor.projectionRevision !== revision ||
        cursor.accessRevision !== scope.accessRevision ||
        cursor.policyContextRevision !== scope.policyContextRevision)
    ) {
      throw new ShotgunError({
        code: 'STALE_VERSION',
        safeMessage: 'The Source Library cursor is stale. Refresh the Library and try again.',
        module: 'frontend-sources-product',
        operation: 'list-sources',
      });
    }
    const normalizedQuery = query.query?.trim().toLocaleLowerCase();
    const filtered = latestBySource(records).filter((record) => {
      if (normalizedQuery && !labelFor(record).toLocaleLowerCase().includes(normalizedQuery)) {
        return false;
      }
      if (query.filters.mediaTypes && !query.filters.mediaTypes.includes(record.mediaType)) {
        return false;
      }
      if (query.filters.lifecycle && !query.filters.lifecycle.includes('ACTIVE')) {
        return false;
      }
      const askState = 'SOURCE_VERSION_READY' as const;
      if (query.filters.askUsageStates && !query.filters.askUsageStates.includes(askState)) {
        return false;
      }
      return query.filters.attentionOnly !== true;
    });
    const sorted = sortLibrary(filtered, query.sort);
    const offset = cursor?.offset ?? 0;
    const pageRecords = sorted.slice(offset, offset + query.limit);
    const nextOffset = offset + pageRecords.length;
    const fetchedAt = new Date().toISOString();
    return decodeSourceLibraryPageView({
      schemaVersion: '1.0.0',
      principalId: scope.principalId,
      sessionId: scope.sessionId,
      projectId: scope.authorizedProjectId,
      items: pageRecords.map((record) => ({
        sourceId: record.sourceId,
        projectId: record.projectId,
        label: labelFor(record),
        mediaType: record.mediaType,
        lifecycle: 'ACTIVE',
        previewReadiness: 'READY',
        askUsageState: 'SOURCE_VERSION_READY',
        askUsageExplanation: 'The immutable SourceVersion is available for selection.',
        selectedSourceVersionId: record.sourceVersionId,
        versionCount: records.filter((item) => item.sourceId === record.sourceId).length,
        capabilities: ['PREVIEW', 'DOWNLOAD_ORIGINAL', 'SELECT_FOR_ASK'],
        sensitivity: record.sensitivity,
        updatedAt: record.createdAt,
      })),
      ...(nextOffset < sorted.length
        ? {
            nextCursor: encodeCursor({
              projectId: scope.authorizedProjectId,
              queryDigest: digest,
              projectionRevision: revision,
              accessRevision: scope.accessRevision,
              policyContextRevision: scope.policyContextRevision,
              offset: nextOffset,
            }),
          }
        : {}),
      queryDigest: digest,
      projectionRevision: revision,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      fetchedAt,
      stale: false,
    });
  }

  async detail(
    scope: ServerAuthorizedProjectSourcesReadScope,
    sourceId: string,
  ): Promise<SourceDetailView | null> {
    const records = (await this.authorizedRecords(scope)).filter(
      (record) => record.sourceId === sourceId,
    );
    const latest = latestBySource(records)[0];
    if (!latest) return null;
    return decodeSourceDetailView({
      schemaVersion: '1.0.0',
      sourceId,
      projectId: latest.projectId,
      label: labelFor(latest),
      lifecycle: 'ACTIVE',
      mediaType: latest.mediaType,
      sensitivity: latest.sensitivity,
      currentSourceVersionId: latest.sourceVersionId,
      versionCount: records.length,
      previewReadiness: 'READY',
      askUsageState: 'SOURCE_VERSION_READY',
      askUsageExplanation: 'The immutable SourceVersion is available for selection.',
      capabilities: ['PREVIEW', 'DOWNLOAD_ORIGINAL', 'SELECT_FOR_ASK'],
      sourceRevision: projectionRevision(records),
      projectionRevision: projectionRevision(await this.authorizedRecords(scope)),
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      createdAt: [...records].sort((left, right) => left.versionNumber - right.versionNumber)[0]!
        .createdAt,
      updatedAt: latest.createdAt,
    });
  }

  async history(
    scope: ServerAuthorizedProjectSourcesReadScope,
    sourceId: string,
    selectedSourceVersionId: string,
  ): Promise<SourceVersionHistoryView | null> {
    const records = (await this.authorizedRecords(scope))
      .filter((record) => record.sourceId === sourceId)
      .sort((left, right) => right.versionNumber - left.versionNumber);
    if (
      records.length === 0 ||
      !records.some((record) => record.sourceVersionId === selectedSourceVersionId)
    ) {
      return null;
    }
    const evidenceCounts = new Map<string, number>();
    await Promise.all(
      records.map(async (record) => {
        evidenceCounts.set(
          record.sourceVersionId,
          (await this.evidence.listBySourceVersion(record.projectId, record.sourceVersionId))
            .length,
        );
      }),
    );
    return decodeSourceVersionHistoryView({
      schemaVersion: '1.0.0',
      sourceId,
      projectId: scope.authorizedProjectId,
      selectedSourceVersionId,
      versions: records.slice(0, 100).map((record) => ({
        sourceVersionId: record.sourceVersionId,
        versionNumber: record.versionNumber,
        contentHash: record.contentHash,
        mediaType: record.mediaType,
        sizeBytes: record.sizeBytes,
        createdAt: record.createdAt,
        transformationState: transformationStateFor(
          record.stage3State,
          evidenceCounts.get(record.sourceVersionId) ?? 0,
        ),
        evidenceCount: evidenceCounts.get(record.sourceVersionId) ?? 0,
      })),
      projectionRevision: projectionRevision(records),
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      fetchedAt: new Date().toISOString(),
    });
  }

  async preview(
    scope: ServerAuthorizedProjectSourcesReadScope,
    sourceId: string,
    sourceVersionId: string,
    mode: 'ORIGINAL' | 'TRANSFORMED',
  ): Promise<SourcePreviewView | null> {
    const record = (await this.authorizedRecords(scope)).find(
      (candidate) =>
        candidate.sourceId === sourceId && candidate.sourceVersionId === sourceVersionId,
    );
    if (!record) return null;
    const evidence = await this.evidence.listBySourceVersion(
      record.projectId,
      record.sourceVersionId,
    );
    const bytes = mode === 'ORIGINAL' ? await this.storage.read(record.storageKey) : undefined;
    const text =
      bytes && record.mediaType.startsWith('text/')
        ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
        : undefined;
    return decodeSourcePreviewView({
      schemaVersion: '1.0.0',
      sourceId,
      sourceVersionId,
      projectId: record.projectId,
      mediaType: record.mediaType,
      contentHash: record.contentHash,
      mode,
      readiness: mode === 'TRANSFORMED' && evidence.length === 0 ? 'NOT_READY' : 'READY',
      ...(text === undefined ? {} : { text }),
      locators: evidence.flatMap((item) => [item.position, item.quote, ...(item.selectors ?? [])]),
      capabilities: ['PREVIEW', 'DOWNLOAD_ORIGINAL'],
      projectionRevision: projectionRevision([record]),
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      fetchedAt: new Date().toISOString(),
    });
  }

  async evidenceList(
    scope: ServerAuthorizedProjectSourcesReadScope,
    sourceId: string,
    sourceVersionId: string,
  ): Promise<EvidenceListView | null> {
    const record = (await this.authorizedRecords(scope)).find(
      (candidate) =>
        candidate.sourceId === sourceId && candidate.sourceVersionId === sourceVersionId,
    );
    if (!record) return null;
    const items = await this.evidence.listBySourceVersion(record.projectId, sourceVersionId);
    return decodeEvidenceListView({
      schemaVersion: '1.0.0',
      projectId: record.projectId,
      sourceId,
      sourceVersionId,
      items: items.slice(0, 500).map((item) => ({
        evidenceId: item.evidenceId,
        sourceId: item.sourceId,
        sourceVersionId: item.sourceVersionId,
        revisionId: item.revisionId,
        label: item.quote.exact.slice(0, 120) || item.pointer,
        origin: 'ORIGINAL',
        exactText: item.quote.exact,
        locators: [item.position, item.quote, ...(item.selectors ?? [])],
        createdAt: item.createdAt,
      })),
      projectionRevision: projectionRevision([record]),
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      fetchedAt: new Date().toISOString(),
    });
  }
}
