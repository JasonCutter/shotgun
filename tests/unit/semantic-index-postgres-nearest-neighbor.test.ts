import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresSemanticIndexRepository } from '../../adapters/semantic-index-postgres/src/index.js';
import {
  SemanticRetrievalError,
  type SemanticCandidateQuery,
} from '../../packages/contracts/src/index.js';

describe('Postgres semantic nearest-neighbor failure boundary', () => {
  it('converts a database execution failure into bounded nearest-neighbor diagnostics', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            project_id: 'project-nearest-failure',
            generation_id: 'generation-nearest-failure',
            source_projection_digest: 'sha256:source-nearest-failure',
            canonical_base_version: 1,
            credential_id: 'credential-nearest-failure',
            credential_revision: 1,
            provider_policy_fingerprint: 'sha256:policy-nearest-failure',
            provider_id: 'openai',
            embedding_model_id: 'text-embedding-3-small',
            embedding_profile_id: 'profile-nearest-failure',
            embedding_profile_revision: 1,
            provider_registry_revision: 'provider-registry:v1',
            capability_catalog_revision: 'semantic-embedding-catalog:v1',
            representation_version: 'semantic-representation:v2',
            dimension: 2,
            distance_metric: 'cosine',
            normalization_policy: 'unit_length',
            build_status: 'READY',
            created_at: new Date('2026-09-08T00:00:00.000Z'),
          },
        ],
      })
      .mockRejectedValueOnce(
        new Error(
          'PGVECTOR_INTERNAL_DETAIL: SQL and database credentials must never cross the adapter boundary',
        ),
      );
    const repository = new PostgresSemanticIndexRepository({ query } as unknown as Pool);
    const request: SemanticCandidateQuery = {
      projectId: 'project-nearest-failure',
      generationId: 'generation-nearest-failure',
      queryVector: [1 / Math.sqrt(2), 1 / Math.sqrt(2)],
      dimension: 2,
      accessScopes: ['project:nearest-failure'],
      allowedSensitivities: ['private'],
      limit: 1,
    };

    const rejection = repository.findNearestNeighbors(request);

    await expect(rejection).rejects.toBeInstanceOf(SemanticRetrievalError);
    await expect(rejection).rejects.toMatchObject({
      name: 'SemanticRetrievalError',
      degradationStage: 'NEAREST_NEIGHBOR',
    });
    await expect(rejection).rejects.not.toMatchObject({
      message: expect.stringContaining('PGVECTOR_INTERNAL_DETAIL'),
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
