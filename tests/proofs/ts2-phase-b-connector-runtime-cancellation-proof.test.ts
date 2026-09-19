import { describe, expect, it } from 'vitest';

import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import { createQuery, ShotgunKernel } from '../../packages/kernel/src/index.js';
import type { ShotgunModule } from '../../packages/module-sdk/src/index.js';

const queryModule = (handlers: ShotgunModule['handlers']['queries']): ShotgunModule => ({
  manifest: {
    id: 'ts2.connector-cancellation-proof',
    version: '1.0.0',
    owner: 'TS-2 proof',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'TimeoutQuery', range: '>=1.0.0 <2.0.0' },
        { name: 'ParentQuery', range: '>=1.0.0 <2.0.0' },
        { name: 'ChildQuery', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process'] },
    dataOwnership: { owns: ['ts2-proof-state'], readsViaPorts: [], directSchemaAccess: false },
    consumes: { commands: [], events: [] },
    produces: { events: [], handoffs: [] },
    provides: {
      queries: [
        { name: 'TimeoutQuery', range: '>=1.0.0 <2.0.0' },
        { name: 'ParentQuery', range: '>=1.0.0 <2.0.0' },
        { name: 'ChildQuery', range: '>=1.0.0 <2.0.0' },
      ],
      capabilities: [],
    },
    requires: { capabilities: [] },
    security: {
      requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
      defaultOnMissingContext: 'deny',
    },
    approvalPolicy: { canWriteCanonical: false, canExecuteExternalAction: false },
  },
  contracts: [
    ...(['TimeoutQuery', 'ParentQuery', 'ChildQuery'] as const).map((name) => ({
      name,
      version: '1.0.0',
      kind: 'query' as const,
      inputSchema: { type: 'object', additionalProperties: false },
    })),
  ],
  handlers: { commands: [], events: [], queries: handlers },
});

const rootQuery = (messageType: string) =>
  createQuery({
    messageType,
    schemaVersion: '1.0.0',
    producerModule: 'ts2-proof-client',
    producerVersion: '1.0.0',
    projectId: 'project-ts2',
    actor: { type: 'user', id: 'owner' },
    security: {
      accessScope: ['owner'],
      sensitivity: 'public',
      dataClassification: 'ts2-proof',
    },
    payload: {},
  });

describe('TS-2 Phase B Connector Runtime cancellation proof', () => {
  it('aborts handler execution before the timeout becomes an OUTCOME_UNKNOWN result', async () => {
    let signal!: AbortSignal;
    const kernel = new ShotgunKernel(new InProcessTransport());
    let handlerStarted!: () => void;
    const handlerStartedPromise = new Promise<void>((resolve) => {
      handlerStarted = resolve;
    });
    kernel.register(
      queryModule([
        {
          messageType: 'TimeoutQuery',
          version: '1.0.0',
          timeoutMs: 10,
          async handle(_envelope, context) {
            signal = context.signal;
            handlerStarted();
            await new Promise<void>(() => undefined);
            return { ok: true };
          },
        },
      ]),
    );
    await kernel.start();
    const request = kernel.connector.query(rootQuery('TimeoutQuery'));
    await handlerStartedPromise;
    await expect(request).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(signal.aborted).toBe(true);
  });

  it('propagates parent cancellation through HandlerContext.query to the child signal', async () => {
    let childSignal!: AbortSignal;
    let childStarted!: () => void;
    const childStartedPromise = new Promise<void>((resolve) => {
      childStarted = resolve;
    });
    const controller = new AbortController();
    const kernel = new ShotgunKernel(new InProcessTransport());
    kernel.register(
      queryModule([
        {
          messageType: 'ParentQuery',
          version: '1.0.0',
          async handle(_envelope, context) {
            return context.query<Record<string, never>, { readonly ok: boolean }>({
              messageType: 'ChildQuery',
              schemaVersion: '1.0.0',
              payload: {},
            });
          },
        },
        {
          messageType: 'ChildQuery',
          version: '1.0.0',
          async handle(_envelope, context) {
            childSignal = context.signal;
            childStarted();
            await new Promise<void>(() => undefined);
            return { ok: true };
          },
        },
      ]),
    );
    await kernel.start();
    const request = kernel.connector.query(rootQuery('ParentQuery'), { signal: controller.signal });
    await childStartedPromise;
    controller.abort('test-parent-cancel');
    await expect(request).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(childSignal.aborted).toBe(true);
  });

  it('fences a delayed child query after parent cancellation before child execution', async () => {
    let releaseParent!: () => void;
    let parentStarted!: () => void;
    let childCalls = 0;
    let lateAttemptFinished!: () => void;
    const parentStartedPromise = new Promise<void>((resolve) => {
      parentStarted = resolve;
    });
    const lateAttemptFinishedPromise = new Promise<void>((resolve) => {
      lateAttemptFinished = resolve;
    });
    const controller = new AbortController();
    const kernel = new ShotgunKernel(new InProcessTransport());
    kernel.register(
      queryModule([
        {
          messageType: 'ParentQuery',
          version: '1.0.0',
          async handle(_envelope, context) {
            parentStarted();
            await new Promise<void>((resolve) => {
              releaseParent = resolve;
            });
            try {
              await context.query<Record<string, never>, { readonly ok: boolean }>({
                messageType: 'ChildQuery',
                schemaVersion: '1.0.0',
                payload: {},
              });
            } catch {
              lateAttemptFinished();
              throw new Error('delayed child query was fenced');
            }
            throw new Error('delayed child query unexpectedly executed');
          },
        },
        {
          messageType: 'ChildQuery',
          version: '1.0.0',
          async handle() {
            childCalls += 1;
            return { ok: true };
          },
        },
      ]),
    );
    await kernel.start();
    const request = kernel.connector.query(rootQuery('ParentQuery'), { signal: controller.signal });
    await parentStartedPromise;
    controller.abort('delayed-parent-cancel');
    await expect(request).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    releaseParent();
    await lateAttemptFinishedPromise;
    expect(childCalls).toBe(0);
  });
});
