import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  SurferDeepSeekContextBound,
  type SurferDeepSeekMetadata,
} from '../../../adapters/ai-provider-deepseek/src/surfer-budget.js';
import { decodeSurferAccountAuthorityConfigV2 } from '../../../packages/contracts/src/surfer-account-authority-v2.js';
import {
  decodeSurferExecutionPolicy,
  SURFER_USAGE_KEYS,
} from '../../../packages/contracts/src/surfer-execution.js';
import {
  SURFER_MEANING_VERIFIER_REVISION_V3,
  SURFER_MEANING_VERIFIER_REVISION_V4,
  SURFER_MEANING_VERIFIER_REVISION_V5,
  SURFER_MEANING_VERIFIER_REVISION_V6,
  SURFER_MEANING_VERIFIER_REVISION_V7,
  SURFER_MEANING_VERIFIER_REVISION_V8,
  SURFER_MEANING_VERIFIER_REVISION_V9,
  SURFER_MEANING_VERIFIER_REVISION_V10,
  SURFER_MEANING_VERIFIER_REVISION_V11,
  SURFER_MEANING_VERIFIER_REVISION_V12,
} from '../../../packages/contracts/src/surfer-meaning-verification.js';
import type { SurferAccountApplicationOptions } from './surfer-account-runtime.js';

const profileFileVariable = 'SHOTGUN_SURFER_MEANING_PROFILE_FILE';
const maxProfileBytes = 65536;

export type SurferMeaningAskSession = {
  projectId: string;
  principalId: string;
  sessionToken: string;
  expiresAt: string;
  questionCreatedAt: string;
};

/** An explicit launcher binding, separate from registration and provider credential storage. */
export async function loadSurferMeaningLaunch(environment: NodeJS.ProcessEnv, clock = Date.now) {
  const file = environment[profileFileVariable];
  if (file === undefined) return undefined;

  const invalid = () => new Error('Invalid fixed Surfer meaning review launch profile.');
  const authorityDatabaseUrl = environment.VP_GLOBAL_RELATION_BUDGET_DATABASE_URL;
  if (!authorityDatabaseUrl?.trim() || !isAbsolute(file)) throw invalid();
  try {
    const handle = await open(file, 'r');
    let input: unknown;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > maxProfileBytes) throw invalid();
      // Read a bounded buffer even if the file grows after the stat.
      const bytes = Buffer.alloc(stat.size + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== stat.size) throw invalid();
      input = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead)),
      );
    } finally {
      await handle.close();
    }
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(',') !==
        'accountConfig,metadata,notBeforeMs,policy,principalId,projectId,runId,schemaVersion'
    )
      throw invalid();
    const { accountConfig, metadata, notBeforeMs, principalId, projectId, runId, schemaVersion } =
      input as Record<string, unknown>;
    const policy = decodeSurferExecutionPolicy((input as Record<string, unknown>).policy);
    const account = decodeSurferAccountAuthorityConfigV2(accountConfig);
    if (
      schemaVersion !== '1.0.0' ||
      typeof projectId !== 'string' ||
      !projectId.trim() ||
      projectId.length > 256 ||
      typeof principalId !== 'string' ||
      !principalId.trim() ||
      principalId.length > 256 ||
      typeof runId !== 'string' ||
      !/^[A-Za-z0-9-]{1,40}$/.test(runId) ||
      typeof notBeforeMs !== 'number' ||
      !Number.isSafeInteger(notBeforeMs) ||
      notBeforeMs < 1 ||
      notBeforeMs >= policy.deadlineAtMs ||
      (account.profile.promptRevision !== SURFER_MEANING_VERIFIER_REVISION_V3 &&
        account.profile.promptRevision !== SURFER_MEANING_VERIFIER_REVISION_V4 &&
        account.profile.promptRevision !== SURFER_MEANING_VERIFIER_REVISION_V5 &&
        account.profile.promptRevision !== SURFER_MEANING_VERIFIER_REVISION_V6 &&
        account.profile.promptRevision !== SURFER_MEANING_VERIFIER_REVISION_V7 &&
        account.profile.promptRevision !== SURFER_MEANING_VERIFIER_REVISION_V8 &&
        account.profile.promptRevision !== SURFER_MEANING_VERIFIER_REVISION_V9 &&
        account.profile.promptRevision !== SURFER_MEANING_VERIFIER_REVISION_V10 &&
        account.profile.promptRevision !== SURFER_MEANING_VERIFIER_REVISION_V11 &&
        account.profile.promptRevision !== SURFER_MEANING_VERIFIER_REVISION_V12) ||
      account.profile.identity.providerId !== 'deepseek' ||
      account.profile.identity.modelId !== 'deepseek-flash'
    )
      throw invalid();
    if (
      !metadata ||
      typeof metadata !== 'object' ||
      Array.isArray(metadata) ||
      Object.keys(metadata).sort().join(',') !==
        'contextWindow,displayName,maxOutputTokens,modelId,observedAtMs,receiptDigest,responseDigest,schemaVersion'
    )
      throw invalid();
    const receipt = metadata as SurferDeepSeekMetadata;
    if (
      receipt.schemaVersion !== '1.0.0' ||
      receipt.observedAtMs > clock() ||
      policy.deadlineAtMs > receipt.observedAtMs + 3600000
    )
      throw invalid();
    const inputBound = new SurferDeepSeekContextBound(receipt, clock);
    if (
      account.profile.inputBoundRevision !== inputBound.revision ||
      account.profile.maximum.inputTokens < receipt.contextWindow ||
      account.profile.maximum.outputTokens !== 4096 ||
      SURFER_USAGE_KEYS.some((key) => account.profile.maximum[key] > policy.backgroundLimits[key])
    )
      throw invalid();

    let active: { sessionToken: string; expiresAtMs: number } | undefined;
    const clear = () => {
      active = undefined;
    };
    const accept = (session: SurferMeaningAskSession) => {
      const now = clock();
      const expiresAtMs = Math.min(Date.parse(session.expiresAt), policy.deadlineAtMs);
      const questionAt = Date.parse(session.questionCreatedAt);
      if (
        session.projectId === projectId &&
        session.principalId === principalId &&
        session.sessionToken.length > 0 &&
        session.sessionToken.length <= 2048 &&
        Number.isFinite(questionAt) &&
        questionAt >= notBeforeMs &&
        Number.isFinite(expiresAtMs) &&
        expiresAtMs > now &&
        now >= notBeforeMs
      )
        active = { sessionToken: session.sessionToken, expiresAtMs };
    };
    const options = {
      projectId,
      runId,
      accountConfig: account,
      policy,
      authorityDatabaseUrl,
      inputBound: {
        revision: inputBound.revision,
        upperBound: (request) => inputBound.upperBound(request),
      },
      intervalMs: 3000,
      maxCyclesPerTick: 1,
      resolveActor: async () => {
        if (active && clock() >= active.expiresAtMs) clear();
        return active ? { projectId, sessionToken: active.sessionToken } : null;
      },
    } satisfies SurferAccountApplicationOptions;
    return { options, notBeforeMs, principalId, accept, clear };
  } catch {
    throw invalid();
  }
}
