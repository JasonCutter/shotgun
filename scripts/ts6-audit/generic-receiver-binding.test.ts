import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  buildImplementationIndex,
  buildReachIndex,
  resolveReachability,
  resolveReceiverType,
} from '../ts6-phase-b-production-reachability.js';

const roots: string[] = [];
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotgun-ts6-generic-'));
  roots.push(root);
  const file = 'adapters/fixture/src/index.ts';
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(
    path.join(root, file),
    `type Output = { value: string };
type RepositoryPort<T> = { claim(): Promise<T>; storeOutput(): Promise<T> };
type ExecutionLedger<T> = RepositoryPort<T> & { readExecution(): Promise<T> };
type Unrelated<T> = { claim(): Promise<T> };
type Container<T> = { value: T; claim(): Promise<T> };
type ContainerView = Container<RepositoryPort<Output>> & { marker: true };
class Store<T> implements RepositoryPort<T> {
  async claim() { await withSafePostgresTransaction(pool, async () => {}); }
  async storeOutput() { await withSafePostgresTransaction(pool, async () => {}); }
}
async function dispatch(ledger: ExecutionLedger<Output>) { await ledger.claim(); }
async function unrelated(other: Unrelated<Output>) { await other.claim(); }
async function container(other: ContainerView) { await other.claim(); }
class Worker<T> {
  constructor(private readonly ledger: Readonly<Pick<RepositoryPort<T>, 'claim' | 'storeOutput'>>) {}
  async run() { await this.ledger.claim(); }
}
`,
  );
  return { root, file, index: buildReachIndex(root) };
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^shotgun-ts6-generic-/u);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('keeps a generic receiver bound to its outer repository type, not its payload', () => {
  const { index } = fixture();
  const caller = index.methods.find((method) => method.name === 'dispatch')!;
  expect(resolveReceiverType(index, caller, 'ledger', 0).typeName).toBe('ExecutionLedger');
  expect(buildImplementationIndex(index).get('RepositoryPort')?.has('Store')).toBe(true);
  expect(buildImplementationIndex(index).get('Output')).toBeUndefined();
  expect(buildImplementationIndex(index).get('T')).toBeUndefined();
});

it('does not qualify same-name calls through an unrelated generic payload or container', () => {
  const { root, file, index } = fixture();
  const verdict = resolveReachability(
    root,
    { boundaryId: 'synthetic:Store.claim', file, symbol: 'Store', method: 'claim' },
    index,
  );
  expect(verdict.callers).toEqual(
    expect.arrayContaining([expect.objectContaining({ receiverType: 'ExecutionLedger' })]),
  );
  expect(verdict.callers.some((caller) => caller.receiver === 'other')).toBe(false);
  expect(index.typeAliasParts.get('ContainerView')).not.toContain('RepositoryPort');
  expect(index.typeAliasParts.get('RepositoryPort')).not.toContain('T');
});

it('unwraps structural views with nested generics and key unions to the actual Port', () => {
  const { index } = fixture();
  const caller = index.methods.find(
    (method) => method.className === 'Worker' && method.name === 'run',
  )!;
  expect(resolveReceiverType(index, caller, 'this.ledger', 0).typeName).toBe('RepositoryPort');
});
