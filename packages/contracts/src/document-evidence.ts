import { createHash } from 'node:crypto';

import type { SecurityContext } from './types.js';

export type SourceOrigin = 'source' | 'translation' | 'summary' | 'annotation';
export type SourceNodeKind = 'document' | 'paragraph' | 'sentence';

export type TextPositionSelector = {
  readonly type: 'TextPositionSelector';
  readonly start: number;
  readonly end: number;
  readonly unit: 'unicode-code-point';
};

export type TextQuoteSelector = {
  readonly type: 'TextQuoteSelector';
  readonly exact: string;
  readonly prefix?: string;
  readonly suffix?: string;
};

export type DocumentIRSentence = {
  readonly id: string;
  readonly kind: 'sentence';
  readonly text: string;
};

export type DocumentIRBlock = {
  readonly id: string;
  readonly kind: 'paragraph';
  readonly text: string;
  readonly sentences: readonly DocumentIRSentence[];
};

export type DocumentIR = {
  readonly schemaVersion: '1.0.0';
  readonly mediaType: 'text/plain' | 'text/markdown';
  readonly blocks: readonly DocumentIRBlock[];
};

export type SourceMapEntry = {
  readonly pointer: string;
  readonly nodeKind: SourceNodeKind;
  readonly sourceVersionId: string;
  readonly sourceContentHash: string;
  readonly origin: SourceOrigin;
  readonly position: TextPositionSelector;
  readonly quote: TextQuoteSelector;
  readonly exactHash: string;
};

export type SourceMap = {
  readonly schemaVersion: '1.0.0';
  readonly entries: readonly SourceMapEntry[];
};

export type TransformerIdentity = {
  readonly id: string;
  readonly version: string;
};

export type TransformationRevision = {
  readonly revisionId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly sourceContentHash: string;
  readonly transformer: TransformerIdentity;
  readonly documentIR: DocumentIR;
  readonly sourceMap: SourceMap;
  readonly documentHash: string;
  readonly sourceMapHash: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly createdAt: string;
};

export type EvidenceSpan = {
  readonly evidenceId: string;
  readonly revisionId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly pointer: string;
  readonly nodeKind: SourceNodeKind;
  readonly origin: 'source';
  readonly position: TextPositionSelector;
  readonly quote: TextQuoteSelector;
  readonly exactHash: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly createdAt: string;
};

export const sha256Text = (value: string): string =>
  `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;

export const stableJson = (value: unknown): string => {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) {
      return entry.map(normalize);
    }
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(
        Object.entries(entry)
          .filter(([, child]) => child !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return entry;
  };
  return JSON.stringify(normalize(value));
};

export const unicodeLength = (value: string): number => Array.from(value).length;

export const unicodeSlice = (value: string, start: number, end: number): string =>
  Array.from(value).slice(start, end).join('');

export const jsonPointerEscape = (value: string): string =>
  value.replaceAll('~', '~0').replaceAll('/', '~1');
