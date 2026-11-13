import type { SurferArtifactRef } from './surfer-knowledge.js';
import type { SurferDocumentWorkReceipt } from './surfer-document-work.js';
import { assertSurferJson, surferFailure } from './surfer-learning.js';
export type SurferIntakeResume = { jobId: string; expectedRevision: string };
export type SurferIntakeCursor = { jobId: string; createdAt: string };
export type SurferIntakeStatusItem = {
  jobId: string;
  sourceId: string;
  sourceVersionId: string;
  revisionId: string;
  revision: string;
  state: 'READY' | 'RUNNING' | 'COMPLETED' | 'BLOCKED';
  code: 'WORK_UNAVAILABLE' | 'OUTCOME_UNKNOWN' | 'INCOMPLETE' | null;
  updatedAt: string;
  recovery:
    | 'UNAVAILABLE'
    | 'NOT_CONFIGURED'
    | 'CONFIGURATION_MISMATCH'
    | 'SOURCE_CHANGED'
    | 'WAIT_LEASE'
    | 'AVAILABLE';
};
export type SurferIntakeStatusPage = {
  executionConfigured: boolean;
  items: SurferIntakeStatusItem[];
  nextCursor: SurferIntakeCursor | null;
};
export type SurferIntakeResumeResult =
  | { status: 'NOT_CONFIGURED' }
  | { status: 'COMPLETED'; jobId: string }
  | {
      status: 'BLOCKED';
      jobId: string;
      code: 'WORK_UNAVAILABLE' | 'OUTCOME_UNKNOWN' | 'INCOMPLETE';
    };
export const decodeSurferIntakeResume = (input: unknown): SurferIntakeResume => {
  assertSurferJson(input);
  const r = input as SurferIntakeResume;
  if (
    !r ||
    Object.keys(r).sort().join(',') !== 'expectedRevision,jobId' ||
    typeof r.jobId !== 'string' ||
    !/^intake:[a-f0-9]{64}$/.test(r.jobId) ||
    typeof r.expectedRevision !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(r.expectedRevision) ||
    BigInt(r.expectedRevision) > 9223372036854775807n
  )
    throw surferFailure('Expected an exact intake job/revision.');
  return structuredClone(r);
};
export const decodeSurferIntakePage = (input: unknown): { cursor: SurferIntakeCursor | null } => {
  assertSurferJson(input);
  if (
    !input ||
    Array.isArray(input) ||
    typeof input !== 'object' ||
    !['', 'cursor'].includes(Object.keys(input).sort().join(','))
  )
    throw surferFailure('Expected a bounded intake page request.');
  const cursor = (input as { cursor?: SurferIntakeCursor | null }).cursor ?? null;
  if (
    cursor &&
    (Object.keys(cursor).sort().join(',') !== 'createdAt,jobId' ||
      typeof cursor.jobId !== 'string' ||
      !/^intake:[a-f0-9]{64}$/.test(cursor.jobId) ||
      typeof cursor.createdAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(cursor.createdAt) ||
      cursor.createdAt.startsWith('0000-') ||
      !Number.isFinite(Date.parse(cursor.createdAt)) ||
      new Date(cursor.createdAt).toISOString() !== cursor.createdAt.slice(0, -4) + 'Z')
  )
    throw surferFailure('Invalid intake page cursor.');
  if (cursor !== null && (typeof cursor !== 'object' || Array.isArray(cursor)))
    throw surferFailure('Invalid intake page cursor.');
  return { cursor: structuredClone(cursor) };
};
export type SurferIndexedSource = {
  projectId: string;
  sourceId: string;
  sourceVersionId: string;
  revisionId: string;
  evidenceCount: number;
};
export type SurferIntakeIdentity = {
  projectId: string;
  principalId: string;
  runId: string;
  profileDigest: string;
  leaseMs: number;
};
export type SurferIntakeClaim = SurferIndexedSource & {
  jobId: string;
  requestId: string;
  token: string;
  prepared: SurferArtifactRef | null;
};
export interface SurferIntakeInboxPort {
  enqueue(input: unknown): Promise<{ jobId: string | null; replayed: boolean }>;
  claim(
    identity: SurferIntakeIdentity,
    resume?: SurferIntakeResume,
  ): Promise<SurferIntakeClaim | null>;
  prepared(claim: SurferIntakeClaim, ref: SurferArtifactRef): Promise<void>;
  complete(claim: SurferIntakeClaim, receipt: SurferDocumentWorkReceipt): Promise<void>;
  block(
    claim: SurferIntakeClaim,
    code: 'WORK_UNAVAILABLE' | 'OUTCOME_UNKNOWN' | 'INCOMPLETE',
  ): Promise<void>;
}
