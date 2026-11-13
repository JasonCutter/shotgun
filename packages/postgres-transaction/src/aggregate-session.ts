/** Private write-through state for one caller-owned transaction holding a row lock.
 * Table ownership, loaded-row validation, transition rules and CAS remain with the adapter.
 * This must not outlive the transaction or be shared with another SQL/binder writer.
 */
export function transactionAggregateSession<State>(options: {
  active(): void;
  load(): Promise<{ value: State; digest: string; revision: number }>;
  digest(value: State): string;
  validate(previous: State, next: State, digest: string, previousDigest: string): void;
  persist(previousRevision: number, next: State, digest: string): Promise<number>;
}) {
  let cached: Awaited<ReturnType<typeof options.load>> | undefined;
  let readView: State | undefined;
  let tail: Promise<void> = Promise.resolve();
  const run = <T>(apply: (state: State) => T, readOnly: boolean): Promise<T> => {
    options.active();
    const operation = tail
      .then(async () => {
        options.active();
        cached ??= await options.load();
        options.active();
        if (readOnly) {
          if (readView === undefined) {
            freezePlainJson(cached.value, new WeakSet<object>(), false);
            readView = freezePlainJson(structuredClone(cached.value));
          }
          const result = structuredClone(apply(readView));
          options.active();
          return result;
        }
        readView = undefined;
        const previous = cached,
          draft = structuredClone(previous.value);
        const result = structuredClone(apply(draft));
        const digest = options.digest(draft);
        options.validate(previous.value, draft, digest, previous.digest);
        if (digest !== previous.digest) {
          // Capture before yielding to SQL: callbacks may keep draft references or queue microtasks.
          const snapshot = structuredClone(draft);
          const revision = await options.persist(previous.revision, snapshot, digest);
          options.active();
          cached = { value: snapshot, digest, revision };
        }
        return result;
      })
      .catch((error) => {
        cached = undefined;
        readView = undefined;
        throw error;
      });
    tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };
  return Object.assign(<T>(apply: (state: State) => T) => run(apply, false), {
    read: <T>(apply: (state: State) => T) => run(apply, true),
  });
}

/** Only plain JSON can be safely shared as a frozen view;Map/Date/accessors are rejected. */
function freezePlainJson<T>(value: T, ancestors = new WeakSet<object>(), freeze = true): T {
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('Aggregate read requires finite JSON numbers.');
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return value;
  if (typeof value !== 'object') throw new Error('Aggregate read requires plain JSON.');
  if (ancestors.has(value)) throw new Error('Aggregate read rejects cyclic JSON.');
  ancestors.add(value);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null && proto !== Array.prototype)
    throw new Error('Aggregate read requires plain JSON.');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new Error('Aggregate read rejects symbol properties.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) throw new Error('Aggregate read rejects accessors.');
    freezePlainJson(descriptor.value, ancestors, freeze);
  }
  ancestors.delete(value);
  return freeze ? Object.freeze(value) : value;
}
