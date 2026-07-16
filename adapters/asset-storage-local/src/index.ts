import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ShotgunError } from '../../../packages/contracts/src/index.js';
import type { AssetStoragePort } from '../../../modules/original-asset/src/index.js';

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

export class LocalAssetStorage implements AssetStoragePort {
  private readonly root: string;

  constructor(rootDirectory: string) {
    this.root = path.resolve(rootDirectory);
  }

  async put(contentHash: string, bytes: Uint8Array): Promise<string> {
    if (sha256(bytes) !== contentHash) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Asset bytes do not match their content hash.',
        module: 'asset-storage-local',
        operation: 'put-asset',
      });
    }

    const hash = contentHash.slice('sha256:'.length);
    const storageKey = path.posix.join('original', 'sha256', hash.slice(0, 2), `${hash}.blob`);
    const target = this.resolveStorageKey(storageKey);
    await mkdir(path.dirname(target), { recursive: true });

    if (await this.isValidExisting(target, contentHash)) {
      return storageKey;
    }

    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { flag: 'wx' });
    try {
      await rename(temporary, target);
    } catch (error) {
      if (!(await this.isValidExisting(target, contentHash))) {
        throw error;
      }
    } finally {
      await rm(temporary, { force: true });
    }
    return storageKey;
  }

  async read(storageKey: string): Promise<Uint8Array> {
    try {
      return await readFile(this.resolveStorageKey(storageKey));
    } catch (error) {
      if (isMissing(error)) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'Original Asset bytes were not found.',
          module: 'asset-storage-local',
          operation: 'read-asset',
          cause: error,
        });
      }
      throw error;
    }
  }

  private resolveStorageKey(storageKey: string): string {
    const target = path.resolve(this.root, ...storageKey.split('/'));
    if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'Asset storage key escaped the configured storage root.',
        module: 'asset-storage-local',
        operation: 'resolve-storage-key',
      });
    }
    return target;
  }

  private async isValidExisting(target: string, contentHash: string): Promise<boolean> {
    try {
      const existing = await readFile(target);
      if (sha256(existing) !== contentHash) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'Content-addressed storage contains bytes with a different hash.',
          module: 'asset-storage-local',
          operation: 'verify-existing-asset',
        });
      }
      return true;
    } catch (error) {
      if (isMissing(error)) {
        return false;
      }
      throw error;
    }
  }
}
