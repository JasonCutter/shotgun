import type { SurferArtifactRef } from './surfer-knowledge.js';
import type { SurferScalar } from './surfer-learning.js';

export type SurferGuidedRuleCatalog = {
  schemaVersion: '1.0.0';
  status: 'READY' | 'UNAVAILABLE';
  snapshot: { snapshotId: string; digest: string } | null;
  items: {
    memory: SurferArtifactRef;
    description: string;
    domain: string;
    state: 'ACTIVE' | 'QUARANTINED' | 'RETRACTED';
    applySupported: boolean;
    fields: {
      name: string;
      type: 'NUMBER' | 'BOOLEAN' | 'TEXT';
      unit: string | null;
      values: SurferScalar[];
    }[];
  }[];
};
export type SurferGuidedRuleQuestion = {
  schemaVersion: '1.0.0';
  snapshot: { snapshotId: string; digest: string };
  memory: SurferArtifactRef;
  kind: 'RECALL' | 'APPLY';
  values: { name: string; valueIndex: number }[];
};
export type SurferGuidedRuleAnswer = {
  schemaVersion: '1.0.0';
  status: 'ANSWER' | 'UNKNOWN' | 'SOURCE_UNAVAILABLE' | 'BLOCKED';
  answers: {
    description: string;
    state: SurferGuidedRuleCatalog['items'][number]['state'];
    outcome: 'TRUE' | 'FALSE' | 'UNKNOWN' | 'RECALLED';
    reasons: string[];
    citations: {
      sourceId: string;
      sourceVersionId: string;
      evidenceId: string;
      revisionId: string;
      start: number;
      end: number;
      quote: string;
    }[];
  }[];
  semanticAssessment: 'NOT_EVALUATED';
  execution: 'ADVISORY_NOT_ACTION';
  premisesOrigin: 'CALLER_SUPPLIED_SCENARIO';
  modelCalls: 0;
};
