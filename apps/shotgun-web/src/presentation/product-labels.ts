const labels = <T extends string>(values: Record<T, string>) => values;

const ASK_MODE_LABELS = labels({
  CANONICAL_ONLY: 'Verified knowledge only',
  SOURCE_EXPLORATION: 'Use selected sources',
  HYBRID: 'Verified knowledge + selected sources',
});

const SOURCE_LIFECYCLE_LABELS = labels({
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
  ACTION_REQUIRED: 'Needs attention',
  FAILED: 'Unavailable',
});

const SOURCE_PREVIEW_LABELS = labels({
  NOT_READY: 'Preview not ready',
  PROCESSING: 'Preparing preview',
  READY: 'Preview ready',
  FAILED: 'Preview unavailable',
  ACCESS_RESTRICTED: 'Preview access restricted',
});

const SOURCE_ASK_USAGE_LABELS = labels({
  NOT_READY: 'Not yet available for questions',
  SOURCE_VERSION_READY: 'Available for questions',
  EVIDENCE_READY: 'Available with indexed evidence',
  ACTION_REQUIRED: 'Needs attention before use',
  FAILED: 'Unavailable for questions',
  ACCESS_RESTRICTED: 'Question access restricted',
});

const INTAKE_STATE_LABELS = labels({
  VALIDATING: 'Checking',
  QUEUED: 'Queued',
  RUNNING: 'Processing',
  PARTIAL: 'Partially completed',
  ACTION_REQUIRED: 'Needs attention',
  SUCCEEDED: 'Completed',
  FAILED: 'Failed',
  CANCEL_REQUESTED: 'Cancellation requested',
  CANCELLED: 'Cancelled',
  OUTCOME_INDETERMINATE: 'Checking final outcome',
});

const INTAKE_KIND_LABELS = labels({
  DIRECT_TEXT: 'Direct text',
  FILE: 'File',
  URL: 'URL',
  FILE_METADATA: 'File',
});

const INTAKE_VALIDATION_LABELS = labels({
  VALID: 'Ready to submit',
  UNSUPPORTED_FORMAT: 'Unsupported format',
  ENCRYPTED: 'Encrypted content',
  CORRUPT: 'Unreadable content',
  INACCESSIBLE: 'Cannot be accessed',
  POLICY_BLOCKED: 'Blocked by policy',
  TOO_LARGE: 'File is too large',
  INVALID_FILENAME: 'Invalid file name',
  INVALID_URL: 'Invalid URL',
  UNSAFE_DESTINATION: 'Unsafe destination',
});

const DUPLICATE_DISPOSITION_LABELS = labels({
  REUSE_EXISTING_VERSION: 'Use the existing version',
  CREATE_VERSION_CANDIDATE: 'Create a new version candidate',
  CREATE_SEPARATE_SOURCE: 'Create a separate source',
  CANCEL_SUBMISSION: 'Cancel this submission',
});

const ANSWER_RUN_LABELS = labels({
  QUEUED: 'Queued',
  RUNNING: 'Answering',
  STREAMING: 'Answering',
  ACTION_REQUIRED: 'Needs attention',
  SUCCEEDED: 'Completed',
  FAILED: 'Failed',
  CANCEL_REQUESTED: 'Cancellation requested',
  CANCELLED: 'Cancelled',
  OUTCOME_UNKNOWN: 'Checking final outcome',
});

const PROJECT_LIFECYCLE_LABELS = labels({
  ACTIVE: 'Active',
  ARCHIVING: 'Archiving',
  ARCHIVED: 'Archived',
  RESTORING: 'Restoring',
  DELETE_REQUESTED: 'Deletion requested',
  DELETING: 'Deleting',
  PENDING_DELETION: 'Deletion requested',
  DELETED: 'Deleted',
  RECOVERY_REQUIRED: 'Recovery required',
  READY: 'Ready',
  DEGRADED: 'Needs attention',
  UNAVAILABLE: 'Unavailable',
});

const TRANSFORMATION_STATE_LABELS = labels({
  NOT_STARTED: 'Not processed yet',
  RUNNING: 'Processing',
  READY: 'Ready',
  FAILED: 'Processing failed',
});

const EVIDENCE_ORIGIN_LABELS = labels({
  ORIGINAL: 'Original source',
  TRANSLATION: 'Translation',
  SUMMARY: 'Summary',
  ANNOTATION: 'Annotation',
  AI_OUTPUT: 'AI output',
});

const EXTERNAL_ACTION_OPERATION_LABELS = labels({
  PREVIEW_ONLY: 'Preview an external change',
  CREATE_DRAFT: 'Create an external draft',
  UPDATE_REVERSIBLE: 'Update an external resource',
  PUBLISH_OR_DELETE: 'Publish or remove an external resource',
  FINANCIAL_OR_LEGAL: 'Perform a financial or legal action',
});

const EXTERNAL_ACTION_STATUS_LABELS = labels({
  CANDIDATE_VALIDATED: 'Proposal validated',
  MANIFEST_READY: 'Plan ready',
  APPROVED: 'Approved',
  PREFLIGHT_READY: 'Ready for final checks',
  PREFLIGHT_FAILED: 'Final checks failed',
  READY_TO_EXECUTE: 'Ready to run',
  EXECUTING: 'Running',
  OUTCOME_UNKNOWN: 'Checking final outcome',
  FAILED: 'Failed',
  CANCELLING: 'Cancelling',
  CANCELLED: 'Cancelled',
  VERIFYING: 'Verifying',
  VERIFIED: 'Verified',
  VERIFICATION_FAILED: 'Verification failed',
  ROLLBACK_AVAILABLE: 'Can be rolled back',
  ROLLING_BACK: 'Rolling back',
  ROLLED_BACK: 'Rolled back',
  COMPENSATION_REQUIRED: 'Follow-up correction required',
  COMPENSATING: 'Applying follow-up correction',
  COMPENSATED: 'Follow-up correction completed',
  PENDING: 'Waiting to run',
  IN_PROGRESS: 'Running',
  SUCCEEDED: 'Completed',
  READY: 'Ready',
  ALREADY_APPLIED: 'Already applied',
  DENIED: 'Checks did not pass',
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
  CONSUMED: 'Used',
  INVALIDATED: 'No longer valid',
  APPLIED: 'Applied',
  NOT_APPLIED: 'Not applied',
  MISMATCH: 'Result does not match',
});

const RISK_LEVEL_LABELS = labels({
  R0: 'Minimal risk',
  R1: 'Low risk',
  R2: 'Moderate risk',
  R3: 'High risk',
  R4: 'Critical risk',
});

const SETTINGS_DRAFT_STATE_LABELS = labels({
  CLEAN: 'No unsaved changes',
  DIRTY: 'Unsaved changes',
  VALIDATING: 'Checking changes',
  READY_TO_APPLY: 'Ready to apply',
  APPLYING: 'Applying changes',
  APPLIED: 'Changes applied',
  REVIEW_REQUIRED: 'Review required',
  OUTCOME_UNKNOWN: 'Checking final outcome',
  VALIDATION_FAILED: 'Changes need attention',
  APPLY_FAILED: 'Changes could not be applied',
  STALE: 'Settings changed; refresh required',
});

const SETTINGS_APPLICATION_MODE_LABELS = labels({
  IMMEDIATE: 'Applies immediately',
  CONFIRM_REQUIRED: 'Confirmation required',
  REVIEW_REQUIRED: 'Review required',
  RESTART_REQUIRED: 'Restart required',
  MIGRATION_REQUIRED: 'Migration required',
  READ_ONLY: 'Read only',
  UNAVAILABLE: 'Unavailable',
});

const SETTINGS_RISK_LABELS = labels({
  LOW: 'Low risk',
  MEDIUM: 'Moderate risk',
  HIGH: 'High risk',
  CRITICAL: 'Critical risk',
});

const CONNECTOR_STATUS_LABELS = labels({
  NOT_CONFIGURED: 'Not configured',
  CONNECTING: 'Connecting',
  CONNECTED: 'Connected',
  DEGRADED: 'Needs attention',
  REAUTH_REQUIRED: 'Sign-in required',
  REVOKING: 'Disconnecting',
  REVOKED: 'Disconnected',
  FAILED: 'Connection failed',
});

const DIRECTIVE_STATUS_LABELS = labels({
  PROPOSED: 'Proposed',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  COMMITTED: 'Applied',
});

const SETTINGS_SCOPE_LABELS = labels({
  PRINCIPAL: 'Personal',
  PROJECT: 'Project',
  SYSTEM: 'System',
  RESOURCE: 'Resource',
});

const MODEL_COST_LABELS = labels({
  LOW: 'Lower cost',
  MEDIUM: 'Moderate cost',
  HIGH: 'Higher cost',
});

const MODEL_CAPABILITY_LABELS = labels({
  fast_answer: 'Fast answers',
  transformation: 'Content processing',
  deep_analysis: 'Deep analysis',
  reasoning: 'Reasoning',
});

const PRIVACY_PROFILE_LABELS = labels({
  LOCAL_ONLY: 'Local only',
  RESTRICTED_EXTERNAL: 'Restricted external access',
  CONTROLLED_EXTERNAL: 'Controlled external access',
  CUSTOM: 'Custom policy',
});

const SENSITIVITY_LABELS = labels({
  NORMAL: 'Normal',
  SENSITIVE: 'Sensitive',
  HIGHLY_SENSITIVE: 'Highly sensitive',
});

const SCHEMA_COMPATIBILITY_LABELS = labels({
  COMPATIBLE: 'Compatible',
  MIGRATION_REQUIRED: 'Migration required',
  INCOMPATIBLE: 'Incompatible',
});

const READINESS_LABELS = labels({
  READY: 'Ready',
  DEGRADED: 'Needs attention',
  UNAVAILABLE: 'Unavailable',
  HEALTHY: 'Healthy',
  WARNING: 'Warning',
});

const GRAPH_BASE_VIEW_LABELS = labels({
  KNOWLEDGE_SEMANTIC: 'Knowledge relationships',
  GOVERNANCE_IMPACT: 'Governance impact',
  OPERATIONAL_DEPENDENCY: 'Operational dependencies',
});

const GRAPH_OVERLAY_LABELS = labels({
  CONFLICT: 'Conflicts',
  KNOWLEDGE_GAP: 'Knowledge gaps',
  RECURSIVE_IMPACT: 'Extended impact',
  DISCOVERY: 'Discovery candidates',
});

const MEDIA_TYPE_LABELS: Readonly<Record<string, string>> = {
  'text/plain': 'Text',
  'text/markdown': 'Markdown',
  'application/pdf': 'PDF',
  'text/html': 'Web page',
};

const lookup = (value: string, values: Readonly<Record<string, string>>, fallback: string) =>
  values[value] ?? fallback;

export const askModeLabel = (value: string): string =>
  lookup(value, ASK_MODE_LABELS, 'Ask with the selected context');

export const sourceLifecycleLabel = (value: string): string =>
  lookup(value, SOURCE_LIFECYCLE_LABELS, 'Source status unavailable');

export const sourcePreviewLabel = (value: string): string =>
  lookup(value, SOURCE_PREVIEW_LABELS, 'Preview status unavailable');

export const sourceAskUsageLabel = (value: string): string =>
  lookup(value, SOURCE_ASK_USAGE_LABELS, 'Question availability unknown');

export const intakeStateLabel = (value: string): string =>
  lookup(value, INTAKE_STATE_LABELS, 'Status unavailable');

export const intakeKindLabel = (value: string): string =>
  lookup(value, INTAKE_KIND_LABELS, 'Source');

export const intakeValidationLabel = (value: string): string =>
  lookup(value, INTAKE_VALIDATION_LABELS, 'Check required');

export const duplicateDispositionLabel = (value: string): string =>
  lookup(value, DUPLICATE_DISPOSITION_LABELS, 'Resolve duplicate');

export const answerRunLabel = (value: string): string =>
  lookup(value, ANSWER_RUN_LABELS, 'Answer status unavailable');

export const projectLifecycleLabel = (value: string): string =>
  lookup(value, PROJECT_LIFECYCLE_LABELS, 'Project status unavailable');

export const transformationStateLabel = (value: string): string =>
  lookup(value, TRANSFORMATION_STATE_LABELS, 'Processing status unavailable');

export const evidenceOriginLabel = (value: string): string =>
  lookup(value, EVIDENCE_ORIGIN_LABELS, 'Source evidence');

export const externalActionOperationLabel = (value: string): string =>
  lookup(value, EXTERNAL_ACTION_OPERATION_LABELS, 'External action');

export const externalActionStatusLabel = (value: string): string =>
  lookup(value, EXTERNAL_ACTION_STATUS_LABELS, 'Status unavailable');

export const riskLevelLabel = (value: string): string =>
  lookup(value, RISK_LEVEL_LABELS, 'Risk not assessed');

export const settingsDraftStateLabel = (value: string): string =>
  lookup(value, SETTINGS_DRAFT_STATE_LABELS, 'Draft status unavailable');

export const settingsApplicationModeLabel = (value: string): string =>
  lookup(value, SETTINGS_APPLICATION_MODE_LABELS, 'Application mode unavailable');

export const settingsRiskLabel = (value: string): string =>
  lookup(value, SETTINGS_RISK_LABELS, 'Risk not assessed');

export const connectorStatusLabel = (value: string): string =>
  lookup(value, CONNECTOR_STATUS_LABELS, 'Connection status unavailable');

export const directiveStatusLabel = (value: string): string =>
  lookup(value, DIRECTIVE_STATUS_LABELS, 'Proposal status unavailable');

export const settingsScopeLabel = (value: string): string =>
  lookup(value, SETTINGS_SCOPE_LABELS, 'Settings');

export const modelCostLabel = (value: string): string =>
  lookup(value, MODEL_COST_LABELS, 'Cost not classified');

export const modelCapabilityLabel = (value: string): string =>
  lookup(value, MODEL_CAPABILITY_LABELS, 'Additional capability');

export const privacyProfileLabel = (value: string): string =>
  lookup(value, PRIVACY_PROFILE_LABELS, 'Custom privacy policy');

export const sensitivityLabel = (value: string): string =>
  lookup(value, SENSITIVITY_LABELS, 'Sensitivity not classified');

export const schemaCompatibilityLabel = (value: string): string =>
  lookup(value, SCHEMA_COMPATIBILITY_LABELS, 'Compatibility unavailable');

export const readinessLabel = (value: string): string =>
  lookup(value, READINESS_LABELS, 'Status unavailable');

export const graphBaseViewLabel = (value: string): string =>
  lookup(value, GRAPH_BASE_VIEW_LABELS, 'Knowledge relationships');

export const graphOverlayLabel = (value: string): string =>
  lookup(value, GRAPH_OVERLAY_LABELS, 'Additional context');

export const graphItemKindLabel = (value: string): string =>
  value === 'node' ? 'Knowledge item' : value === 'edge' ? 'Relationship' : 'Graph item';

export const mediaTypeLabel = (value: string): string =>
  lookup(value, MEDIA_TYPE_LABELS, value.startsWith('image/') ? 'Image' : 'Document');

export const formatProductTimestamp = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};
