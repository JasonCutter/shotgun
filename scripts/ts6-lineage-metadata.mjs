import { createHash } from 'node:crypto';

/**
 * Build a new lineage edge from explicit current inputs. Prior derivedFrom values
 * are intentionally not accepted, so strings, arrays, or stale objects cannot
 * leak into a regenerated artifact.
 */
export const makeLineageMetadata = ({
  parentArtifact,
  parentContent,
  baseCommit,
  authorityVersion,
}) => ({
  parentArtifact,
  parentSha256: createHash('sha256')
    .update(parentContent.replace(/\r\n/g, '\n'), 'utf8')
    .digest('hex'),
  baseCommit,
  authorityVersion,
});
