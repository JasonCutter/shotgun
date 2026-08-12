import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  CredentialEnvelope,
  CredentialLifecycleState,
  CredentialScope,
  CredentialVaultRepositoryPort,
  StoredCredentialRevision,
} from '../../../modules/credential-vault/src/index.js';

type CredentialRow = QueryResultRow & {
  credential_id: string;
  project_id: string;
  provider_id: string;
  encrypted_secret: CredentialEnvelope;
  encryption_version: 'aes-256-gcm:v1';
  key_version: string;
  credential_revision: number;
  lifecycle_state: CredentialLifecycleState;
  created_at: Date;
  updated_at: Date;
};

const selectColumns = `
  credential_id::text, project_id, provider_id, encrypted_secret,
  encryption_version, key_version, credential_revision, lifecycle_state,
  created_at, updated_at
  FROM ai.provider_credentials`;

const mapRecord = (row: CredentialRow): StoredCredentialRevision => ({
  credentialId: row.credential_id,
  projectId: row.project_id,
  providerId: row.provider_id,
  encryptedSecret: row.encrypted_secret,
  encryptionVersion: row.encryption_version,
  keyVersion: row.key_version,
  credentialRevision: row.credential_revision,
  lifecycleState: row.lifecycle_state,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const findExactQuery = `
  SELECT ${selectColumns}
  WHERE project_id = $1 AND provider_id = $2
    AND credential_id = $3 AND credential_revision = $4`;

export class PostgresCredentialVaultRepository implements CredentialVaultRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async insertRevision(record: StoredCredentialRevision): Promise<void> {
    await this.pool.query(
      `INSERT INTO ai.provider_credentials (
         credential_id, project_id, provider_id, encrypted_secret,
         encryption_version, key_version, credential_revision,
         lifecycle_state, created_at, updated_at
       ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10)`,
      [
        record.credentialId,
        record.projectId,
        record.providerId,
        JSON.stringify(record.encryptedSecret),
        record.encryptionVersion,
        record.keyVersion,
        record.credentialRevision,
        record.lifecycleState,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  async findExact(scope: CredentialScope): Promise<StoredCredentialRevision | undefined> {
    const result = await this.pool.query<CredentialRow>(findExactQuery, [
      scope.projectId,
      scope.providerId,
      scope.credentialId,
      scope.credentialRevision,
    ]);
    return result.rows[0] ? mapRecord(result.rows[0]) : undefined;
  }

  async listCurrent(projectId: string): Promise<readonly StoredCredentialRevision[]> {
    const result = await this.pool.query<CredentialRow>(
      `SELECT DISTINCT ON (credential_id) ${selectColumns}
       WHERE project_id = $1
       ORDER BY credential_id, credential_revision DESC`,
      [projectId],
    );
    return result.rows.map(mapRecord);
  }

  async advanceRevision(input: {
    readonly projectId: string;
    readonly providerId: string;
    readonly credentialId: string;
    readonly expectedRevision: number;
    readonly next: StoredCredentialRevision;
  }): Promise<'UPDATED' | 'NOT_FOUND' | 'CONFLICT'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<CredentialRow>(`${findExactQuery} FOR UPDATE`, [
        input.projectId,
        input.providerId,
        input.credentialId,
        input.expectedRevision,
      ]);
      const currentRow = current.rows[0];
      if (!currentRow) {
        await client.query('ROLLBACK');
        return 'NOT_FOUND';
      }
      if (currentRow.lifecycle_state !== 'active') {
        await client.query('ROLLBACK');
        return 'CONFLICT';
      }
      if (
        input.next.credentialId !== input.credentialId ||
        input.next.projectId !== input.projectId ||
        input.next.providerId !== input.providerId ||
        input.next.credentialRevision !== input.expectedRevision + 1
      ) {
        await client.query('ROLLBACK');
        return 'CONFLICT';
      }

      await client.query(
        `UPDATE ai.provider_credentials
         SET lifecycle_state = 'superseded', updated_at = $1
         WHERE credential_id = $2 AND credential_revision = $3`,
        [input.next.updatedAt, input.credentialId, input.expectedRevision],
      );
      await insertRevision(client, input.next);
      await client.query('COMMIT');
      return 'UPDATED';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateLifecycle(input: {
    readonly scope: CredentialScope;
    readonly expectedState: 'active';
    readonly nextState: Exclude<CredentialLifecycleState, 'active'>;
    readonly updatedAt: string;
  }): Promise<StoredCredentialRevision | 'NOT_FOUND' | 'CONFLICT'> {
    const updated = await this.pool.query<CredentialRow>(
      `UPDATE ai.provider_credentials
       SET lifecycle_state = $5, updated_at = $6
       WHERE project_id = $1 AND provider_id = $2 AND credential_id = $3
         AND credential_revision = $4 AND lifecycle_state = $7
       RETURNING ${selectColumns.replace('FROM ai.provider_credentials', '')}`,
      [
        input.scope.projectId,
        input.scope.providerId,
        input.scope.credentialId,
        input.scope.credentialRevision,
        input.nextState,
        input.updatedAt,
        input.expectedState,
      ],
    );
    if (updated.rows[0]) return mapRecord(updated.rows[0]);

    const existing = await this.findExact(input.scope);
    return existing ? 'CONFLICT' : 'NOT_FOUND';
  }
}

const insertRevision = async (
  client: PoolClient,
  record: StoredCredentialRevision,
): Promise<void> => {
  await client.query(
    `INSERT INTO ai.provider_credentials (
       credential_id, project_id, provider_id, encrypted_secret,
       encryption_version, key_version, credential_revision,
       lifecycle_state, created_at, updated_at
     ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10)`,
    [
      record.credentialId,
      record.projectId,
      record.providerId,
      JSON.stringify(record.encryptedSecret),
      record.encryptionVersion,
      record.keyVersion,
      record.credentialRevision,
      record.lifecycleState,
      record.createdAt,
      record.updatedAt,
    ],
  );
};
