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
export type MaterialKind = 'plain_text' | 'document' | 'image';
export type SupportedMediaType =
  | 'text/plain'
  | 'text/markdown'
  | 'text/html'
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'text/csv'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  | 'image/png'
  | 'image/jpeg';

export type SubmitIntakePayload = {
  readonly submissionId: string;
  readonly sourceId?: string;
  readonly input:
    | {
        readonly kind: 'direct_text';
        readonly text: string;
      }
    | {
        readonly kind: 'text_file' | 'file_upload';
        readonly fileName: string;
        readonly mediaType: SupportedMediaType;
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
  readonly mediaType: SupportedMediaType;
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

const MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const decodeStrictBase64 = (value: string): Buffer => {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'The uploaded file is not valid canonical Base64.',
      module: 'stage2.intake',
      operation: 'normalize-intake',
    });
  }
  return bytes;
};

const extensionMediaTypes: Readonly<Record<string, readonly SupportedMediaType[]>> = {
  '.txt': ['text/plain'],
  '.md': ['text/plain', 'text/markdown'],
  '.html': ['text/html'],
  '.htm': ['text/html'],
  '.pdf': ['application/pdf'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.csv': ['text/csv'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
};

const validateFile = (fileName: string, mediaType: SupportedMediaType): void => {
  const extension = path.extname(fileName).toLowerCase();
  const supported = extensionMediaTypes[extension]?.includes(mediaType) ?? false;
  if (!supported) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'The file extension and declared media type are unsupported or do not match.',
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
    validateFile(input.fileName, input.mediaType);
    bytes = decodeStrictBase64(input.contentBase64);
    if (input.mediaType.startsWith('text/')) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (error) {
        throw new ShotgunError({
          code: 'VALIDATION_ERROR',
          safeMessage: 'Text-based files must use valid UTF-8 encoding.',
          module: 'stage2.intake',
          operation: 'validate-text-encoding',
          cause: error,
        });
      }
    }
    channel = 'file_upload';
    mediaType = input.mediaType;
    originalFileName = input.fileName;
  }

  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ORIGINAL_BYTES) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'Original input must be between 1 byte and 10 MiB.',
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
    materialKind: mediaType.startsWith('image/')
      ? 'image'
      : ['text/plain', 'text/markdown'].includes(mediaType)
        ? 'plain_text'
        : 'document',
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
