import type { SurferArtifactRef } from './surfer-knowledge.js';
import type { SurferMemoryObservation, SurferMemoryAnswer } from './surfer-directive-memory.js';

/** Browser display data only: no packets, Source basis, authority or session tokens. */
export type SurferGuidedCatalog = {
  schemaVersion: '1.0.0';
  status: 'READY' | 'UNAVAILABLE';
  snapshot: { snapshotId: string; digest: string } | null;
  items: {
    memory: SurferArtifactRef;
    subject: string;
    operation: string;
    applySupported: boolean;
    dateRequired: boolean;
    fields: {
      predicateId: string;
      quote: string;
      type: 'NUMBER' | 'BOOLEAN';
      unit: string | null;
    }[];
  }[];
};
export type SurferGuidedQuestion = {
  schemaVersion: '1.0.0';
  snapshot: { snapshotId: string; digest: string };
  memory: SurferArtifactRef;
  kind: 'RECALL' | 'APPLY';
  observations: SurferMemoryObservation[];
  atDate: string | null;
};
export type SurferGuidedAnswer = {
  schemaVersion: '1.0.0';
  status: 'ANSWER' | 'UNKNOWN' | 'PARTIAL' | 'CONFLICT' | 'SOURCE_UNAVAILABLE' | 'BLOCKED';
  answers: Pick<SurferMemoryAnswer, 'outcome' | 'declaredMode' | 'citations' | 'needed'>[];
  semanticAssessment: 'NOT_EVALUATED';
  execution: 'ADVISORY_NOT_ACTION';
  premisesOrigin: 'CALLER_SUPPLIED_SCENARIO';
  modelCalls: 0;
};
