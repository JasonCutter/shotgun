import Ajv, { type ValidateFunction } from 'ajv';

import assetReferenceSchema from '../schemas/asset-reference.v1.schema.json';
import { ShotgunError } from './errors.js';
import type { AssetReference } from './types.js';

const ajv = new Ajv({ allErrors: true, strict: true });
const validate: ValidateFunction = ajv.compile(assetReferenceSchema);

export const validateAssetReference: (reference: unknown) => asserts reference is AssetReference = (
  reference,
) => {
  if (!validate(reference)) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: `Asset Reference is invalid: ${ajv.errorsText(validate.errors)}`,
      module: 'contracts',
      operation: 'validate-asset-reference',
    });
  }
};
