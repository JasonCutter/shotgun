import Ajv, { type ValidateFunction } from 'ajv';

import envelopeSchema from '../schemas/message-envelope.v1.schema.json';
import { ShotgunError } from './errors.js';
import type { AnyEnvelope } from './types.js';

const ajv = new Ajv({ allErrors: true, strict: true });
const validate: ValidateFunction = ajv.compile(envelopeSchema);

export const validateEnvelope: (envelope: unknown) => asserts envelope is AnyEnvelope = (
  envelope,
) => {
  if (!validate(envelope)) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: `Message Envelope is invalid: ${ajv.errorsText(validate.errors)}`,
      module: 'contracts',
      operation: 'validate-envelope',
    });
  }
};

export const encodeEnvelope = (envelope: unknown): string => {
  validateEnvelope(envelope);
  return JSON.stringify(envelope);
};

export const decodeEnvelope = (serialized: string): AnyEnvelope => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'Message Envelope is not valid JSON.',
      module: 'contracts',
      operation: 'decode-envelope',
      cause: error,
    });
  }
  validateEnvelope(parsed);
  return parsed;
};
