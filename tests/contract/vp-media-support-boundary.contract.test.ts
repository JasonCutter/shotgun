import { describe, expect, it, vi } from 'vitest';

import { SealedSourcesStagingService } from '../../adapters/frontend-sources-staging-sealed/src/index.js';
import type { AssetStoragePort } from '../../modules/original-asset/src/index.js';
import type { SourcesStagingMediaType } from '../../packages/contracts/src/index.js';

/** The active product boundary must not inherit an adapter's experimental
 * image parser capability or invent timecode/frame support from media metadata. */
describe('VP active media intake boundary', () => {
  it.each([
    ['photo.png', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['photo.webp', 'image/webp'],
    ['photo.gif', 'image/gif'],
    ['audio.mp3', 'audio/mpeg'],
    ['audio.wav', 'audio/wav'],
    ['audio.m4a', 'audio/mp4'],
    ['video.mp4', 'video/mp4'],
    ['video.webm', 'video/webm'],
    ['video.mov', 'video/quicktime'],
  ])(
    'rejects unsupported %s before writing immutable bytes or calling a provider',
    async (fileName, declaredType) => {
      const put = vi.fn<AssetStoragePort['put']>();
      const service = new SealedSourcesStagingService(
        { put, read: vi.fn() },
        'vp-media-boundary-contract-key-32-characters',
      );
      await expect(
        service.stageBytes({
          draftId: 'draft',
          itemId: 'item',
          projectId: 'project',
          principalId: 'owner',
          kind: 'FILE',
          label: fileName,
          fileName,
          mediaType: declaredType as SourcesStagingMediaType,
          bytes: Buffer.from('media fixture'),
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(put).not.toHaveBeenCalled();
    },
  );

  it.each(['photo.png', 'audio.mp3', 'video.mp4'])(
    'cannot activate %s by declaring text/plain',
    async (fileName) => {
      const put = vi.fn<AssetStoragePort['put']>();
      const service = new SealedSourcesStagingService(
        { put, read: vi.fn() },
        'vp-media-boundary-contract-key-32-characters',
      );
      await expect(
        service.stageBytes({
          draftId: 'draft',
          itemId: 'item',
          projectId: 'project',
          principalId: 'owner',
          kind: 'FILE',
          label: fileName,
          fileName,
          mediaType: 'text/plain',
          bytes: Buffer.from('plain-looking media'),
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(put).not.toHaveBeenCalled();
    },
  );
});
