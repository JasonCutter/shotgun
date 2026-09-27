/**
 * One-time VP cutover: reuse only the owner's existing DeepSeek credential.
 * Source content, Projects, and knowledge records are never copied.
 *
 * Required environment: VP_SOURCE_DATABASE_URL, VP_TARGET_DATABASE_URL,
 * SHOTGUN_CREDENTIAL_MASTER_KEY (and its optional version).
 * The target must contain exactly one newly bootstrapped, empty knowledge space.
 */
import 'dotenv/config';

import { fileURLToPath } from 'node:url';

import { PostgresProjectAIConfigurationRepository } from '../adapters/ai-configuration-postgres/src/index.js';
import { PostgresCredentialVaultRepository } from '../adapters/credential-vault-postgres/src/index.js';
import { createPostgresPool } from '../adapters/postgres/src/index.js';
import { PostgresStandingAIProcessingPolicyRepository } from '../adapters/project-standing-ai-policy-postgres/src/index.js';
import { PostgresProviderExternalTransferApprovalRepository } from '../adapters/provider-privacy-deployment-postgres/src/index.js';
import {
  ProjectAIConfigurationService,
  initialProviderRegistry,
} from '../modules/ai-configuration/src/index.js';
import {
  CredentialVaultService,
  EnvironmentCredentialMasterKeyAuthority,
} from '../modules/credential-vault/src/index.js';
import { ProviderExternalTransferApprovalService } from '../modules/provider-privacy-policy/src/index.js';
import { StandingAIProcessingPolicyService } from '../packages/policy/src/index.js';
import { GENERATIVE_AI_MODEL_ID } from '../packages/contracts/src/index.js';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

export const configureFreshVPSpace = async (): Promise<void> => {
  const sourceUrl = required('VP_SOURCE_DATABASE_URL');
  const targetUrl = required('VP_TARGET_DATABASE_URL');
  if (sourceUrl === targetUrl) throw new Error('Source and target databases must differ.');
  const sourcePool = createPostgresPool(sourceUrl);
  const targetPool = createPostgresPool(targetUrl);
  try {
    const target = await targetPool.query<{ project_id: string; principal_id: string }>(
      `SELECT p.id AS project_id, m.principal_id
       FROM project_admin.projects p
       JOIN auth.project_memberships m ON m.project_id = p.id AND m.is_owner = true
       WHERE p.active = true AND p.status = 'ACTIVE'`,
    );
    if (target.rows.length !== 1) {
      throw new Error('VP target must have exactly one active owner knowledge space.');
    }
    const { project_id: projectId, principal_id: principalId } = target.rows[0]!;
    const sourceCount = await targetPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM asset.sources',
    );
    if (sourceCount.rows[0]?.count !== '0') {
      throw new Error('VP target contains sources; refusing a first-run cutover.');
    }

    const sourceCredentials = await sourcePool.query<{
      credential_id: string;
      project_id: string;
      credential_revision: number;
    }>(
      `SELECT credential_id::text, project_id, credential_revision
       FROM ai.provider_credentials
       WHERE provider_id = 'deepseek' AND lifecycle_state = 'active'`,
    );
    if (sourceCredentials.rows.length !== 1) {
      throw new Error('Source must have exactly one active DeepSeek credential.');
    }
    const sourceCredential = sourceCredentials.rows[0]!;
    const masterKey = new EnvironmentCredentialMasterKeyAuthority();
    const sourceVault = new CredentialVaultService(
      new PostgresCredentialVaultRepository(sourcePool),
      masterKey,
    );
    const targetVault = new CredentialVaultService(
      new PostgresCredentialVaultRepository(targetPool),
      masterKey,
    );
    const existing = ((await targetVault.listMetadata?.(projectId)) ?? []).filter(
      (entry) => entry.providerId === 'deepseek' && entry.lifecycleState === 'active',
    );
    if (existing.length > 1) throw new Error('VP target has multiple active DeepSeek credentials.');
    let credential = existing[0];
    if (!credential) {
      await sourceVault.withCredential(
        {
          projectId: sourceCredential.project_id,
          providerId: 'deepseek',
          credentialId: sourceCredential.credential_id,
          credentialRevision: sourceCredential.credential_revision,
        },
        async (secret) => {
          credential = await targetVault.create({ projectId, providerId: 'deepseek', secret });
          return { status: 'SUCCEEDED' };
        },
      );
    }
    if (!credential) throw new Error('DeepSeek credential transfer did not complete.');

    const registry = initialProviderRegistry();
    const configuration = new ProjectAIConfigurationService(
      registry,
      new PostgresProjectAIConfigurationRepository(targetPool),
      targetVault,
      undefined,
      { enforceDeepSeekOnly: true },
    );
    let currentConfiguration = await configuration.getCurrent(projectId);
    if (!currentConfiguration) {
      currentConfiguration = await configuration.save({
        projectId,
        expectedRevision: 0,
        activeProviderId: 'deepseek',
        activeModelId: GENERATIVE_AI_MODEL_ID,
        credentialId: credential.credentialId,
        credentialRevision: credential.credentialRevision,
        updatedBy: principalId,
      });
    }
    if (
      currentConfiguration.activeProviderId !== 'deepseek' ||
      currentConfiguration.activeModelId !== GENERATIVE_AI_MODEL_ID ||
      currentConfiguration.credentialId !== credential.credentialId
    ) {
      throw new Error('VP target already has a different AI configuration.');
    }

    const privacy = new ProviderExternalTransferApprovalService(
      new PostgresProviderExternalTransferApprovalRepository(targetPool),
      registry,
    );
    const approval = await privacy.getCurrent(projectId, 'deepseek');
    if (approval?.approved !== true) {
      const proposal = await privacy.propose({
        projectId,
        providerId: 'deepseek',
        approved: true,
        expectedApprovalRevision: approval?.approvalRevision ?? 0,
        proposedBy: principalId,
      });
      await privacy.approve({
        proposalId: proposal.proposalId,
        projectId,
        providerId: 'deepseek',
        expectedApprovalRevision: approval?.approvalRevision ?? 0,
        reviewedBy: principalId,
      });
    }

    const standing = new StandingAIProcessingPolicyService(
      new PostgresStandingAIProcessingPolicyRepository(targetPool),
      { enforceDeepSeekOnly: true },
    );
    const policy = await standing.getCurrent(projectId);
    if (!policy?.enabled) {
      await standing.save({
        projectId,
        expectedRevision: policy?.policyRevision ?? 0,
        enabled: true,
        providerId: 'deepseek',
        aiConfigurationRevision: currentConfiguration.aiConfigurationRevision,
        changedBy: principalId,
      });
    }
    console.log('Fresh VP knowledge space configured for automatic DeepSeek processing.');
  } finally {
    await Promise.all([sourcePool.end(), targetPool.end()]);
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await configureFreshVPSpace().catch((error: unknown) => {
    // Never print a database URL, credential, or raw driver error.
    console.error(
      error instanceof Error
        ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')
        : 'VP configuration failed.',
    );
    process.exitCode = 1;
  });
}
