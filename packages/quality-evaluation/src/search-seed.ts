import type { SearchProjectionDocument } from '../../contracts/src/cited-search.js';
import { sha256Text, stableJson } from '../../contracts/src/document-evidence.js';

import type { GoldenCorpus } from './types.js';

const deterministicUuid = (value: string): string => {
  const hex = sha256Text(value).slice('sha256:'.length);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

export type SearchSeedEntry = {
  readonly goldenClaimId: string;
  readonly document: SearchProjectionDocument;
};

export type SearchBaselineSeed = {
  readonly projectId: string;
  readonly canonicalVersion: number;
  readonly snapshotDigest: string;
  readonly entries: readonly SearchSeedEntry[];
};

export const createSearchBaselineSeed = (
  corpus: GoldenCorpus,
  projectId: string,
): SearchBaselineSeed => {
  const entries = corpus.cases
    .flatMap((entry) =>
      entry.expectedClaims.map((claim): SearchSeedEntry => ({
        goldenClaimId: claim.goldenClaimId,
        document: {
          projectId,
          claimId: `quality:${claim.goldenClaimId}`,
          commitId: deterministicUuid(
            `commit:${corpus.manifest.corpusDigest}:${claim.goldenClaimId}`,
          ),
          revisionId: `revision:quality:${claim.goldenClaimId}`,
          canonicalVersion: corpus.cases.flatMap((item) => item.expectedClaims).length,
          claimText: claim.claimText,
          sourceVersionId: deterministicUuid(
            `source-version:${corpus.manifest.corpusDigest}:${entry.caseId}`,
          ),
          evidenceIds: [`evidence:quality:${claim.goldenClaimId}`],
          accessScope: entry.projectContext.accessScopes,
          sensitivity: entry.sensitivity,
          projectedAt: corpus.manifest.updatedAt,
        },
      })),
    )
    .sort((left, right) => left.goldenClaimId.localeCompare(right.goldenClaimId));
  return {
    projectId,
    canonicalVersion: entries.length,
    snapshotDigest: sha256Text(stableJson(entries)),
    entries,
  };
};
