import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  GoldenCorpus,
  GoldenCorpusCase,
  GoldenCorpusManifest,
  RecordedClaimPredictionSet,
} from '../../packages/quality-evaluation/src/index.js';

const fixtureRoot = path.resolve('tests', 'fixtures', 'quality');

const readJson = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(path.join(fixtureRoot, file), 'utf8')) as T;

export const loadQualityCorpus = async (): Promise<GoldenCorpus> => ({
  manifest: await readJson<GoldenCorpusManifest>('golden-corpus-manifest.v1.json'),
  cases: await readJson<readonly GoldenCorpusCase[]>('golden-corpus-cases.v1.json'),
});

export const loadMetricCalculatorFixture = (): Promise<RecordedClaimPredictionSet> =>
  readJson<RecordedClaimPredictionSet>('metric-calculator-claim-fixture.v1.json');
