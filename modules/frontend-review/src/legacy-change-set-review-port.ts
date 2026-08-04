/**
 * FE-P4-S1 Stage 5 whole-ChangeSet review compatibility port.
 *
 * The legacy Stage 5 `change-set-review` model is preserved and adapted behind
 * this port. It may supply historic decisions or manifests as a traceable
 * Review Context source reference. It is not the FE-P4-S1 Product contract and
 * is never destructively migrated. New Product decisions never rewrite legacy
 * records.
 */
export type LegacyChangeSetReviewPort = {
  /**
   * Returns a traceable legacy context source for a review resource, or
   * undefined when no eligible legacy manifest exists.
   */
  findLegacyContextSource(input: {
    readonly projectId: string;
    readonly reviewResourceId: string;
  }): Promise<
    | {
        readonly sourceId: string;
        readonly manifestDigest: string;
        readonly decidedAt: string;
      }
    | undefined
  >;
};

export const createNoOpLegacyChangeSetReviewPort = (): LegacyChangeSetReviewPort => ({
  async findLegacyContextSource() {
    return undefined;
  },
});
