/** FE-P4-S1 Review command identity (ADR-101/ADR-118). */
export type ReviewCommandIdentityV1 = {
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly semanticDigest: string;
};
