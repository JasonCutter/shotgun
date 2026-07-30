import { createHash, randomUUID } from 'node:crypto';

import { ShotgunError } from '../../../packages/contracts/src/index.js';
import type {
  IntakeRepositoryPort,
  IntakeSubmission,
  SavedIntakeSubmission,
} from '../../../modules/intake/src/index.js';
import type {
  AssetStoragePort,
  OriginalAssetRepositoryPort,
  SourceVersionSecurityRecord,
  StoredIntakeResult,
  StoreOriginalAssetInput,
} from '../../../modules/original-asset/src/index.js';
import type {
  SourcesProjectionRecord,
  SourcesProjectionRepositoryPort,
} from '../../../modules/frontend-sources-product/src/index.js';

const keyFor = (projectId: string, submissionId: string) => `${projectId}:${submissionId}`;

const comparableSubmission = (submission: IntakeSubmission) => ({
  ...submission,
  accessScope: [...submission.accessScope].sort(),
  createdAt: undefined,
});

const sameSubmission = (left: IntakeSubmission, right: IntakeSubmission): boolean =>
  JSON.stringify(comparableSubmission(left)) === JSON.stringify(comparableSubmission(right));

export class InMemoryIntakeRepository implements IntakeRepositoryPort {
  private readonly submissions = new Map<string, IntakeSubmission>();

  async save(submission: IntakeSubmission): Promise<SavedIntakeSubmission> {
    const key = keyFor(submission.projectId, submission.submissionId);
    const existing = this.submissions.get(key);
    if (existing) {
      if (!sameSubmission(existing, submission)) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: `Submission '${submission.submissionId}' was already used for different input.`,
          module: 'stage2-in-memory',
          operation: 'save-intake-submission',
        });
      }
      return {
        submission: existing,
        duplicateSubmission: true,
      };
    }
    this.submissions.set(key, submission);
    return {
      submission,
      duplicateSubmission: false,
    };
  }

  list(): readonly IntakeSubmission[] {
    return [...this.submissions.values()];
  }
}

type AssetRecord = {
  readonly assetId: string;
  readonly contentHash: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
};

type SourceRecord = {
  readonly sourceId: string;
  readonly projectId: string;
};

type VersionRecord = {
  readonly sourceVersionId: string;
  readonly sourceId: string;
  readonly versionNumber: number;
  readonly asset: AssetRecord;
  readonly accessScope: readonly string[];
  readonly sensitivity: StoreOriginalAssetInput['sensitivity'];
  readonly originalFileName?: string;
  readonly createdAt: string;
};

export class InMemoryOriginalAssetRepository
  implements OriginalAssetRepositoryPort, SourcesProjectionRepositoryPort
{
  private readonly assetsByHash = new Map<string, AssetRecord>();
  private readonly sources = new Map<string, SourceRecord>();
  private readonly versionsBySource = new Map<string, VersionRecord[]>();
  private readonly receipts = new Map<string, StoredIntakeResult>();

  async assertSource(projectId: string, sourceId: string): Promise<void> {
    const source = this.sources.get(sourceId);
    if (!source || source.projectId !== projectId) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: `Source '${sourceId}' was not found in this project.`,
        module: 'stage2-in-memory',
        operation: 'assert-source',
      });
    }
  }

  async store(input: StoreOriginalAssetInput): Promise<StoredIntakeResult> {
    const receiptKey = keyFor(input.projectId, input.submissionId);
    const receipt = this.receipts.get(receiptKey);
    if (receipt) {
      return receipt;
    }

    const existingAsset = this.assetsByHash.get(input.contentHash);
    const asset: AssetRecord =
      existingAsset ??
      ({
        assetId: randomUUID(),
        contentHash: input.contentHash,
        mediaType: input.mediaType,
        sizeBytes: input.sizeBytes,
        storageKey: input.storageKey,
      } satisfies AssetRecord);
    this.assetsByHash.set(asset.contentHash, asset);

    let source: SourceRecord;
    if (input.requestedSourceId) {
      const existingSource = this.sources.get(input.requestedSourceId);
      if (!existingSource || existingSource.projectId !== input.projectId) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: `Source '${input.requestedSourceId}' was not found in this project.`,
          module: 'stage2-in-memory',
          operation: 'store-original-asset',
        });
      }
      source = existingSource;
    } else {
      source = {
        sourceId: randomUUID(),
        projectId: input.projectId,
      };
      this.sources.set(source.sourceId, source);
    }

    const versions = this.versionsBySource.get(source.sourceId) ?? [];
    const existingVersion = versions.find(
      (version) => version.asset.contentHash === input.contentHash,
    );
    const version: VersionRecord =
      existingVersion ??
      ({
        sourceVersionId: randomUUID(),
        sourceId: source.sourceId,
        versionNumber: versions.length + 1,
        asset,
        accessScope: [...input.accessScope],
        sensitivity: input.sensitivity,
        originalFileName: input.originalFileName,
        createdAt: input.createdAt,
      } satisfies VersionRecord);
    if (!existingVersion) {
      versions.push(version);
      this.versionsBySource.set(source.sourceId, versions);
    }

    const result: StoredIntakeResult = {
      submissionId: input.submissionId,
      projectId: input.projectId,
      sourceId: source.sourceId,
      sourceVersionId: version.sourceVersionId,
      versionNumber: version.versionNumber,
      channel: input.channel,
      materialKind: input.materialKind,
      originalFileName: input.originalFileName,
      assetReference: {
        assetId: version.asset.assetId,
        versionId: version.sourceVersionId,
        mediaType: version.asset.mediaType,
        contentHash: version.asset.contentHash,
        sizeBytes: version.asset.sizeBytes,
        storageUri: `asset://${version.asset.assetId}/versions/${version.sourceVersionId}`,
        accessScope: [...version.accessScope],
      },
      storageKey: version.asset.storageKey,
      sensitivity: version.sensitivity,
      assetReused: existingAsset !== undefined,
      versionCreated: existingVersion === undefined,
    };
    this.receipts.set(receiptKey, result);
    return result;
  }

  async findBySubmission(
    projectId: string,
    submissionId: string,
  ): Promise<StoredIntakeResult | undefined> {
    return this.receipts.get(keyFor(projectId, submissionId));
  }

  async findByVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<StoredIntakeResult | undefined> {
    return [...this.receipts.values()].find(
      (receipt) => receipt.projectId === projectId && receipt.sourceVersionId === sourceVersionId,
    );
  }

  async findSourceVersionSecurity(
    projectId: string,
    sourceVersionId: string,
  ): Promise<SourceVersionSecurityRecord | undefined> {
    for (const source of this.sources.values()) {
      if (source.projectId !== projectId) continue;
      const version = (this.versionsBySource.get(source.sourceId) ?? []).find(
        (item) => item.sourceVersionId === sourceVersionId,
      );
      if (version) {
        return {
          projectId,
          sourceId: version.sourceId,
          sourceVersionId: version.sourceVersionId,
          originalAssetId: version.asset.assetId,
          contentHash: version.asset.contentHash,
          accessScope: version.accessScope,
          sensitivity: version.sensitivity,
        };
      }
    }
    return undefined;
  }

  async listProjectSourceVersions(projectId: string): Promise<readonly SourcesProjectionRecord[]> {
    return [...this.sources.values()]
      .filter((source) => source.projectId === projectId)
      .flatMap((source) =>
        (this.versionsBySource.get(source.sourceId) ?? []).map((version) => ({
          projectId,
          sourceId: source.sourceId,
          sourceVersionId: version.sourceVersionId,
          versionNumber: version.versionNumber,
          mediaType: version.asset.mediaType,
          contentHash: version.asset.contentHash,
          sizeBytes: version.asset.sizeBytes,
          ...(version.originalFileName === undefined
            ? {}
            : { originalFileName: version.originalFileName }),
          storageKey: version.asset.storageKey,
          accessScope: version.accessScope,
          sensitivity: version.sensitivity,
          createdAt: version.createdAt,
        })),
      );
  }

  counts() {
    return {
      assets: this.assetsByHash.size,
      sources: this.sources.size,
      versions: [...this.versionsBySource.values()].reduce(
        (total, versions) => total + versions.length,
        0,
      ),
      receipts: this.receipts.size,
    };
  }
}

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export class InMemoryAssetStorage implements AssetStoragePort {
  private readonly objects = new Map<string, Uint8Array>();

  async put(contentHash: string, bytes: Uint8Array): Promise<string> {
    if (sha256(bytes) !== contentHash) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Asset bytes do not match their content hash.',
        module: 'stage2-in-memory',
        operation: 'put-asset',
      });
    }
    const storageKey = `original/sha256/${contentHash.slice('sha256:'.length)}`;
    const existing = this.objects.get(storageKey);
    if (existing && sha256(existing) !== contentHash) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'Content-addressed storage key already contains different bytes.',
        module: 'stage2-in-memory',
        operation: 'put-asset',
      });
    }
    if (!existing) {
      this.objects.set(storageKey, Uint8Array.from(bytes));
    }
    return storageKey;
  }

  async read(storageKey: string): Promise<Uint8Array> {
    const bytes = this.objects.get(storageKey);
    if (!bytes) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'Original Asset bytes were not found.',
        module: 'stage2-in-memory',
        operation: 'read-asset',
      });
    }
    return Uint8Array.from(bytes);
  }

  corrupt(storageKey: string, bytes: Uint8Array): void {
    this.objects.set(storageKey, Uint8Array.from(bytes));
  }
}
