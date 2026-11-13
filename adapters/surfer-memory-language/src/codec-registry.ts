import type { SurferMemoryLanguageContext } from '../../../packages/contracts/src/surfer-memory-language.js';
import { surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import {
  SurferMemoryQuestionCodec,
  SURFER_MEMORY_QUESTION_REVISION,
} from '../../surfer-structure-extraction/src/memory-question.js';
import { SurferMemoryQuestionCodecV2 } from '../../surfer-structure-extraction/src/memory-question-v2.js';

/** Server-owned profile selects an exact codec revision. Unknown profiles never fall back. */
export function surferMemoryQuestionCodecForRevision(
  context: SurferMemoryLanguageContext,
  revision: string,
) {
  if (revision === SURFER_MEMORY_QUESTION_REVISION) return new SurferMemoryQuestionCodec(context);
  if (revision === 'surfer-memory-language-role-catalog-v2')
    return new SurferMemoryQuestionCodecV2(context);
  throw surferFailure('No natural-memory codec is registered for this profile revision.');
}
