/**
 * FE-P5-S2 WP2-C — ProjectTombstone / DeletedProjectAuditScope capability.
 *
 * Owner: project-administration / security (ADR-131 §6, IR r1 §5 WP2-C).
 *
 * Deleted Project becomes a `ProjectTombstone`; general Workspace access
 * stops, while a separately authorized `DeletedProjectAuditScope` may
 * preserve lineage (ADR-112 §11). Past membership alone never grants
 * deleted-project audit access (ADR-112 §12); restoration creates explicit
 * recovery lineage. Deleted-project audit read requires current Capability
 * revalidation (fail-closed).
 */

/**
 * Deleted Project tombstone. Identity preserved; audit lineage digest kept.
 * Mirrors project_audit.project_tombstones exactly.
 */
export type ProjectTombstoneRecord = {
  readonly projectId: string;
  readonly deletedAt: string;
  readonly deletedBy: string;
  readonly reason: string;
  readonly retentionClass: string;
  readonly lineageDigest: string;
};

/**
 * Separately authorized deleted-project audit scope. Scope binding alone is
 * never sufficient: read requires current Capability revalidation.
 */
export type DeletedProjectAuditScopeRecord = {
  readonly scopeId: string;
  readonly projectId: string;
  readonly grantedPrincipalIds: readonly string[];
  readonly grantedAt: string;
  readonly grantedBy: string;
  readonly revokedAt?: string;
};

export type CreateProjectTombstoneInput = {
  readonly projectId: string;
  readonly deletedBy: string;
  readonly reason: string;
  readonly retentionClass: string;
  readonly lineageDigest: string;
  readonly deletedAt: string;
};

export type GrantDeletedProjectAuditScopeInput = {
  readonly scopeId: string;
  readonly projectId: string;
  readonly grantedPrincipalIds: readonly string[];
  readonly grantedBy: string;
  readonly grantedAt: string;
};

export type RevokeDeletedProjectAuditScopeInput = {
  readonly scopeId: string;
  readonly revokedAt: string;
};

/** Server-derived current capabilities for read-time revalidation. */
export type DeletedProjectAuditReadContext = {
  readonly projectId: string;
  readonly principalId: string;
  readonly currentCapabilities: readonly string[];
};

/** The capability that must be currently held to read deleted-project audit. */
export const DELETED_PROJECT_AUDIT_READ_CAPABILITY = 'project:deleted-audit:read';

/**
 * Deleted-project audit read gate (fail-closed). A principal is permitted to
 * read deleted project audit only when ALL of the following hold:
 *   - a scope binding exists
 *   - scope.projectId == requested project
 *   - principal is currently bound by the scope (grantedPrincipalIds)
 *   - scope is not revoked
 *   - the CURRENT server-derived capability set includes
 *     `project:deleted-audit:read` (past membership alone never grants access)
 * This is the read-time Capability revalidation boundary (ADR-112 §11/§12,
 * ADR-131 §6).
 */
export const isDeletedProjectAuditReadPermitted = (
  scope: DeletedProjectAuditScopeRecord | null,
  context: DeletedProjectAuditReadContext,
): boolean => {
  if (!scope) return false;
  if (scope.revokedAt) return false;
  if (scope.projectId !== context.projectId) return false;
  if (!scope.grantedPrincipalIds.includes(context.principalId)) return false;
  return context.currentCapabilities.includes(DELETED_PROJECT_AUDIT_READ_CAPABILITY);
};

/**
 * Authoritative ProjectTombstone + DeletedProjectAuditScope capability owned
 * by project-administration / security (read/write).
 */
export type ProjectTombstoneStorePort = {
  createTombstone(input: CreateProjectTombstoneInput): Promise<ProjectTombstoneRecord>;
  getTombstone(projectId: string): Promise<ProjectTombstoneRecord | null>;
  grantAuditScope(
    input: GrantDeletedProjectAuditScopeInput,
  ): Promise<DeletedProjectAuditScopeRecord>;
  revokeAuditScope(
    input: RevokeDeletedProjectAuditScopeInput,
  ): Promise<DeletedProjectAuditScopeRecord>;
  getAuditScope(scopeId: string): Promise<DeletedProjectAuditScopeRecord | null>;
  listAuditScopes(projectId: string): Promise<readonly DeletedProjectAuditScopeRecord[]>;
};
