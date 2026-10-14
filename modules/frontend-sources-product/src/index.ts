import { createHash } from 'node:crypto';
import { askGeneratedImageObservationReferenceFor } from '../../../packages/contracts/src/frontend-ask-image-observation.js';
import type { VPImageObservationV1 } from '../../../packages/contracts/src/vp-image-observation.js';

import {
  decodeEvidenceListView,
  decodeSourceCandidateListView,
  decodeSourceDetailView,
  decodeSourceLibraryPageView,
  decodeSourcePreviewView,
  decodeSourceVersionHistoryView,
  EXTERNAL_SOURCE_FRESHNESS_TTL_MS,
  ShotgunError,
  stableJson,
  type EvidenceListView,
  type EvidenceSpan,
  type ClaimCandidate,
  type SourceDetailView,
  type SourceLibraryPageView,
  type SourceLibraryQuery,
  type SourcePreviewView,
  type SourceCandidateListView,
  type SourcesSensitivity,
  type SourceVersionHistoryView,
} from '../../../packages/contracts/src/index.js';

export type SourcesProjectionRecord = {
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly originalAssetId?: string;
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
  /** Last successful fetch for an externally acquired URL SourceVersion. */
  readonly externalSourceLastCheckedAt?: string;
  readonly externalSourceRefreshFailed?: boolean;
  readonly stage3State?:
    | 'MATERIALIZED'
    | 'STAGE3_RUNNING'
    | 'STAGE3_COMPLETED'
    | 'NO_EVIDENCE'
    | 'STAGE3_RETRYABLE'
    | 'RECONCILIATION_REQUIRED'
    | 'IMAGE_OBSERVATION_COMPLETED';
  readonly imageObservationId?: string;
  /** Server-owned Stage 3 authority. Never infer this from evidence counts. */
  readonly activeEvidenceRevision?: {
    readonly indexingResultId: string;
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly revisionId: string;
    readonly status: 'INDEXED' | 'NO_EVIDENCE';
    readonly evidenceCount: number;
  };
};

export type SourcesProjectionRepositoryPort = {
  listProjectSourceVersions(projectId: string): Promise<readonly SourcesProjectionRecord[]>;
  /** Revalidates the active authority through progress → indexing → revision. */
  validateActiveEvidenceRevision?(input: {
    readonly projectId: string;
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly indexingResultId: string;
    readonly revisionId: string;
  }): Promise<boolean>;
};

export type SourcesAssetReaderPort = {
  read(storageKey: string): Promise<Uint8Array | undefined>;
};

export type SourcesImageReadOptions = {
  readonly imageValidator: {
    preflightImage(input: {
      readonly mediaType: 'image/png' | 'image/jpeg';
      readonly contentBase64: string;
      readonly sourceContentHash: string;
    }): Promise<{
      readonly width: number;
      readonly height: number;
      readonly pixels: number;
      readonly contentHash: string;
    }>;
  };
  readonly imageObservationLedger: {
    findHistorical(
      scope: {
        readonly projectId: string;
        readonly accessScope: readonly string[];
        readonly authorizedSensitivities: readonly SourcesSensitivity[];
      },
      observationId: string,
    ): Promise<VPImageObservationV1 | undefined>;
  };
};

export type SourcesEvidenceReaderPort = {
  listBySourceVersion(projectId: string, sourceVersionId: string): Promise<readonly EvidenceSpan[]>;
  listByRevision?(
    projectId: string,
    sourceVersionId: string,
    revisionId: string,
  ): Promise<readonly EvidenceSpan[]>;
};

/** Narrow Stage 4 read boundary used by the Source Detail Product surface. */
export type SourcesCandidateReaderPort = {
  listBySourceVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<readonly ClaimCandidate[]>;
  listByRevision?(
    projectId: string,
    sourceVersionId: string,
    revisionId: string,
  ): Promise<readonly ClaimCandidate[]>;
};

export type SourcesActiveEvidenceRevisionReaderPort = {
  getActiveEvidenceRevision(
    projectId: string,
    sourceVersionId: string,
  ): Promise<SourcesProjectionRecord['activeEvidenceRevision']>;
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

export type SourcesCandidateReextractTarget = {
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly revisionId: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: SourcesSensitivity;
  readonly dataClassification: 'source-content';
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
        activeEvidenceRevision: record.activeEvidenceRevision,
        ...(record.mediaType === 'image/png' || record.mediaType === 'image/jpeg'
          ? { imageObservationId: record.imageObservationId, stage3State: record.stage3State }
          : {}),
      })),
    ),
  );

const candidateProjectionRevision = (
  sourceVersionId: string,
  candidates: readonly SourceCandidateListView['items'][number][],
): string =>
  sha256(
    stableJson({
      sourceVersionId,
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        revisionNumber: candidate.revisionNumber,
        status: candidate.status,
        createdAt: candidate.createdAt,
      })),
    }),
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

const candidateIsAuthorized = (
  candidate: ClaimCandidate,
  scope: ServerAuthorizedProjectSourcesReadScope,
): boolean => {
  if (candidate.projectId !== scope.authorizedProjectId) return false;
  if (sensitivityRank[candidate.sensitivity] > sensitivityRank[scope.sensitivityClearance]) {
    return false;
  }
  const available = new Set(scope.accessScopes);
  return candidate.accessScope.every((required) => available.has(required));
};

const labelFor = (record: SourcesProjectionRecord): string =>
  record.displayLabel?.trim() ||
  record.originalFileName?.trim() ||
  (record.mediaType === 'text/plain' ? 'Untitled direct text' : 'Untitled source');
const imageMediaType = (record: SourcesProjectionRecord): 'image/png' | 'image/jpeg' | undefined =>
  record.mediaType === 'image/png' || record.mediaType === 'image/jpeg'
    ? record.mediaType
    : undefined;
const askUsageFor = (record: SourcesProjectionRecord) =>
  imageMediaType(record)
    ? record.stage3State === 'IMAGE_OBSERVATION_COMPLETED'
      ? ('IMAGE_OBSERVATION_COMPLETED' as const)
      : record.stage3State === 'RECONCILIATION_REQUIRED'
        ? ('ACTION_REQUIRED' as const)
        : ('NOT_READY' as const)
    : ('SOURCE_VERSION_READY' as const);
const askExplanationFor = (record: SourcesProjectionRecord): string =>
  imageMediaType(record)
    ? record.stage3State === 'IMAGE_OBSERVATION_COMPLETED'
      ? 'A generated, unverified image observation is available.'
      : record.stage3State === 'RECONCILIATION_REQUIRED'
        ? 'Image processing requires reconciliation. No observation is available for Ask.'
        : 'Image processing has not produced an observation for Ask.'
    : 'The immutable SourceVersion is available for selection.';

const transformationStateFor = (
  stage3State: SourcesProjectionRecord['stage3State'],
  authority: SourcesProjectionRecord['activeEvidenceRevision'],
):
  | 'NOT_STARTED'
  | 'RUNNING'
  | 'RETRYING'
  | 'BLOCKED'
  | 'NO_EVIDENCE'
  | 'READY'
  | 'IMAGE_OBSERVATION_COMPLETED' => {
  if (stage3State === 'IMAGE_OBSERVATION_COMPLETED') return 'IMAGE_OBSERVATION_COMPLETED';
  if (stage3State === 'STAGE3_RUNNING') return 'RUNNING';
  if (stage3State === 'STAGE3_RETRYABLE') return 'RETRYING';
  if (stage3State === 'RECONCILIATION_REQUIRED') return 'BLOCKED';
  if (stage3State === 'NO_EVIDENCE' && authority?.status === 'NO_EVIDENCE') return 'NO_EVIDENCE';
  if (stage3State === 'STAGE3_COMPLETED' && authority?.status === 'INDEXED') return 'READY';
  if (stage3State === 'STAGE3_COMPLETED' || stage3State === 'NO_EVIDENCE') return 'BLOCKED';
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
  private readonly imageRead?: SourcesImageReadOptions;
  constructor(
    private readonly sources: SourcesProjectionRepositoryPort,
    private readonly storage: SourcesAssetReaderPort,
    private readonly evidence: SourcesEvidenceReaderPort,
    private readonly candidates?: SourcesCandidateReaderPort,
    private readonly now: () => Date = () => new Date(),
    imageRead?: SourcesImageReadOptions,
  ) {
    this.imageRead = imageRead ? Object.freeze({ ...imageRead }) : undefined;
  }

  private async imageObservation(
    record: SourcesProjectionRecord,
    scope: ServerAuthorizedProjectSourcesReadScope,
  ): Promise<VPImageObservationV1 | undefined> {
    if (record.stage3State !== 'IMAGE_OBSERVATION_COMPLETED') return undefined;
    const observation =
      record.imageObservationId && this.imageRead
        ? await this.imageRead.imageObservationLedger.findHistorical(
            {
              projectId: scope.authorizedProjectId,
              accessScope: scope.accessScopes,
              authorizedSensitivities: Object.keys(sensitivityRank).filter(
                (sensitivity) =>
                  sensitivityRank[sensitivity as SourcesSensitivity] <=
                  sensitivityRank[scope.sensitivityClearance],
              ) as SourcesSensitivity[],
            },
            record.imageObservationId,
          )
        : undefined;
    if (
      !observation ||
      observation.sourceId !== record.sourceId ||
      observation.sourceVersionId !== record.sourceVersionId ||
      observation.projectId !== record.projectId ||
      observation.originalAssetId !== record.originalAssetId ||
      observation.sourceContentHash !== record.contentHash ||
      observation.image.mediaType !== record.mediaType ||
      record.activeEvidenceRevision
    )
      throw new ShotgunError({
        code: 'REVISION_CONFLICT',
        safeMessage: 'Image observation readiness authority is unavailable.',
        module: 'frontend-sources-product',
        operation: 'validate-image-observation',
      });
    return observation;
  }

  private async authorizedRecords(scope: ServerAuthorizedProjectSourcesReadScope) {
    const raw = await this.sources.listProjectSourceVersions(scope.authorizedProjectId);
    const latest = new Map(latestBySource(raw).map((record) => [record.sourceId, record]));
    const records = raw.filter(
      (record) =>
        assertAuthorized(record, scope) &&
        (!imageMediaType(record) ||
          (latest.get(record.sourceId) && assertAuthorized(latest.get(record.sourceId)!, scope))),
    );
    await Promise.all(
      records
        .filter((record) => record.stage3State === 'IMAGE_OBSERVATION_COMPLETED')
        .map((record) => this.imageObservation(record, scope)),
    );
    if (this.sources.validateActiveEvidenceRevision) {
      await Promise.all(
        records
          .filter((record) => record.activeEvidenceRevision)
          .map(async (record) => {
            const authority = record.activeEvidenceRevision!;
            const valid = await this.sources.validateActiveEvidenceRevision!({
              projectId: record.projectId,
              sourceId: record.sourceId,
              sourceVersionId: record.sourceVersionId,
              indexingResultId: authority.indexingResultId,
              revisionId: authority.revisionId,
            });
            if (!valid) {
              throw new ShotgunError({
                code: 'REVISION_CONFLICT',
                safeMessage: 'The active Evidence revision tuple failed integrity validation.',
                module: 'frontend-sources-product',
                operation: 'validate-source-projection-authority',
                retryable: false,
              });
            }
          }),
      );
    }
    return records;
  }

  private async activeRevision(record: SourcesProjectionRecord) {
    const authority = record.activeEvidenceRevision;
    if (
      !authority ||
      authority.sourceId !== record.sourceId ||
      authority.sourceVersionId !== record.sourceVersionId ||
      !authority.revisionId
    ) {
      throw new ShotgunError({
        code: 'REVISION_CONFLICT',
        safeMessage: 'The active Evidence revision authority is unavailable.',
        module: 'frontend-sources-product',
        operation: 'resolve-active-evidence-revision',
      });
    }
    if (this.sources.validateActiveEvidenceRevision) {
      const valid = await this.sources.validateActiveEvidenceRevision({
        projectId: record.projectId,
        sourceId: record.sourceId,
        sourceVersionId: record.sourceVersionId,
        indexingResultId: authority.indexingResultId,
        revisionId: authority.revisionId,
      });
      if (!valid) {
        throw new ShotgunError({
          code: 'REVISION_CONFLICT',
          safeMessage: 'The active Evidence revision tuple failed integrity validation.',
          module: 'frontend-sources-product',
          operation: 'validate-active-evidence-revision',
          retryable: false,
        });
      }
    }
    return authority;
  }

  private async activeEvidence(record: SourcesProjectionRecord): Promise<readonly EvidenceSpan[]> {
    const authority = await this.activeRevision(record);
    if (!this.evidence.listByRevision) {
      throw new ShotgunError({
        code: 'CAPABILITY_DENIED',
        safeMessage: 'Exact active Evidence reads are unavailable in this runtime.',
        module: 'frontend-sources-product',
        operation: 'list-active-evidence',
      });
    }
    return this.evidence.listByRevision(
      record.projectId,
      record.sourceVersionId,
      authority.revisionId,
    );
  }

  async candidatesList(
    scope: ServerAuthorizedProjectSourcesReadScope,
    sourceId: string,
    sourceVersionId: string,
  ): Promise<SourceCandidateListView | null> {
    const record = (await this.authorizedRecords(scope)).find(
      (candidate) =>
        candidate.sourceId === sourceId && candidate.sourceVersionId === sourceVersionId,
    );
    if (!record) return null;
    if (!this.candidates) {
      throw new ShotgunError({
        code: 'CAPABILITY_DENIED',
        safeMessage: 'Source Candidate Product reads are unavailable in this runtime.',
        module: 'frontend-sources-product',
        operation: 'list-source-candidates',
      });
    }
    const authority = await this.activeRevision(record);
    if (!this.candidates.listByRevision) {
      throw new ShotgunError({
        code: 'CAPABILITY_DENIED',
        safeMessage: 'Exact active Candidate reads are unavailable in this runtime.',
        module: 'frontend-sources-product',
        operation: 'list-active-candidates',
      });
    }
    const items = (
      await this.candidates.listByRevision(record.projectId, sourceVersionId, authority.revisionId)
    )
      .filter(
        (candidate) =>
          candidate.sourceVersionId === sourceVersionId && candidateIsAuthorized(candidate, scope),
      )
      .slice(0, 100)
      .map((candidate) => ({
        candidateId: candidate.candidateId,
        revisionNumber: candidate.revisionNumber,
        status: candidate.status,
        claimText: candidate.claimText.slice(0, 20_000),
        sourceVersionId: candidate.sourceVersionId,
        createdAt: candidate.createdAt,
      }));
    return decodeSourceCandidateListView({
      schemaVersion: '1.0.0',
      projectId: record.projectId,
      sourceId,
      sourceVersionId,
      items,
      projectionRevision: candidateProjectionRevision(sourceVersionId, items),
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      fetchedAt: new Date().toISOString(),
    });
  }

  /**
   * Resolves a re-extraction target from the server-authorized Source
   * projection. The browser supplies only the object identity; the internal
   * command receives the SourceVersion's stored security context and never
   * trusts browser Project, Principal, AI, or policy fields.
   */
  async reextractTarget(
    scope: ServerAuthorizedProjectSourcesReadScope,
    sourceId: string,
    sourceVersionId: string,
  ): Promise<SourcesCandidateReextractTarget | null> {
    const record = (await this.authorizedRecords(scope)).find(
      (candidate) =>
        candidate.sourceId === sourceId && candidate.sourceVersionId === sourceVersionId,
    );
    if (!record) return null;

    const usableEvidence = (await this.activeEvidence(record)).filter(
      (item) => item.nodeKind === 'sentence',
    );
    if (usableEvidence.length === 0) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'This Source version has no usable Evidence for AI processing.',
        module: 'frontend-sources-product',
        operation: 'reextract-source-candidates',
      });
    }
    return {
      projectId: record.projectId,
      sourceId: record.sourceId,
      sourceVersionId: record.sourceVersionId,
      revisionId: (await this.activeRevision(record)).revisionId,
      accessScope: [...record.accessScope],
      sensitivity: record.sensitivity,
      dataClassification: 'source-content',
    };
  }

  /**
   * Returns the server-authorized count of unique Source identities.
   * SourceVersion rows are collapsed with the same latestBySource semantics
   * used by the Source Library; no client pagination or browser authority is
   * involved.
   */
  async countUniqueSources(scope: ServerAuthorizedProjectSourcesReadScope): Promise<number> {
    return latestBySource(await this.authorizedRecords(scope)).length;
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
      const askState = askUsageFor(record);
      if (query.filters.askUsageStates && !query.filters.askUsageStates.includes(askState)) {
        return false;
      }
      return query.filters.attentionOnly !== true || askState === 'ACTION_REQUIRED';
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
        previewReadiness:
          record.activeEvidenceRevision || record.imageObservationId ? 'READY' : 'NOT_READY',
        askUsageState: askUsageFor(record),
        askUsageExplanation: askExplanationFor(record),
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
    const lastCheckedAt = latest.externalSourceLastCheckedAt;
    const externalSourceFreshness = lastCheckedAt
      ? (() => {
          const expiresAt = new Date(Date.parse(lastCheckedAt) + EXTERNAL_SOURCE_FRESHNESS_TTL_MS);
          return {
            lastCheckedAt,
            expiresAt: expiresAt.toISOString(),
            state:
              !latest.externalSourceRefreshFailed && this.now().getTime() < expiresAt.getTime()
                ? ('CURRENT' as const)
                : ('EXPIRED' as const),
          };
        })()
      : undefined;
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
      previewReadiness:
        latest.activeEvidenceRevision || latest.imageObservationId ? 'READY' : 'NOT_READY',
      askUsageState: askUsageFor(latest),
      askUsageExplanation: askExplanationFor(latest),
      capabilities: ['PREVIEW', 'DOWNLOAD_ORIGINAL', 'SELECT_FOR_ASK'],
      sourceRevision: projectionRevision(records),
      projectionRevision: projectionRevision(await this.authorizedRecords(scope)),
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      createdAt: [...records].sort((left, right) => left.versionNumber - right.versionNumber)[0]!
        .createdAt,
      updatedAt: latest.createdAt,
      ...(externalSourceFreshness ? { externalSourceFreshness } : {}),
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
    const evidenceAuthorities = new Map<
      string,
      SourcesProjectionRecord['activeEvidenceRevision']
    >();
    await Promise.all(
      records.map(async (record) => {
        const authority = record.activeEvidenceRevision;
        evidenceAuthorities.set(record.sourceVersionId, authority);
        if (authority?.status === 'INDEXED' && this.evidence.listByRevision) {
          evidenceCounts.set(
            record.sourceVersionId,
            (
              await this.evidence.listByRevision(
                record.projectId,
                record.sourceVersionId,
                authority.revisionId,
              )
            ).length,
          );
        } else {
          evidenceCounts.set(record.sourceVersionId, 0);
        }
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
          evidenceAuthorities.get(record.sourceVersionId),
        ),
        evidenceCount: evidenceCounts.get(record.sourceVersionId) ?? 0,
      })),
      projectionRevision: projectionRevision(records),
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      fetchedAt: new Date().toISOString(),
    });
  }

  async originalImage(
    scope: ServerAuthorizedProjectSourcesReadScope,
    sourceId: string,
    sourceVersionId: string,
  ): Promise<{
    readonly bytes: Uint8Array;
    readonly mediaType: 'image/png' | 'image/jpeg';
    readonly contentHash: string;
    readonly width: number;
    readonly height: number;
  } | null> {
    if (!this.imageRead) return null;
    const records = await this.sources.listProjectSourceVersions(scope.authorizedProjectId);
    const record = records.find(
      (item) => item.sourceId === sourceId && item.sourceVersionId === sourceVersionId,
    );
    const latest = latestBySource(records).find((item) => item.sourceId === sourceId);
    if (
      !record ||
      !latest ||
      !assertAuthorized(record, scope) ||
      !assertAuthorized(latest, scope) ||
      !imageMediaType(record)
    )
      return null;
    const stored = await this.storage.read(record.storageKey);
    if (
      !stored ||
      stored.length !== record.sizeBytes ||
      stored.length < 1 ||
      stored.length > 10 * 1024 * 1024
    )
      throw new ShotgunError({
        code: 'REVISION_CONFLICT',
        safeMessage: 'The original image bytes are unavailable.',
        module: 'frontend-sources-product',
        operation: 'read-original-image',
      });
    const bytes = Uint8Array.from(stored);
    const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (contentHash !== record.contentHash)
      throw new ShotgunError({
        code: 'REVISION_CONFLICT',
        safeMessage: 'The original image hash does not match its SourceVersion.',
        module: 'frontend-sources-product',
        operation: 'read-original-image',
      });
    const mediaType = imageMediaType(record)!;
    const decoded = await this.imageRead.imageValidator.preflightImage({
      mediaType,
      contentBase64: Buffer.from(bytes).toString('base64'),
      sourceContentHash: contentHash,
    });
    if (
      decoded.contentHash !== contentHash ||
      !Number.isSafeInteger(decoded.width) ||
      !Number.isSafeInteger(decoded.height) ||
      decoded.width < 1 ||
      decoded.height < 1 ||
      decoded.width > 30000 ||
      decoded.height > 30000 ||
      decoded.pixels !== decoded.width * decoded.height ||
      decoded.pixels > 100000000
    )
      throw new ShotgunError({
        code: 'REVISION_CONFLICT',
        safeMessage: 'The original image decoding identity is invalid.',
        module: 'frontend-sources-product',
        operation: 'read-original-image',
      });
    const readback = await this.sources.listProjectSourceVersions(scope.authorizedProjectId);
    const stillReadable = readback.find(
      (item) => item.sourceId === sourceId && item.sourceVersionId === sourceVersionId,
    );
    const current = latestBySource(readback).find((item) => item.sourceId === sourceId);
    if (
      !stillReadable ||
      !current ||
      !assertAuthorized(stillReadable, scope) ||
      !assertAuthorized(current, scope) ||
      stillReadable.contentHash !== contentHash ||
      stillReadable.mediaType !== mediaType
    )
      return null;
    return { bytes, mediaType, contentHash, width: decoded.width, height: decoded.height };
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
    if (imageMediaType(record)) {
      const original = await this.originalImage(scope, sourceId, sourceVersionId);
      if (!original) return null;
      const observation = await this.imageObservation(record, scope);
      return decodeSourcePreviewView({
        schemaVersion: '1.0.0',
        sourceId,
        sourceVersionId,
        projectId: record.projectId,
        mediaType: record.mediaType,
        contentHash: record.contentHash,
        mode,
        readiness: mode === 'ORIGINAL' || observation ? 'READY' : 'NOT_READY',
        ...(mode === 'ORIGINAL'
          ? {
              image: {
                url: `/product-api/frontend/sources/${encodeURIComponent(sourceId)}/versions/${encodeURIComponent(sourceVersionId)}/image-original`,
                mediaType: original.mediaType,
                contentHash: original.contentHash,
                width: original.width,
                height: original.height,
              },
            }
          : {}),
        ...(observation
          ? {
              generatedObservationReferences: [
                askGeneratedImageObservationReferenceFor(
                  observation,
                  `source-observation-${observation.observationId}`,
                ),
              ],
            }
          : {}),
        locators: [],
        capabilities: ['PREVIEW', 'DOWNLOAD_ORIGINAL'],
        projectionRevision: projectionRevision([record]),
        accessRevision: scope.accessRevision,
        policyContextRevision: scope.policyContextRevision,
        fetchedAt: this.now().toISOString(),
      });
    }
    const evidence =
      mode === 'TRANSFORMED'
        ? await this.activeEvidence(record)
        : record.activeEvidenceRevision && this.evidence.listByRevision
          ? await this.activeEvidence(record)
          : [];
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
    const items = imageMediaType(record) ? [] : await this.activeEvidence(record);
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
