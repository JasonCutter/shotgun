import { useMemo, type ReactNode } from 'react';
import { NavLink, useLocation, useParams } from 'react-router';

import type { GlobalShellView } from '@shotgun/api-client';

import type { OwnerCommandController } from '../section3/global-tools.js';

type NavigationItem = GlobalShellView['navigation'][number];

const isExplicitlyAvailable = (
  navigation: readonly NavigationItem[],
  routeId: string,
): NavigationItem | undefined =>
  navigation.find(
    (item) => item.targetRoute?.routeId === routeId && item.availability === 'AVAILABLE',
  );

const TreeLink = ({ to, children }: { readonly to: string; readonly children: ReactNode }) => (
  <NavLink to={to} end={to === '/'}>
    {({ isActive }) => <span aria-current={isActive ? 'page' : undefined}>{children}</span>}
  </NavLink>
);

const CommandTreeAction = ({
  commandId,
  controller,
  label,
}: {
  readonly commandId: string;
  readonly controller: OwnerCommandController;
  readonly label?: string;
}) => {
  const command = controller.commands.find((candidate) => candidate.id === commandId);
  if (!command || command.availability === 'HIDDEN') return null;
  return (
    <button
      className="tree-command"
      type="button"
      disabled={command.availability !== 'AVAILABLE'}
      title={command.reason}
      onClick={(event) => controller.executeCommand(command, event.currentTarget)}
    >
      {label ?? command.label}
    </button>
  );
};

const RouteTreeAction = ({
  route,
  controller,
  commandId,
  requireAvailableCommand = false,
}: {
  readonly route: NavigationItem;
  readonly controller: OwnerCommandController;
  readonly commandId?: string;
  readonly requireAvailableCommand?: boolean;
}) => {
  const command = commandId
    ? controller.commands.find((candidate) => candidate.id === commandId)
    : undefined;
  if (command?.availability === 'AVAILABLE') {
    return (
      <button
        className="tree-command"
        type="button"
        onClick={(event) => controller.executeCommand(command, event.currentTarget)}
      >
        {route.label}
      </button>
    );
  }
  if (requireAvailableCommand || !route.targetRoute) return null;
  return <TreeLink to={route.targetRoute.href}>{route.label}</TreeLink>;
};

const TreeGroup = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) => (
  <details className="tree-group" open>
    <summary>{label}</summary>
    <ul>{children}</ul>
  </details>
);

export const PrimaryNavigation = ({
  navigation,
  controller,
}: {
  readonly navigation: GlobalShellView['navigation'];
  readonly controller: OwnerCommandController;
}) => {
  const location = useLocation();
  const { sourceId } = useParams();
  const routes = useMemo(
    () => ({
      home: isExplicitlyAvailable(navigation, 'home'),
      sources: isExplicitlyAvailable(navigation, 'sources'),
      ask: isExplicitlyAvailable(navigation, 'ask'),
      knowledge: isExplicitlyAvailable(navigation, 'knowledge'),
      review: isExplicitlyAvailable(navigation, 'review'),
      externalAction: isExplicitlyAvailable(navigation, 'external-action'),
      activity: isExplicitlyAvailable(navigation, 'activity'),
      history: isExplicitlyAvailable(navigation, 'history'),
    }),
    [navigation],
  );
  const hasSettings = controller.commands.some(
    (command) =>
      ['ai.configure', 'privacy.open', 'project.manage'].includes(command.id) &&
      command.availability !== 'HIDDEN',
  );
  const isSourceDetail = Boolean(sourceId && location.pathname.startsWith('/sources/'));

  return (
    <nav className="primary-navigation" aria-label="Primary navigation">
      <ul className="tree-root">
        {routes.home?.targetRoute ? (
          <li>
            <TreeLink to={routes.home.targetRoute.href}>Home</TreeLink>
          </li>
        ) : null}
        {routes.sources ? (
          <li>
            <TreeGroup label="Sources">
              <li>
                <TreeLink to="/sources#source-library-heading">Library</TreeLink>
              </li>
              <li>
                <TreeLink to="/sources#source-intake-heading">Add Source</TreeLink>
              </li>
              {isSourceDetail ? (
                <li>
                  <TreeGroup label="Selected Source">
                    <li>
                      <a href="#source-preview-heading">Preview</a>
                    </li>
                    <li>
                      <a href="#source-evidence-heading">Evidence</a>
                    </li>
                    <li>
                      <a href="#source-version-heading">Versions</a>
                    </li>
                  </TreeGroup>
                </li>
              ) : null}
            </TreeGroup>
          </li>
        ) : null}
        {routes.ask ? (
          <li>
            <TreeGroup label="Ask">
              <li>
                <TreeLink to={routes.ask.targetRoute?.href ?? '/ask'}>Conversations</TreeLink>
              </li>
            </TreeGroup>
          </li>
        ) : null}
        <li>
          <CommandTreeAction commandId="search.global" controller={controller} />
        </li>
        {routes.knowledge ? (
          <li>
            <RouteTreeAction
              route={routes.knowledge}
              controller={controller}
              commandId="knowledge.open"
              requireAvailableCommand
            />
          </li>
        ) : null}
        {routes.review || routes.externalAction || routes.activity || routes.history ? (
          <li>
            <TreeGroup label="Operations">
              {routes.review ? (
                <li>
                  <RouteTreeAction
                    route={routes.review}
                    controller={controller}
                    commandId="review.open"
                    requireAvailableCommand
                  />
                </li>
              ) : null}
              {routes.externalAction ? (
                <li>
                  <RouteTreeAction
                    route={routes.externalAction}
                    controller={controller}
                    commandId="external_action.open"
                  />
                </li>
              ) : null}
              {routes.activity ? (
                <li>
                  <RouteTreeAction
                    route={routes.activity}
                    controller={controller}
                    commandId="activity.open"
                  />
                </li>
              ) : null}
              {routes.history ? (
                <li>
                  <RouteTreeAction
                    route={routes.history}
                    controller={controller}
                    commandId="history.open"
                  />
                </li>
              ) : null}
            </TreeGroup>
          </li>
        ) : null}
        {hasSettings ? (
          <li>
            <TreeGroup label="Settings">
              <li>
                <CommandTreeAction commandId="ai.configure" controller={controller} label="AI" />
              </li>
              <li>
                <CommandTreeAction
                  commandId="privacy.open"
                  controller={controller}
                  label="Privacy"
                />
              </li>
              <li>
                <TreeGroup label="Preferences">
                  <li>
                    <CommandTreeAction commandId="preferences.locale" controller={controller} />
                  </li>
                  <li>
                    <CommandTreeAction commandId="preferences.timezone" controller={controller} />
                  </li>
                  <li>
                    <CommandTreeAction commandId="preferences.display" controller={controller} />
                  </li>
                </TreeGroup>
              </li>
              <li>
                <CommandTreeAction
                  commandId="project.manage"
                  controller={controller}
                  label="Project"
                />
              </li>
            </TreeGroup>
          </li>
        ) : null}
      </ul>
    </nav>
  );
};
