import type {
  SurferMeaningVerificationWork,
  SurferMeaningVerificationResult,
} from './surfer-meaning-verification.js';
import {
  decodeSurferObservationSelections,
  type SurferObservationSelection,
} from './surfer-cognition.js';
import { assertSurferJson, surferDigest, surferFailure } from './surfer-learning.js';
export type SurferMeaningQueueInput = {
  reference: { attemptId: string; candidateIndex: number };
  selections: SurferObservationSelection[];
};
export type SurferMeaningQueueIdentity = {
  projectId: string;
  principalId: string;
  runId: string;
  profileDigest: string;
  leaseMs: number;
};
export type SurferMeaningQueueClaim = {
  jobId: string;
  revision: string;
  token: string;
  work: SurferMeaningVerificationWork;
};
export type SurferMeaningQueueCode = 'WORK_UNAVAILABLE' | 'OUTCOME_UNKNOWN' | 'INCOMPLETE';
export type SurferMeaningQueueMetadata = {
  jobId: string;
  revision: string;
  state: 'READY' | 'RUNNING' | 'COMPLETED' | 'BLOCKED';
  code: SurferMeaningQueueCode | null;
};
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
export function decodeSurferMeaningQueueInput(value: unknown): SurferMeaningQueueInput {
  assertSurferJson(value);
  const r = value as SurferMeaningQueueInput;
  if (
    !r ||
    Object.keys(r).sort().join(',') !== 'reference,selections' ||
    !r.reference ||
    Object.keys(r.reference).sort().join(',') !== 'attemptId,candidateIndex' ||
    !text(r.reference.attemptId) ||
    !Number.isSafeInteger(r.reference.candidateIndex) ||
    r.reference.candidateIndex < 0 ||
    r.reference.candidateIndex > 7
  )
    throw surferFailure('Invalid meaning queue request.');
  const s = decodeSurferObservationSelections({ schemaVersion: '1.0.0', selections: r.selections });
  if (
    s.selections.length < 2 ||
    s.selections.length > 8 ||
    new Set(s.selections.map((x) => x.sourceId)).size < 2
  )
    throw surferFailure('Meaning queue requires separate Source passages.');
  return structuredClone(r);
}
export function assertSurferMeaningQueueIdentity(
  value: unknown,
): asserts value is SurferMeaningQueueIdentity {
  assertSurferJson(value);
  const i = value as SurferMeaningQueueIdentity;
  if (
    !i ||
    Object.keys(i).sort().join(',') !== 'leaseMs,principalId,profileDigest,projectId,runId' ||
    !text(i.projectId) ||
    !text(i.principalId) ||
    !text(i.runId) ||
    !/^[A-Za-z0-9-]{1,40}$/.test(i.runId) ||
    !/^sha256:[a-f0-9]{64}$/.test(i.profileDigest) ||
    !Number.isSafeInteger(i.leaseMs) ||
    i.leaseMs < 1000 ||
    i.leaseMs > 172800000
  )
    throw surferFailure('Invalid fixed meaning queue identity.');
}
export function surferMeaningQueueKey(
  identity: SurferMeaningQueueIdentity,
  input: SurferMeaningQueueInput,
) {
  assertSurferMeaningQueueIdentity(identity);
  const request = decodeSurferMeaningQueueInput(input),
    { leaseMs: _, ...pin } = identity;
  const digest = surferDigest({ ...pin, ...request });
  return { jobId: 'meaning:' + digest.slice(7), requestDigest: digest };
}
export interface SurferMeaningQueuePort {
  inspect(
    identity: SurferMeaningQueueIdentity,
    input: SurferMeaningQueueInput,
  ): Promise<SurferMeaningQueueMetadata | null>;
  enqueue(
    identity: SurferMeaningQueueIdentity,
    work: SurferMeaningVerificationWork,
  ): Promise<SurferMeaningQueueMetadata & { replayed: boolean }>;
  claim(identity: SurferMeaningQueueIdentity): Promise<SurferMeaningQueueClaim | null>;
  complete(claim: SurferMeaningQueueClaim, result: SurferMeaningVerificationResult): Promise<void>;
  block(claim: SurferMeaningQueueClaim, code: SurferMeaningQueueCode): Promise<void>;
}
