import { describe, expect, it } from 'vitest';

import {
  decodeEnvelope,
  encodeEnvelope,
  validateAssetReference,
} from '../../packages/contracts/src/index.js';
import { securePingCommand } from '../helpers/stage-1.js';

describe('Message Envelope codec', () => {
  it('round-trips a versioned command envelope', () => {
    const command = securePingCommand('codec');

    expect(decodeEnvelope(encodeEnvelope(command))).toEqual(command);
  });

  it('rejects a command without an idempotency key', () => {
    const command = securePingCommand('missing-idempotency');
    const invalid = {
      ...command,
      idempotencyKey: undefined,
    };

    expect(() => encodeEnvelope(invalid)).toThrowError(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
      }),
    );
  });
});

describe('Asset Reference contract', () => {
  it('accepts immutable versioned asset references', () => {
    expect(() =>
      validateAssetReference({
        assetId: 'asset-1',
        versionId: 'version-3',
        mediaType: 'image/png',
        contentHash: 'sha256:abc123',
        sizeBytes: 1024,
        storageUri: 'asset://asset-1/versions/version-3',
        accessScope: ['owner'],
      }),
    ).not.toThrow();
  });

  it('rejects direct storage URLs that bypass the asset contract', () => {
    expect(() =>
      validateAssetReference({
        assetId: 'asset-1',
        versionId: 'version-3',
        mediaType: 'image/png',
        contentHash: 'sha256:abc123',
        sizeBytes: 1024,
        storageUri: 'https://storage.example.com/asset-1.png',
        accessScope: ['owner'],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
      }),
    );
  });
});
