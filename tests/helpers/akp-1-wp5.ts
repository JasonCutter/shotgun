import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  validateCorpus,
  withCorpusDigest,
  type GoldenClaim,
  type GoldenCorpus,
  type GoldenCorpusCase,
  type GoldenCorpusManifest,
} from '../../packages/quality-evaluation/src/index.js';
import { sha256Text, stableJson } from '../../packages/contracts/src/document-evidence.js';
import type {
  SemanticCorpusAuthority,
  SemanticProductResourceType,
} from '../../packages/contracts/src/index.js';

export type Akp1SemanticClaim = GoldenClaim & {
  readonly semanticResourceType: SemanticProductResourceType;
  readonly semanticAuthority: SemanticCorpusAuthority;
  readonly semanticResourceRevision: number;
  readonly semanticSourceVersionId: string;
  readonly semanticAccessScope: readonly string[];
  readonly semanticSensitivity: 'public' | 'internal' | 'private' | 'restricted';
};

export type Akp1SemanticManifest = GoldenCorpusManifest & {
  readonly corpusKind: 'SEMANTIC_SEARCH';
};

export type Akp1SemanticCase = Omit<GoldenCorpusCase, 'expectedClaims'> & {
  readonly expectedClaims: readonly Akp1SemanticClaim[];
};

export type Akp1SemanticCorpus = {
  readonly manifest: Akp1SemanticManifest;
  readonly cases: readonly Akp1SemanticCase[];
};

export const computeSemanticFixtureDigest = (corpus: Akp1SemanticCorpus): string => {
  const manifest = Object.fromEntries(
    Object.entries(corpus.manifest).filter(([key]) => key !== 'corpusDigest'),
  );
  return sha256Text(
    stableJson({
      serializationVersion: manifest.contractVersion,
      manifest,
      cases: [...corpus.cases].sort((left, right) => left.caseId.localeCompare(right.caseId)),
    }),
  );
};

const fixturePath = path.resolve('tests', 'fixtures', 'akp-1-semantic-golden-corpus.v1.json');

export const loadAkp1SemanticCorpus = async (): Promise<Akp1SemanticCorpus> => {
  const corpus = JSON.parse(await readFile(fixturePath, 'utf8')) as Akp1SemanticCorpus;
  if (corpus.manifest.corpusDigest !== computeSemanticFixtureDigest(corpus)) {
    throw new Error(
      `Semantic fixture digest mismatch: expected '${computeSemanticFixtureDigest(corpus)}'.`,
    );
  }
  return corpus;
};

/**
 * The semantic fixture carries product resource metadata beside the existing
 * Stage 12 Golden Corpus contract. The evaluator deliberately receives the
 * standard projection, so the established deterministic metrics remain the
 * single quality-evaluation implementation.
 */
export const toQualityCorpus = (corpus: Akp1SemanticCorpus): GoldenCorpus => {
  const manifest = Object.fromEntries(
    Object.entries(corpus.manifest).filter(([key]) => key !== 'corpusKind'),
  ) as GoldenCorpusManifest;
  const standard: GoldenCorpus = {
    manifest,
    cases: corpus.cases.map((entry): GoldenCorpusCase => ({
      ...entry,
      expectedClaims: entry.expectedClaims.map(
        (claim) =>
          Object.fromEntries(
            Object.entries(claim).filter(([key]) => !key.startsWith('semantic')),
          ) as GoldenClaim,
      ),
    })),
  };
  const validated = withCorpusDigest(standard);
  validateCorpus(validated, 'gate');
  return validated;
};

export const semanticClaims = (corpus: Akp1SemanticCorpus): readonly Akp1SemanticClaim[] =>
  corpus.cases.flatMap((entry) => entry.expectedClaims);

export const semanticClaimById = (
  corpus: Akp1SemanticCorpus,
  resourceId: string,
): Akp1SemanticClaim => {
  const claim = semanticClaims(corpus).find((entry) => entry.goldenClaimId === resourceId);
  if (!claim) throw new Error(`Missing semantic fixture resource '${resourceId}'.`);
  return claim;
};

export const semanticQueryById = (corpus: Akp1SemanticCorpus, queryId: string) => {
  const query = corpus.cases
    .flatMap((entry) => entry.queries)
    .find((entry) => entry.queryId === queryId);
  if (!query) throw new Error(`Missing semantic fixture query '${queryId}'.`);
  return query;
};
