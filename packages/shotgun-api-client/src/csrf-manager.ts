export type CsrfMutationManager = {
  run<T>(
    acquireToken: () => Promise<string>,
    mutation: (csrfToken: string) => Promise<T>,
  ): Promise<T>;
};

export const createCsrfMutationManager = (): CsrfMutationManager => {
  let tail: Promise<void> = Promise.resolve();

  return {
    async run<T>(
      acquireToken: () => Promise<string>,
      mutation: (csrfToken: string) => Promise<T>,
    ): Promise<T> {
      const preceding = tail;
      let release = (): void => undefined;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await preceding;
      try {
        const csrfToken = await acquireToken();
        return await mutation(csrfToken);
      } finally {
        release();
      }
    },
  };
};
