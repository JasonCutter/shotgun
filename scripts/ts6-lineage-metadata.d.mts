export type LineageMetadataInput = {
  readonly parentArtifact: string;
  readonly parentContent: string;
  readonly baseCommit: string;
  readonly authorityVersion: string;
};

export type LineageMetadata = {
  readonly parentArtifact: string;
  readonly parentSha256: string;
  readonly baseCommit: string;
  readonly authorityVersion: string;
};

export function makeLineageMetadata(input: LineageMetadataInput): LineageMetadata;
