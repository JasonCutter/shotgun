import { AsyncCleanupStack } from './cleanup-stack.js';

type Stop = () => void | Promise<void>;
type Start = () => Stop | undefined | Promise<Stop | undefined>;
/** First composition step toward one Surfer engine; this does not merge answer semantics. */
export function createSurferEngineHost<
  A,
  K extends { onSourceIndexed(input: unknown): Promise<unknown> },
>(components: { answers: A; knowledge: K; startAnswers: Start; startLearning: Start }) {
  const resources = new AsyncCleanupStack(),
    starts = new Map<'answers' | 'learning', Promise<boolean>>(),
    events = new Set<Promise<unknown>>(),
    startAnswers = components.startAnswers,
    startLearning = components.startLearning,
    answers = components.answers,
    knowledge = components.knowledge;
  let stopping = false,
    failed = false,
    closePromise: Promise<void> | undefined;
  const start = (name: 'answers' | 'learning', factory: Start): Promise<boolean> => {
    if (stopping || failed)
      return Promise.reject(new Error('Surfer engine is not accepting starts.'));
    const existing = starts.get(name);
    if (existing) return existing;
    const pending = Promise.resolve()
      .then(factory)
      .then((stop) => {
        if (stop !== undefined) {
          if (typeof stop !== 'function') throw new Error('Invalid engine component disposer.');
          resources.add('Surfer ' + name, stop);
        }
        if (stopping) throw new Error('Surfer engine stopped during startup.');
        return stop !== undefined;
      })
      .catch((error) => {
        failed = true;
        throw error;
      });
    starts.set(name, pending);
    return pending;
  };
  return {
    // These remain existing module Ports, not separate user-selectable engine authorities.
    answers,
    knowledge,
    startAnswers: () => start('answers', startAnswers),
    startLearning: () => start('learning', startLearning),
    onSourceIndexed: (input: unknown): Promise<unknown> => {
      if (stopping || failed) return Promise.reject(new Error('Surfer engine intake is stopped.'));
      const pending = Promise.resolve().then(() => knowledge.onSourceIndexed(input));
      events.add(pending);
      void pending.then(
        () => events.delete(pending),
        () => events.delete(pending),
      );
      return pending;
    },
    stop: (): Promise<void> => {
      if (!closePromise) {
        stopping = true;
        closePromise = (async () => {
          // Starts already admitted may register a late disposer. Close the stack only afterwards.
          await Promise.allSettled([...starts.values(), ...events]);
          await resources.close();
        })();
      }
      return closePromise;
    },
  };
}
