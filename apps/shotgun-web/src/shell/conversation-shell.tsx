import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router';

import { decodeConversationCitationReturnTarget, type GlobalShellView } from '@shotgun/api-client';

import { RouteFocus } from '../app/route-focus.js';
import { OwnerCommandPalette } from '../commands/owner-command-palette.js';
import { useProductLocalization, hfmOwnerLabel } from '../localization/product-localization.js';
import {
  AskCenterWorkspace,
  AskShellConversationPane,
  AskShellGlobalComposer,
  useAskShell,
} from '../routes/ask-workspace.js';
import type { OwnerCommandController } from '../section3/global-tools.js';

const Glyph = ({ children }: { readonly children: ReactNode }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const readPins = (key: string): readonly string[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string').slice(0, 100)
      : [];
  } catch {
    return [];
  }
};

const ConversationSidebar = ({
  shell,
  controller,
  collapsed,
  onToggle,
}: {
  readonly shell: GlobalShellView;
  readonly controller: OwnerCommandController;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}) => {
  const { t } = useProductLocalization();
  const {
    workspace,
    activeConversationId,
    outcomeUnknown,
    answerRunMutationPending,
    answerRunOutcomeUnknown,
    isSubmitting,
  } = useAskShell();
  const pinKey = `shotgun:conversation-pins:v1:${shell.principalId}:${shell.activeProject?.id}`;
  const [pins, setPins] = useState(() => readPins(pinKey));
  const canStart =
    !outcomeUnknown && !answerRunMutationPending && !answerRunOutcomeUnknown && !isSubmitting;
  const available = (routeId: string) =>
    shell.navigation.find(
      (item) => item.targetRoute?.routeId === routeId && item.availability === 'AVAILABLE',
    );
  const search = controller.commands.find(
    (item) => item.id === 'search.global' && item.availability !== 'HIDDEN',
  );
  const conversations =
    workspace &&
    workspace.projectId === shell.activeProject?.id &&
    workspace.principalId === shell.principalId &&
    workspace.sessionId === shell.sessionId
      ? [...workspace.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      : [];
  const settings = [
    ['ai.configure', t('layout.ai_settings')],
    ['privacy.open', t('layout.privacy')],
    ['project.manage', t('layout.projects')],
  ].flatMap(([id, label]) => {
    const command = controller.commands.find(
      (item) => item.id === id && item.availability !== 'HIDDEN',
    );
    return command ? [{ command, label }] : [];
  });
  const tools = shell.navigation.filter(
    (item) =>
      item.targetRoute &&
      !['ask', 'sources'].includes(item.targetRoute.routeId) &&
      item.availability === 'AVAILABLE',
  );
  const togglePin = (id: string) => {
    const next = pins.includes(id) ? pins.filter((pin) => pin !== id) : [...pins, id].slice(-100);
    setPins(next);
    try {
      localStorage.setItem(pinKey, JSON.stringify(next));
    } catch {
      /* Pins still work for this mounted session. */
    }
  };
  const renderConversations = (pinned: boolean) => {
    const items = conversations.filter((item) => pins.includes(item.conversationId) === pinned);
    if (items.length === 0) return null;
    return (
      <section
        className="sidebar-conversations"
        aria-label={pinned ? t('layout.pinned') : t('layout.recent')}
      >
        <h2>{pinned ? t('layout.pinned') : t('layout.recent')}</h2>
        <ul>
          {items.map((item) => (
            <li key={item.conversationId}>
              <NavLink
                to={`/ask/conversations/${encodeURIComponent(item.conversationId)}`}
                onClick={(event) => {
                  if (!canStart) event.preventDefault();
                }}
                aria-disabled={!canStart}
                aria-current={item.conversationId === activeConversationId ? 'page' : undefined}
              >
                <span className="sidebar-conversation-title">{item.title}</span>
                {item.latestRunState !== 'SUCCEEDED' ? (
                  <small>{hfmOwnerLabel(t, 'answerRun', item.latestRunState)}</small>
                ) : null}
              </NavLink>
              <button
                className="conversation-pin icon-button"
                type="button"
                onClick={() => togglePin(item.conversationId)}
                aria-label={`${pinned ? t('layout.unpin') : t('layout.pin')}: ${item.title}`}
                aria-pressed={pinned}
                title={pinned ? t('layout.unpin') : t('layout.pin')}
              >
                <Glyph>
                  <path d="m8 3 8 0-1 6 3 3v2H6v-2l3-3zM12 14v7" />
                </Glyph>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  };
  return (
    <aside className="conversation-sidebar" data-global-shell-region="tree">
      <div className="sidebar-brand">
        <Link
          to="/ask"
          state={{ newConversation: true }}
          onClick={(event) => {
            if (!canStart) event.preventDefault();
          }}
          aria-label="Shotgun"
        >
          {collapsed ? 'S' : 'Shotgun'}
        </Link>
        <button
          className="icon-button sidebar-toggle"
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? t('layout.expand') : t('layout.collapse')}
          aria-expanded={!collapsed}
          aria-controls="conversation-sidebar-content"
        >
          <Glyph>
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="M9 4v16" />
          </Glyph>
        </button>
      </div>
      <div className="sidebar-content" id="conversation-sidebar-content" hidden={collapsed}>
        <nav className="sidebar-primary" aria-label={t('shell.primary_navigation')}>
          {available('ask') ? (
            <Link
              to="/ask"
              state={{ newConversation: true }}
              onClick={(event) => {
                if (!canStart) event.preventDefault();
              }}
              aria-disabled={!canStart}
            >
              <Glyph>
                <path d="M12 3v18M3 12h18" />
              </Glyph>
              {t('layout.new_chat')}
            </Link>
          ) : null}
          {search ? (
            <button
              type="button"
              disabled={search.availability !== 'AVAILABLE'}
              title={search.reason}
              onClick={(event) => controller.executeCommand(search, event.currentTarget)}
            >
              <Glyph>
                <circle cx="10.5" cy="10.5" r="7" />
                <path d="m16 16 5 5" />
              </Glyph>
              {t('layout.search')}
            </button>
          ) : null}
          {available('sources') ? (
            <NavLink to="/sources">
              <Glyph>
                <path d="M3 6h7l2 2h9v12H3zM3 6V4h7l2 2h9v2" />
              </Glyph>
              {t('layout.library')}
              {shell.sourceCount !== undefined ? <small>{shell.sourceCount}</small> : null}
            </NavLink>
          ) : null}
        </nav>
        <div className="sidebar-history">
          {renderConversations(true)}
          {renderConversations(false)}
          {conversations.length === 0 ? (
            <p className="sidebar-empty">{t('layout.empty_conversations')}</p>
          ) : null}
        </div>
        <div className="sidebar-footer">
          {shell.background.failedCount > 0 && available('activity')?.targetRoute ? (
            <Link className="sidebar-attention" to={available('activity')!.targetRoute!.href}>
              {t('layout.processing_issue')} · {shell.background.failedCount}
            </Link>
          ) : null}
          {tools.length > 0 ? (
            <details>
              <summary>{t('layout.tools')}</summary>
              <ul>
                {tools.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={item.targetRoute!.routeId === 'home' ? '/home' : item.targetRoute!.href}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <details>
            <summary>{t('layout.settings')}</summary>
            <ul>
              {settings.map(({ command, label }) => (
                <li key={command.id}>
                  <button
                    type="button"
                    disabled={command.availability !== 'AVAILABLE'}
                    title={command.reason}
                    onClick={(event) => controller.executeCommand(command, event.currentTarget)}
                  >
                    {label}
                  </button>
                </li>
              ))}
              <li>
                <Link to="/settings/preferences">{t('layout.preferences')}</Link>
              </li>
            </ul>
          </details>
        </div>
      </div>
    </aside>
  );
};

export const ConversationShell = ({
  shell,
  controller,
  offline,
}: {
  readonly shell: GlobalShellView;
  readonly controller: OwnerCommandController;
  readonly offline: boolean;
}) => {
  const { t } = useProductLocalization();
  const location = useLocation();
  const { sourceId } = useParams();
  const { workspace, activeConversationId } = useAskShell();
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const citationTarget = (() => {
    if (!sourceId || !location.pathname.startsWith('/sources/')) return undefined;
    try {
      const target = decodeConversationCitationReturnTarget(
        (location.state as { citationReturnTarget?: unknown } | null)?.citationReturnTarget,
      );
      if (
        target.sourceId !== sourceId ||
        new URLSearchParams(location.search).get('version') !== target.sourceVersionId
      )
        return undefined;
      return target;
    } catch {
      return undefined;
    }
  })();
  const conversationRoute = location.pathname === '/' || /^\/ask(?:\/|$)/.test(location.pathname);
  const showConversation = conversationRoute || citationTarget !== undefined;
  const selected = workspace?.selectedConversation;
  const title = showConversation
    ? (selected?.title ?? 'Shotgun')
    : location.pathname.startsWith('/sources')
      ? t('layout.library')
      : location.pathname.startsWith('/settings')
        ? t('layout.settings')
        : 'Shotgun';
  const scrollKey = showConversation
    ? `conversation:${activeConversationId ?? 'new'}`
    : location.pathname;
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = scrollPositions.current.get(scrollKey) ?? 0;
  }, [scrollKey]);
  const commandMode = controller.commandMode;
  const closeTarget = citationTarget
    ? {
        schemaVersion: citationTarget.schemaVersion,
        resourceKind: citationTarget.resourceKind,
        resourceId: citationTarget.resourceId,
        conversationId: citationTarget.conversationId,
        branchId: citationTarget.branchId,
        turnId: citationTarget.turnId,
        answerRunId: citationTarget.answerRunId,
        answerRevision: citationTarget.answerRevision,
        resourceRevision: citationTarget.resourceRevision,
        citationId: citationTarget.citationId,
        scrollAnchor: citationTarget.scrollAnchor,
        focusTarget: citationTarget.focusTarget,
        panelId: citationTarget.panelId,
      }
    : undefined;
  return (
    <div
      className={`conversation-shell${collapsed ? ' conversation-shell--collapsed' : ''}${citationTarget ? ' conversation-shell--evidence' : ''}`}
    >
      <ConversationSidebar
        key={`${shell.principalId}:${shell.sessionId}:${shell.activeProject?.id}`}
        shell={shell}
        controller={controller}
        collapsed={collapsed}
        onToggle={() => setCollapsed((current) => !current)}
      />
      <header className="conversation-header" data-global-shell-region="instrument">
        <p title={title}>{title}</p>
        {!showConversation && activeConversationId ? (
          <Link to={`/ask/conversations/${encodeURIComponent(activeConversationId)}`}>
            {t('layout.back_conversation')}
          </Link>
        ) : null}
        <button
          className="icon-button"
          type="button"
          onClick={(event) => controller.openCommandMode?.('', event.currentTarget)}
          aria-label={t('commands.title')}
          title="Ctrl+K"
        >
          <Glyph>
            <circle cx="5" cy="12" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
          </Glyph>
        </button>
      </header>
      {offline || shell.leadingWarning ? (
        <div
          className={`conversation-warning global-banner global-banner-${offline ? 'critical' : shell.leadingWarning!.severity.toLowerCase()}`}
          role={offline || shell.leadingWarning?.severity === 'CRITICAL' ? 'alert' : 'status'}
        >
          {offline ? t('shell.offline') : shell.leadingWarning!.message}
          {!offline && shell.leadingWarning!.additionalCount > 0
            ? ` (${shell.leadingWarning!.additionalCount} ${t('shell.additional_states')})`
            : ''}
        </div>
      ) : null}
      <main
        id="main-content"
        className={`conversation-main${showConversation ? ' conversation-main--chat' : ''}`}
        data-global-shell-region="center"
        ref={scrollRef}
        onScroll={(event) => scrollPositions.current.set(scrollKey, event.currentTarget.scrollTop)}
        tabIndex={-1}
      >
        <RouteFocus preserveScroll />
        {showConversation ? (
          <div className="conversation-reading-column" data-global-shell-region="conversation">
            {conversationRoute ? (
              <Outlet context={{ shell }} />
            ) : (
              <>
                <AskCenterWorkspace />
                <AskShellConversationPane showConversationList={false} />
              </>
            )}
          </div>
        ) : (
          <Outlet context={{ shell }} />
        )}
        <OwnerCommandPalette
          open={commandMode?.open ?? false}
          presentation="CENTER"
          commands={controller.commands}
          initialQuery={commandMode?.initialQuery ?? ''}
          resetQuerySignal={commandMode?.resetQuerySignal ?? 0}
          invoker={commandMode?.invoker ?? null}
          onClose={controller.closeCommandMode ?? (() => undefined)}
          onSelect={(command) => controller.executeCommand(command, commandMode?.invoker)}
        />
      </main>
      {citationTarget ? (
        <aside
          className="conversation-evidence"
          aria-label={t('layout.evidence')}
          data-global-shell-region="evidence"
        >
          <div className="evidence-panel-header">
            <strong>{t('layout.evidence')}</strong>
            <Link
              className="icon-button"
              to={citationTarget.originRoute}
              state={{ citationReturn: closeTarget }}
              aria-label={t('common.close')}
            >
              <span aria-hidden="true">×</span>
            </Link>
          </div>
          <Outlet context={{ shell }} />
        </aside>
      ) : null}
      <div className="conversation-composer" data-global-shell-region="composer">
        <AskShellGlobalComposer />
      </div>
    </div>
  );
};
