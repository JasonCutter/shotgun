import { createHash } from 'node:crypto';
import path from 'node:path';

import intakeAcceptedSchema from '../../../packages/contracts/schemas/intake-accepted.v1.schema.json';
import submitIntakeSchema from '../../../packages/contracts/schemas/submit-intake.v1.schema.json';
import {
  type CommandEnvelope,
  type SecurityContext,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';

export type IntakeChannel = 'direct_text' | 'file_upload';
export type MaterialKind = 'plain_text';

export type SubmitIntakePayload = {
  readonly submissionId: string;
  readonly sourceId?: string;
  readonly input:
    | {
        readonly kind: 'direct_text';
        readonly text: string;
      }
    | {
        readonly kind: 'text_file';
        readonly fileName: string;
        readonly mediaType: 'text/plain' | 'text/markdown';
        readonly contentBase64: string;
      };
};

export type IntakeSubmission = {
  readonly submissionId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly sourceId?: string;
  readonly channel: IntakeChannel;
  readonly materialKind: MaterialKind;
  readonly mediaType: 'text/plain' | 'text/markdown';
  readonly originalFileName?: string;
  readonly contentBase64: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly createdAt: string;
};

export type SavedIntakeSubmission = {
  readonly submission: IntakeSubmission;
  readonly duplicateSubmission: boolean;
};

export type IntakeRepositoryPort = {
  save(submission: IntakeSubmission): Promise<SavedIntakeSubmission>;
};

const MAX_ORIGINAL_BYTES = 1024 * 1024;

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const decodeStrictBase64 = (value: string): Buffer => {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'The uploaded text file is not valid canonical Base64.',
      module: 'stage2.intake',
      operation: 'normalize-intake',
    });
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'Stage 2 text files must use valid UTF-8 encoding.',
      module: 'stage2.intake',
      operation: 'validate-text-encoding',
      cause: error,
    });
  }
  return bytes;
};

const validateTextFile = (fileName: string, mediaType: 'text/plain' | 'text/markdown'): void => {
  const extension = path.extname(fileName).toLowerCase();
  const supported =
    (extension === '.txt' && mediaType === 'text/plain') ||
    (extension === '.md' && ['text/plain', 'text/markdown'].includes(mediaType));
  if (!supported) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'Stage 2 supports only .txt and plain-text .md files.',
      module: 'stage2.intake',
      operation: 'validate-text-file',
    });
  }
};

export const normalizeIntake = (
  envelope: CommandEnvelope<SubmitIntakePayload>,
): IntakeSubmission => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Intake requires project, actor, access scope and sensitivity context.',
      module: 'stage2.intake',
      operation: 'normalize-intake',
      correlationId: envelope.correlationId,
    });
  }

  const input = envelope.payload.input;
  let bytes: Buffer;
  let channel: IntakeChannel;
  let mediaType: IntakeSubmission['mediaType'];
  let originalFileName: string | undefined;

  if (input.kind === 'direct_text') {
    bytes = Buffer.from(input.text, 'utf8');
    if (new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== input.text) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Direct text contains an invalid Unicode sequence.',
        module: 'stage2.intake',
        operation: 'validate-direct-text',
        correlationId: envelope.correlationId,
      });
    }
    channel = 'direct_text';
    mediaType = 'text/plain';
  } else {
    validateTextFile(input.fileName, input.mediaType);
    bytes = decodeStrictBase64(input.contentBase64);
    channel = 'file_upload';
    mediaType = input.mediaType;
    originalFileName = input.fileName;
  }

  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ORIGINAL_BYTES) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'Original text must be between 1 byte and 1 MiB.',
      module: 'stage2.intake',
      operation: 'validate-original-size',
      correlationId: envelope.correlationId,
    });
  }

  return {
    submissionId: envelope.payload.submissionId,
    projectId: envelope.projectId,
    actorId: envelope.actor.id,
    sourceId: envelope.payload.sourceId,
    channel,
    materialKind: 'plain_text',
    mediaType,
    originalFileName,
    contentBase64: bytes.toString('base64'),
    contentHash: sha256(bytes),
    sizeBytes: bytes.byteLength,
    accessScope: [...envelope.security.accessScope],
    sensitivity: envelope.security.sensitivity,
    createdAt: envelope.createdAt,
  };
};

export const createIntakeModule = (repository: IntakeRepositoryPort): ShotgunModule => ({
  manifest: {
    id: 'stage2.intake',
    version: '1.0.0',
    owner: 'Shotgun Intake',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'SubmitIntake', range: '>=1.0.0 <2.0.0' },
        { name: 'IntakeAccepted', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process'] },
    dataOwnership: {
      owns: ['intake.submissions'],
      readsViaPorts: [],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [{ name: 'SubmitIntake', range: '>=1.0.0 <2.0.0' }],
      events: [],
    },
    produces: {
      events: [{ name: 'IntakeAccepted', range: '>=1.0.0 <2.0.0' }],
    },
    provides: {
      queries: [],
      capabilities: [{ name: 'intake-submit', priority: 100 }],
    },
    requires: { capabilities: ['original-asset-store'] },
    security: {
      requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
      defaultOnMissingContext: 'deny',
    },
    approvalPolicy: {
      canWriteCanonical: false,
      canExecuteExternalAction: false,
    },
  },
  contracts: [
    {
      name: 'SubmitIntake',
      version: '1.0.0',
      kind: 'command',
      inputSchema: submitIntakeSchema,
    },
    {
      name: 'IntakeAccepted',
      version: '1.0.0',
      kind: 'event',
      inputSchema: intakeAcceptedSchema,
    },
  ],
  handlers: {
    commands: [
      {
        messageType: 'SubmitIntake',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const normalized = normalizeIntake(envelope as CommandEnvelope<SubmitIntakePayload>);
          const saved = await repository.save(normalized);
          await context.publish({
            messageType: 'IntakeAccepted',
            schemaVersion: '1.0.0',
            idempotencyKey: `intake-accepted:${normalized.projectId}:${normalized.submissionId}`,
            payload: {
              submissionId: saved.submission.submissionId,
              sourceId: saved.submission.sourceId,
              channel: saved.submission.channel,
              materialKind: saved.submission.materialKind,
              mediaType: saved.submission.mediaType,
              originalFileName: saved.submission.originalFileName,
              contentBase64: saved.submission.contentBase64,
              contentHash: saved.submission.contentHash,
              sizeBytes: saved.submission.sizeBytes,
              createdAt: saved.submission.createdAt,
            },
          });
          return {
            submissionId: saved.submission.submissionId,
            channel: saved.submission.channel,
            materialKind: saved.submission.materialKind,
            contentHash: saved.submission.contentHash,
            sizeBytes: saved.submission.sizeBytes,
            duplicateSubmission: saved.duplicateSubmission,
          };
        },
      },
    ],
    events: [],
    queries: [],
  },
});
