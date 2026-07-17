import type { TextDiffPort } from '../../../modules/comparison/src/index.js';
import type { TextDiffSegment } from '../../../packages/contracts/src/index.js';

export class SimpleTextDiffAdapter implements TextDiffPort {
  readonly identity = {
    id: 'shotgun.simple-prefix-suffix',
    version: '1.0.0',
  };

  diff(previous: string, next: string): readonly TextDiffSegment[] {
    if (previous === next) {
      return previous ? [{ type: 'equal', value: previous }] : [];
    }

    const left = Array.from(previous);
    const right = Array.from(next);
    let prefix = 0;
    while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < left.length - prefix &&
      suffix < right.length - prefix &&
      left[left.length - suffix - 1] === right[right.length - suffix - 1]
    ) {
      suffix += 1;
    }

    const segments: TextDiffSegment[] = [];
    const commonPrefix = left.slice(0, prefix).join('');
    const deleted = left.slice(prefix, left.length - suffix).join('');
    const inserted = right.slice(prefix, right.length - suffix).join('');
    const commonSuffix = suffix > 0 ? left.slice(left.length - suffix).join('') : '';
    if (commonPrefix) segments.push({ type: 'equal', value: commonPrefix });
    if (deleted) segments.push({ type: 'delete', value: deleted });
    if (inserted) segments.push({ type: 'insert', value: inserted });
    if (commonSuffix) segments.push({ type: 'equal', value: commonSuffix });
    return segments;
  }
}
