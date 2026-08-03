import type { FrontendKnowledgeDraftBaseV1 } from '../../../packages/contracts/src/index.js';
import type {
  FrontendKnowledgeDraftCommandScopeV1,
  FrontendKnowledgeDraftTargetResolutionV1,
  FrontendKnowledgeDraftTargetResolverPort,
} from '../../../modules/frontend-knowledge-draft/src/product-api.js';

export type InMemoryDraftTargetEntryV1 = {
  readonly resourceId: string;
  readonly resourceProjectId: string;
  readonly draftProjectId: string;
  readonly effectiveProjectId: string;
  readonly base: FrontendKnowledgeDraftBaseV1;
};

/**
 * In-memory server-side Draft target resolution. Tests register Seeds,
 * Resources and Pages; the resolver derives the Project binding and pins the
 * Canonical base while re-binding the server access/policy revisions so the
 * pinned base is always consistent with the accepted command scope.
 */
export class InMemoryFrontendKnowledgeDraftTargetResolver implements FrontendKnowledgeDraftTargetResolverPort {
  private readonly seeds = new Map<string, InMemoryDraftTargetEntryV1>();
  private readonly resources = new Map<string, InMemoryDraftTargetEntryV1>();
  private readonly pages = new Map<string, InMemoryDraftTargetEntryV1>();

  registerSeed(seedId: string, entry: InMemoryDraftTargetEntryV1): void {
    this.seeds.set(seedId, entry);
  }

  registerResource(resourceId: string, entry: InMemoryDraftTargetEntryV1): void {
    this.resources.set(resourceId, entry);
  }

  registerPage(pageId: string, entry: InMemoryDraftTargetEntryV1): void {
    this.pages.set(pageId, entry);
  }

  async resolveSeed(input: {
    readonly seedId: string;
    readonly scope: FrontendKnowledgeDraftCommandScopeV1;
  }): Promise<FrontendKnowledgeDraftTargetResolutionV1 | undefined> {
    const entry = this.seeds.get(input.seedId);
    if (!entry) return undefined;
    return this.resolution(
      entry,
      { kind: 'SEED', seedId: input.seedId, resourceId: entry.resourceId },
      input.scope,
    );
  }

  async resolveResource(input: {
    readonly resourceId: string;
    readonly scope: FrontendKnowledgeDraftCommandScopeV1;
  }): Promise<FrontendKnowledgeDraftTargetResolutionV1 | undefined> {
    const entry = this.resources.get(input.resourceId);
    if (!entry) return undefined;
    return this.resolution(entry, { kind: 'RESOURCE', resourceId: input.resourceId }, input.scope);
  }

  async resolvePage(input: {
    readonly pageId: string;
    readonly scope: FrontendKnowledgeDraftCommandScopeV1;
  }): Promise<FrontendKnowledgeDraftTargetResolutionV1 | undefined> {
    const entry = this.pages.get(input.pageId);
    if (!entry) return undefined;
    return this.resolution(
      entry,
      { kind: 'PAGE', pageId: input.pageId, resourceId: entry.resourceId },
      input.scope,
    );
  }

  private resolution(
    entry: InMemoryDraftTargetEntryV1,
    target: FrontendKnowledgeDraftTargetResolutionV1['target'],
    scope: FrontendKnowledgeDraftCommandScopeV1,
  ): FrontendKnowledgeDraftTargetResolutionV1 {
    return {
      target,
      resourceProjectId: entry.resourceProjectId,
      draftProjectId: entry.draftProjectId,
      effectiveProjectId: entry.effectiveProjectId,
      base: {
        ...entry.base,
        accessRevision: scope.accessRevision,
        policyContextRevision: scope.policyContextRevision,
      },
    };
  }
}
