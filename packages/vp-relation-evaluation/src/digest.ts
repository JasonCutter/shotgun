import { sha256Text, stableJson } from '../../contracts/src/document-evidence.js';

import type { RelationInput, RelationReference } from './types.js';

export const relationArtifactDigest = (value: unknown): string => sha256Text(stableJson(value));
export const relationInputDigest = (input: RelationInput): string => relationArtifactDigest(input);
export const relationReferenceDigest = (reference: RelationReference): string => {
  const { referenceDigest, assurance, ...subject } = reference;
  void referenceDigest;
  void assurance;
  return relationArtifactDigest(subject);
};
