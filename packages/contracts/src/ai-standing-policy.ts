/**
 * Durable Project authority for automatic AI-assisted processing.
 *
 * This is deliberately separate from provider credentials/configuration and
 * from the deployment/operator ceiling. It contains no credential material.
 */
export type AIStandingProcessingPolicy = {
  readonly projectId: string;
  readonly enabled: boolean;
  readonly providerId: string;
  readonly policyRevision: number;
  readonly aiConfigurationRevision: number;
  readonly changedBy: string;
  readonly changedAt: string;
};
