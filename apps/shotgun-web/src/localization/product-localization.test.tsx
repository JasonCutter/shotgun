import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { ShotgunApiClient } from '@shotgun/api-client';

import { createFrontendQueryClient } from '../app/query-client.js';
import { AppProviders, type AppRuntime } from '../app/providers.js';
import { principalPreferencesQueryKey } from '../app/query-keys.js';
import { OwnerCommandPalette } from '../commands/owner-command-palette.js';
import type { OwnerCommandDefinition } from '../commands/owner-command-registry.js';
import { createSessionCycleState } from '../session/session-query.js';
import {
  hfmOwnerLabel,
  ProductLocalizationProvider,
  resolveProductLocale,
  useProductLocalization,
} from './product-localization.js';

const command: OwnerCommandDefinition = {
  id: 'search.global',
  category: 'SEARCH',
  label: 'Search',
  description: 'Search the active Project',
  aliases: ['search'],
  keywords: ['global'],
  availability: 'AVAILABLE',
  risk: 'READ',
  presentation: 'DIALOG',
  action: { kind: 'OPEN_SEARCH' },
};

const unavailableCommands: readonly OwnerCommandDefinition[] = [
  {
    id: 'ai.configure',
    category: 'AI',
    label: 'AI configuration',
    description: 'AI configuration',
    aliases: [],
    keywords: [],
    availability: 'UNAVAILABLE_WITH_REASON',
    reasonKey: 'commands.unavailable.ai_configuration_offline',
    risk: 'WRITE',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_AI_FLOW', commandId: 'ai.configure' },
  },
  {
    id: 'ai.test_connection',
    category: 'AI',
    label: 'AI connection test',
    description: 'AI connection test',
    aliases: [],
    keywords: [],
    availability: 'UNAVAILABLE_WITH_REASON',
    reasonKey: 'commands.unavailable.ai_test_offline',
    risk: 'WRITE',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_AI_FLOW', commandId: 'ai.test_connection' },
  },
  {
    id: 'privacy.open',
    category: 'PRIVACY',
    label: 'Privacy',
    description: 'Privacy',
    aliases: [],
    keywords: [],
    availability: 'UNAVAILABLE_WITH_REASON',
    reasonKey: 'commands.unavailable.privacy_open_offline',
    risk: 'READ',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_PRIVACY_FLOW', commandId: 'privacy.open' },
  },
  {
    id: 'privacy.review',
    category: 'PRIVACY',
    label: 'Privacy review',
    description: 'Privacy review',
    aliases: [],
    keywords: [],
    availability: 'UNAVAILABLE_WITH_REASON',
    reasonKey: 'commands.unavailable.privacy_review_offline',
    risk: 'WRITE',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_PRIVACY_FLOW', commandId: 'privacy.review' },
  },
];
const Probe = () => {
  const { locale, t } = useProductLocalization();
  return (
    <>
      <h1>{t('nav.home')}</h1>
      <output>{locale}</output>
      <p>{t('sources.title')}</p>
      <p>{t('source_detail.evidence')}</p>
      <p>{t('ask.question_draft')}</p>
      <p>{t('search.no_results')}</p>
      <p>{t('project.manage')}</p>
      <p>{t('ai.configure')}</p>
      <p>{t('privacy.review_title')}</p>
      <p>{t('technical.title')}</p>
      <p>{hfmOwnerLabel(t, 'askMode', 'SOURCE_EXPLORATION')}</p>
      <p>{hfmOwnerLabel(t, 'answerRun', 'FAILED')}</p>
      <p>{hfmOwnerLabel(t, 'sourceAskUsage', 'ACTION_REQUIRED')}</p>
      <p>{hfmOwnerLabel(t, 'mediaType', 'image/png')}</p>
      <p>{hfmOwnerLabel(t, 'transformationState', 'FUTURE_STATE')}</p>
      <p>JasonNote source content</p>
      <OwnerCommandPalette
        open
        commands={[command, ...unavailableCommands]}
        invoker={null}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    </>
  );
};

const runtime = (
  getPrincipalPreferences: ShotgunApiClient['getPrincipalPreferences'],
): AppRuntime => ({
  apiClient: { getPrincipalPreferences } as ShotgunApiClient,
  queryClient: createFrontendQueryClient(),
  sessionCycleState: createSessionCycleState(),
});

describe('ProductLocalizationProvider', () => {
  it('uses persisted ko-KR for owner labels and leaves source content unchanged', async () => {
    const appRuntime = runtime(
      vi.fn(async () => ({ preferences: { locale: 'ko-KR' }, revision: 1 })),
    );
    render(
      <AppProviders runtime={appRuntime}>
        <ProductLocalizationProvider principalId="principal-1">
          <MemoryRouter>
            <Probe />
          </MemoryRouter>
        </ProductLocalizationProvider>
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: '홈', level: 1 })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: '명령' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^전체 검색/ })).toBeTruthy();
    expect(screen.getByText('소스')).toBeTruthy();
    expect(screen.getByText('근거')).toBeTruthy();
    expect(screen.getByText('질문 초안')).toBeTruthy();
    expect(screen.getByText('선택한 프로젝트 범위에 결과가 없습니다.')).toBeTruthy();
    expect(screen.getByText('프로젝트 관리')).toBeTruthy();
    expect(screen.getAllByText('AI 구성').length).toBeGreaterThan(0);
    expect(screen.getAllByText('개인정보 검토').length).toBeGreaterThan(0);
    expect(screen.getByText('기술 정보')).toBeTruthy();
    expect(screen.getByText('선택한 소스 사용')).toBeTruthy();
    expect(screen.getByText('실패')).toBeTruthy();
    expect(screen.getByText('사용 전 확인 필요')).toBeTruthy();
    expect(screen.getByText('이미지')).toBeTruthy();
    expect(screen.getByText('처리 상태를 확인할 수 없음')).toBeTruthy();
    expect(screen.getByText('JasonNote source content')).toBeTruthy();
  });

  it('updates from the shared persisted-preferences cache without browser locale authority', async () => {
    const appRuntime = runtime(
      vi.fn(async () => ({ preferences: { locale: 'ko-KR' }, revision: 1 })),
    );
    render(
      <AppProviders runtime={appRuntime}>
        <ProductLocalizationProvider principalId="principal-1">
          <MemoryRouter>
            <Probe />
          </MemoryRouter>
        </ProductLocalizationProvider>
      </AppProviders>,
    );
    expect(await screen.findByText('ko-KR')).toBeTruthy();

    act(() => {
      appRuntime.queryClient.setQueryData(principalPreferencesQueryKey('principal-1'), {
        preferences: { locale: 'en-US' },
        revision: 2,
      });
    });

    expect(await screen.findByRole('heading', { name: 'Home', level: 1 })).toBeTruthy();
    expect(screen.getByText('en-US')).toBeTruthy();
  });

  it('falls back deterministically for unsupported persisted locale values', async () => {
    expect(resolveProductLocale('ja-JP')).toBe('en-US');
    expect(resolveProductLocale(undefined)).toBe('en-US');

    const appRuntime = runtime(
      vi.fn(async () => ({ preferences: { locale: 'ja-JP' }, revision: 1 })),
    );
    render(
      <AppProviders runtime={appRuntime}>
        <ProductLocalizationProvider principalId="principal-1">
          <MemoryRouter>
            <Probe />
          </MemoryRouter>
        </ProductLocalizationProvider>
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Home', level: 1 })).toBeTruthy();
    expect(screen.getByText('Use selected sources')).toBeTruthy();
    expect(screen.getByText('Processing status unavailable')).toBeTruthy();
  });
});
