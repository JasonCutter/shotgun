import type { SecurityContext } from './types.js';

type NodeCryptoHashSubset = {
  readonly createHash: (algorithm: 'sha256') => {
    update(
      value: string,
      encoding: 'utf8',
    ): {
      digest(encoding: 'hex'): string;
    };
  };
};

const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rightRotate(n: number, b: number): number {
  return (n >>> b) | (n << (32 - b));
}

function pureJsSha256Hex(str: string): string {
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  const len = bytes.length;
  const bitLen = len * 8;

  const paddedLen = Math.ceil((len + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  view.setBigUint64(paddedLen - 8, BigInt(bitLen), false);

  const W = new Int32Array(64);
  const hash = new Int32Array(H);

  for (let i = 0; i < paddedLen; i += 64) {
    for (let t = 0; t < 16; t++) {
      W[t] = view.getInt32(i + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const w15 = W[t - 15]!;
      const w2 = W[t - 2]!;
      const s0 = (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) >>> 0;
      const s1 = (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10)) >>> 0;
      W[t] = (W[t - 16]! + s0 + W[t - 7]! + s1) | 0;
    }

    let a = hash[0]!,
      b = hash[1]!,
      c = hash[2]!,
      d = hash[3]!;
    let e = hash[4]!,
      f = hash[5]!,
      g = hash[6]!,
      h = hash[7]!;

    for (let t = 0; t < 64; t++) {
      const S1 = (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) >>> 0;
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K256[t]! + W[t]!) | 0;
      const S0 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) >>> 0;
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    hash[0] = (hash[0]! + a) | 0;
    hash[1] = (hash[1]! + b) | 0;
    hash[2] = (hash[2]! + c) | 0;
    hash[3] = (hash[3]! + d) | 0;
    hash[4] = (hash[4]! + e) | 0;
    hash[5] = (hash[5]! + f) | 0;
    hash[6] = (hash[6]! + g) | 0;
    hash[7] = (hash[7]! + h) | 0;
  }

  return Array.from(hash)
    .map((val) => (val >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

const computeSha256Hex = (value: string): string => {
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createHash } = require('node:crypto') as NodeCryptoHashSubset;
      return createHash('sha256').update(value, 'utf8').digest('hex');
    } catch {
      // Fallback
    }
  }
  return pureJsSha256Hex(value);
};

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

export type PageSelector = {
  readonly type: 'PageSelector';
  readonly page: number;
};

export type BoundingBoxSelector = {
  readonly type: 'BoundingBoxSelector';
  readonly page?: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly unit: 'pt' | 'px';
};

export type CellSelector = {
  readonly type: 'CellSelector';
  readonly sheet: string;
  readonly cell: string;
  readonly row: number;
  readonly column: number;
};

export type ShapeSelector = {
  readonly type: 'ShapeSelector';
  readonly slide: number;
  readonly shapeId: string;
};

export type CssSelector = {
  readonly type: 'CssSelector';
  readonly value: string;
};

export type SourceSelector =
  PageSelector | BoundingBoxSelector | CellSelector | ShapeSelector | CssSelector;

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
  readonly mediaType:
    | 'text/plain'
    | 'text/markdown'
    | 'text/html'
    | 'application/pdf'
    | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    | 'text/csv'
    | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    | 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    | 'image/png'
    | 'image/jpeg';
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
  readonly selectors?: readonly SourceSelector[];
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
  readonly selectors?: readonly SourceSelector[];
  readonly exactHash: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly createdAt: string;
};

export const sha256Text = (value: string): string => `sha256:${computeSha256Hex(value)}`;

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
