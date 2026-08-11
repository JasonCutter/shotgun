import type { Pool } from 'pg';

import {
  ShotgunError,
  type AskSourceSelectionView,
} from '../../../packages/contracts/src/index.js';
import type {
  AskContextSensitivity,
  AskProjectPrivacyPolicy,
  AskProviderPolicyAuthorityReaderPort,
} from '../../../modules/frontend-ask-provider-policy/src/index.js';

export class PostgresAskProviderPolicyAuthorityReader implements AskProviderPolicyAuthorityReaderPort {
  constructor(private readonly pool: Pool) {}

  async readProjectPrivacyPolicy(projectId: string): Promise<AskProjectPrivacyPolicy> {
    const result = await this.pool.query<{
      settings_revision: number;
      policy_context_revision: number;
      external_transfer_allowed: boolean;
    }>(
      `SELECT
         COALESCE((SELECT MAX(revision) FROM settings.settings_revisions WHERE project_id = $1), 0)::integer AS settings_revision,
         COALESCE((SELECT MAX(revision) FROM settings.policy_context_revisions WHERE project_id = $1), 0)::integer AS policy_context_revision,
         COALESCE((
           SELECT (settings_snapshot->>'privacy.externalTransferAllowed')::boolean
           FROM settings.settings_revisions
           WHERE project_id = $1
           ORDER BY revision DESC LIMIT 1
         ), false) AS external_transfer_allowed`,
      [projectId],
    );
    const row = result.rows[0];
    if (!row) throw this.notFound();
    return {
      externalTransferAllowed: row.external_transfer_allowed,
      settingsRevision: row.settings_revision,
      policyContextRevision: row.policy_context_revision,
    };
  }

  async readSelectedSensitivities(input: {
    readonly projectId: string;
    readonly sourceSelections: readonly AskSourceSelectionView[];
  }): Promise<readonly AskContextSensitivity[]> {
    if (input.sourceSelections.length === 0) return [];
    const result = await this.pool.query<{
      source_id: string;
      source_version_id: string;
      sensitivity: AskContextSensitivity;
    }>(
      `SELECT source.source_id::text, version.source_version_id::text, version.sensitivity
       FROM asset.sources AS source
       JOIN asset.source_versions AS version ON version.source_id = source.source_id
       WHERE source.project_id = $1
         AND (source.source_id::text, version.source_version_id::text) IN (
           SELECT * FROM UNNEST($2::text[], $3::text[])
         )`,
      [
        input.projectId,
        input.sourceSelections.map((selection) => selection.sourceId),
        input.sourceSelections.map((selection) => selection.sourceVersionId),
      ],
    );
    const bySelection = new Map(
      result.rows.map((row) => [`${row.source_id}\u0000${row.source_version_id}`, row.sensitivity]),
    );
    const sensitivities = input.sourceSelections.map((selection) => {
      const sensitivity = bySelection.get(
        `${selection.sourceId}\u0000${selection.sourceVersionId}`,
      );
      if (!sensitivity) throw this.notFound();
      return sensitivity;
    });
    const evidenceIds = input.sourceSelections.flatMap((selection) => [...selection.evidenceIds]);
    if (evidenceIds.length === 0) return sensitivities;
    const evidence = await this.pool.query<{
      evidence_id: string;
      source_id: string;
      source_version_id: string;
      sensitivity: AskContextSensitivity;
    }>(
      `SELECT evidence_id::text, source_id::text, source_version_id::text, sensitivity
       FROM evidence.spans
       WHERE project_id = $1 AND evidence_id::text = ANY($2::text[])`,
      [input.projectId, evidenceIds],
    );
    const evidenceById = new Map(evidence.rows.map((row) => [row.evidence_id, row]));
    for (const selection of input.sourceSelections) {
      for (const evidenceId of selection.evidenceIds) {
        const row = evidenceById.get(evidenceId);
        if (
          !row ||
          row.source_id !== selection.sourceId ||
          row.source_version_id !== selection.sourceVersionId
        ) {
          throw this.notFound();
        }
        sensitivities.push(row.sensitivity);
      }
    }
    return sensitivities;
  }

  private notFound(): ShotgunError {
    return new ShotgunError({
      code: 'NOT_FOUND',
      safeMessage: 'The selected authoritative context is not available.',
      module: 'frontend-ask-provider-policy-postgres',
      operation: 'resolve-provider-policy-authority',
    });
  }
}
