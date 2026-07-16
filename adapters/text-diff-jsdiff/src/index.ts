import { diffWordsWithSpace } from 'diff';

import type { TextDiffPort } from '../../../modules/comparison/src/index.js';
import type { TextDiffSegment } from '../../../packages/contracts/src/index.js';

export class JsDiffAdapter implements TextDiffPort {
  readonly identity = {
    id: 'jsdiff.words-with-space',
    version: '9.0.0',
  };

  diff(previous: string, next: string): readonly TextDiffSegment[] {
    return diffWordsWithSpace(previous, next).map((part) => ({
      type: part.added ? 'insert' : part.removed ? 'delete' : 'equal',
      value: part.value,
    }));
  }
}
