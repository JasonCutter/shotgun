import { createHash } from 'node:crypto';

import type {
  AskExecutionScope,
  AskSourceVersionContextReaderPort,
} from '../../../modules/frontend-ask-execution/src/index.js';
import type {
  AssetStoragePort,
  OriginalAssetRepositoryPort,
} from '../../../modules/original-asset/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/index.js';

const MAX_DIRECT_TEXT_BYTES = 1_048_576;

const sensitivityRank = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
} as const;

const failure = (
  code: ConstructorParameters<typeof ShotgunError>[0]['code'],
  message: string,
  operation: string,
): ShotgunError =>
  new ShotgunError({
    code,
    safeMessage: message,
    module: 'frontend-ask-source-context-original-asset',
    operation,
  });

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const assertAuthorized = (
  requiredScopes: readonly string[],
  sensitivity: AskExecutionScope['sensitivityClearance'],
  scope: AskExecutionScope,
): void => {
  const actualScopes = new Set(scope.accessScope ?? []);
  if (requiredScopes.some((required) => !actualScopes.has(required))) {
    throw failure(
      'POLICY_DENIED',
      'The AnswerRun cannot access the pinned SourceVersion.',
      'authorize-source-version-scope',
    );
  }
  if (sensitivityRank[sensitivity] > sensitivityRank[scope.sensitivityClearance]) {
    throw failure(
      'POLICY_DENIED',
      'The pinned SourceVersion exceeds the AnswerRun sensitivity clearance.',
      'authorize-source-version-sensitivity',
    );
  }
};

export class OriginalAssetAskSourceVersionContextReader implements AskSourceVersionContextReaderPort {
  constructor(
    private readonly repository: OriginalAssetRepositoryPort,
    private readonly storage: AssetStoragePort,
  ) {}

  async resolve(input: {
    readonly scope: AskExecutionScope;
    readonly sourceId: string;
    readonly sourceVersionId: string;
  }) {
    const stored = await this.repository.findByVersion(
      input.scope.projectId,
      input.sourceVersionId,
    );
    if (
      !stored ||
      stored.projectId !== input.scope.projectId ||
      stored.sourceId !== input.sourceId ||
      stored.sourceVersionId !== input.sourceVersionId
    ) {
      throw failure(
        'NOT_FOUND',
        'The pinned SourceVersion was not found in the AnswerRun Resource Project.',
        'resolve-pinned-source-version',
      );
    }

    assertAuthorized(stored.assetReference.accessScope, stored.sensitivity, input.scope);

    if (stored.channel !== 'direct_text' || stored.assetReference.mediaType !== 'text/plain') {
      return undefined;
    }
    if (
      stored.assetReference.sizeBytes <= 0 ||
      stored.assetReference.sizeBytes > MAX_DIRECT_TEXT_BYTES
    ) {
      throw failure(
        'VALIDATION_ERROR',
        'The pinned Direct Text SourceVersion is outside the supported context size.',
        'validate-source-version-size',
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = await this.storage.read(stored.storageKey);
    } catch {
      throw failure(
        'STALE_VERSION',
        'The pinned SourceVersion original representation is unavailable.',
        'read-source-version-original',
      );
    }
    if (
      bytes.byteLength !== stored.assetReference.sizeBytes ||
      sha256(bytes) !== stored.assetReference.contentHash
    ) {
      throw failure(
        'STALE_VERSION',
        'The pinned SourceVersion original representation failed immutable verification.',
        'verify-source-version-original',
      );
    }

    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw failure(
        'VALIDATION_ERROR',
        'The pinned Direct Text SourceVersion is not valid UTF-8.',
        'decode-source-version-original',
      );
    }

    return {
      kind: 'SOURCE_VERSION' as const,
      sourceId: stored.sourceId,
      sourceVersionId: stored.sourceVersionId,
      contentHash: stored.assetReference.contentHash,
      mediaType: 'text/plain' as const,
      text,
      sensitivity: stored.sensitivity,
    };
  }
}
