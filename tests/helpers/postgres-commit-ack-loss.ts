import type { Pool } from 'pg';
import { expect } from 'vitest';

import { ShotgunError } from '../../packages/contracts/src/index.js';

export const POST_COMMIT_ACK_LOSS = 'DETERMINISTIC_POST_COMMIT_ACK_LOSS_FAULT_INJECTION';

export type CommitAckLossTrace = {
  readonly commands: string[];
  commitAttempts: number;
  rollbackAttempts: number;
  commitAttempted: boolean;
  acknowledgementLost: boolean;
  rollbackAfterCommit: number;
};

const commandOf = (query: unknown): string => {
  if (typeof query === 'string') return query.trim().toUpperCase();
  if (query && typeof query === 'object' && 'text' in query) {
    return String(query.text).trim().toUpperCase();
  }
  return '';
};

/**
 * Test-only deterministic fault: PostgreSQL has accepted COMMIT, then the
 * client observes a synthetic acknowledgement failure. It is not a TCP
 * partition simulation and must never be imported by Product code.
 */
export const createPostCommitAckLossPool = (
  pool: Pool,
): {
  readonly pool: Pool;
  readonly trace: CommitAckLossTrace;
} => {
  const trace: CommitAckLossTrace = {
    commands: [],
    commitAttempts: 0,
    rollbackAttempts: 0,
    commitAttempted: false,
    acknowledgementLost: false,
    rollbackAfterCommit: 0,
  };
  const originalConnect = pool.connect.bind(pool);
  const injectedPool = {
    query: pool.query.bind(pool),
    connect: async () => {
      const client = await originalConnect();
      const originalQuery = client.query.bind(client);
      const originalRelease = client.release.bind(client);
      const injectedQuery = async (query: unknown, values?: unknown[]) => {
        const command = commandOf(query);
        trace.commands.push(command);
        if (command === 'COMMIT') {
          trace.commitAttempts += 1;
          trace.commitAttempted = true;
          if (values === undefined) await originalQuery(query as never);
          else await originalQuery(query as never, values as never);
          trace.acknowledgementLost = true;
          throw new Error(POST_COMMIT_ACK_LOSS);
        }
        if (command === 'ROLLBACK') {
          trace.rollbackAttempts += 1;
          if (trace.commitAttempted) trace.rollbackAfterCommit += 1;
        }
        if (values === undefined) return originalQuery(query as never);
        return originalQuery(query as never, values as never);
      };
      client.query = injectedQuery as typeof client.query;
      client.release = ((error?: Error) => {
        client.query = originalQuery as typeof client.query;
        originalRelease(error);
      }) as typeof client.release;
      return client;
    },
  } as Pool;
  return { pool: injectedPool, trace };
};

/**
 * Test-only assertion proving that an operation surfaces structured OUTCOME_UNKNOWN
 * when a post-COMMIT acknowledgement is lost, preserving the underlying fault as cause.
 */
export const expectCommitAckLossOutcomeUnknown = async (
  operation: Promise<unknown> | (() => Promise<unknown>),
  expectedCauseMessage = 'synthetic commit acknowledgement loss',
): Promise<ShotgunError> => {
  let thrown: unknown;
  try {
    if (typeof operation === 'function') {
      await operation();
    } else {
      await operation;
    }
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ShotgunError);
  const error = thrown as ShotgunError;
  expect(error).toMatchObject({
    code: 'OUTCOME_UNKNOWN',
  });
  expect(error.safeMessage).toMatch(
    /The PostgreSQL transaction outcome could not be resolved after COMMIT was attempted/i,
  );
  expect((error.cause as { message?: string } | undefined)?.message).toContain(
    expectedCauseMessage,
  );
  return error;
};
