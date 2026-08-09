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

/**
 * Deleted-project audit read gate. A principal is permitted to read deleted
 * project audit only when BOTH a scope binding exists for the project AND the
 * principal is in the granted set AND the scope is not revoked. This is the
 * read-time Capability revalidation boundary (fail-closed).
 */
export const isDeletedProjectAuditReadPermitted = (
  scope: DeletedProjectAuditScopeRecord | null,
  principalId: string,
): boolean => {
  if (!scope) return false;
  if (scope.revokedAt) return false;
  return scope.grantedPrincipalIds.includes(principalId);
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
