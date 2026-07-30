import type {
  SourcesStagingInputKind,
  SourcesStagingReceipt,
} from '../../../packages/contracts/src/index.js';

export type ResolvedSourcesStagingArtifact = {
  readonly draftId: string;
  readonly itemId: string;
  readonly projectId: string;
  readonly principalId: string;
  readonly kind: 'DIRECT_TEXT' | 'FILE' | 'URL';
  readonly label: string;
  readonly channel: 'direct_text' | 'file_upload' | 'url_acquisition';
  readonly mediaType: 'text/plain' | 'text/markdown';
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly stagingReference?: string;
  readonly fileName?: string;
  readonly redactedRequestedUrl?: string;
  readonly urlProvenance?: {
    readonly normalizedRequestedUrl: string;
    readonly redactedRequestedUrl: string;
    readonly redactedFinalUrl: string;
    readonly redirectChainDigest: string;
    readonly redirectObservations: readonly Readonly<Record<string, unknown>>[];
    readonly dnsObservations: readonly Readonly<Record<string, unknown>>[];
    readonly responseStatus: number;
    readonly responseContentType: 'text/plain' | 'text/markdown';
    readonly responseContentLength?: number;
    readonly compressedBytes: number;
    readonly decompressedBytes: number;
    readonly responseMetadata: Readonly<Record<string, unknown>>;
    readonly retentionClass: string;
    readonly retentionExpiresAt?: string;
    readonly retrievedAt: string;
    readonly limits: {
      readonly maxRedirects: number;
      readonly connectTimeoutMs: number;
      readonly headerTimeoutMs: number;
      readonly bodyTimeoutMs: number;
      readonly totalTimeoutMs: number;
      readonly maxCompressedBytes: number;
      readonly maxDecompressedBytes: number;
    };
  };
  readonly issuedAt: string;
  readonly expiresAt: string;
};

export type SourcesStagingServicePort = {
  stageBytes(input: {
    readonly draftId: string;
    readonly itemId: string;
    readonly projectId: string;
    readonly principalId: string;
    readonly kind: 'DIRECT_TEXT' | 'FILE';
    readonly label: string;
    readonly mediaType: 'text/plain' | 'text/markdown';
    readonly fileName?: string;
    readonly bytes: Uint8Array;
  }): Promise<SourcesStagingReceipt>;
  stageUrl(input: {
    readonly draftId: string;
    readonly itemId: string;
    readonly projectId: string;
    readonly principalId: string;
    readonly label: string;
    readonly requestedUrl: string;
  }): Promise<SourcesStagingReceipt>;
  resolve(input: {
    readonly stagingReference: string;
    readonly draftId: string;
    readonly itemId: string;
    readonly projectId: string;
    readonly principalId: string;
    readonly kind: SourcesStagingInputKind;
  }): Promise<ResolvedSourcesStagingArtifact>;
};
