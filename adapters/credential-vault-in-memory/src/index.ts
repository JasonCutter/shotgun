import type {
  CredentialScope,
  CredentialVaultRepositoryPort,
  CredentialLifecycleState,
  StoredCredentialRevision,
} from '../../../modules/credential-vault/src/index.js';

const keyOf = (scope: Pick<CredentialScope, 'credentialId' | 'credentialRevision'>): string =>
  `${scope.credentialId}:${scope.credentialRevision}`;

export class InMemoryCredentialVaultRepository implements CredentialVaultRepositoryPort {
  private readonly records = new Map<string, StoredCredentialRevision>();

  async insertRevision(record: StoredCredentialRevision): Promise<void> {
    if (record.clientRequestId) {
      const existing = await this.findByClientRequestId({
        projectId: record.projectId,
        clientRequestId: record.clientRequestId,
      });
      if (existing) return;
    }
    this.records.set(keyOf(record), record);
  }

  async findExact(scope: CredentialScope): Promise<StoredCredentialRevision | undefined> {
    const record = this.records.get(keyOf(scope));
    if (!record || record.projectId !== scope.projectId || record.providerId !== scope.providerId) {
      return undefined;
    }
    return record;
  }

  async findByClientRequestId(input: {
    readonly projectId: string;
    readonly clientRequestId: string;
  }): Promise<StoredCredentialRevision | undefined> {
    for (const record of this.records.values()) {
      if (
        record.projectId === input.projectId &&
        record.clientRequestId === input.clientRequestId
      ) {
        return record;
      }
    }
    return undefined;
  }

  async listCurrent(projectId: string): Promise<readonly StoredCredentialRevision[]> {
    const latest = new Map<string, StoredCredentialRevision>();
    for (const record of this.records.values()) {
      if (record.projectId !== projectId) continue;
      const current = latest.get(record.credentialId);
      if (!current || record.credentialRevision > current.credentialRevision) {
        latest.set(record.credentialId, record);
      }
    }
    return [...latest.values()].sort((left, right) =>
      `${left.providerId}:${left.credentialId}`.localeCompare(
        `${right.providerId}:${right.credentialId}`,
      ),
    );
  }

  async advanceRevision(input: {
    readonly projectId: string;
    readonly providerId: string;
    readonly credentialId: string;
    readonly expectedRevision: number;
    readonly next: StoredCredentialRevision;
  }): Promise<'UPDATED' | 'NOT_FOUND' | 'CONFLICT'> {
    const current = await this.findExact({
      projectId: input.projectId,
      providerId: input.providerId,
      credentialId: input.credentialId,
      credentialRevision: input.expectedRevision,
    });
    if (!current) return 'NOT_FOUND';
    if (current.lifecycleState !== 'active') return 'CONFLICT';

    this.records.set(keyOf(current), {
      ...current,
      lifecycleState: 'superseded',
      updatedAt: input.next.updatedAt,
    });
    this.records.set(keyOf(input.next), input.next);
    return 'UPDATED';
  }

  async updateLifecycle(input: {
    readonly scope: CredentialScope;
    readonly expectedState: 'active';
    readonly nextState: Exclude<CredentialLifecycleState, 'active'>;
    readonly updatedAt: string;
  }): Promise<StoredCredentialRevision | 'NOT_FOUND' | 'CONFLICT'> {
    const current = await this.findExact(input.scope);
    if (!current) return 'NOT_FOUND';
    if (current.lifecycleState !== input.expectedState) return 'CONFLICT';
    const updated = { ...current, lifecycleState: input.nextState, updatedAt: input.updatedAt };
    this.records.set(keyOf(current), updated);
    return updated;
  }
}
