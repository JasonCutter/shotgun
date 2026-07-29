import { NavLink } from 'react-router';

import type { GlobalShellView, NavigationAvailability } from '@shotgun/api-client';

const availabilityLabel: Record<NavigationAvailability, string> = {
  AVAILABLE: 'Available',
  COMING_LATER: 'Coming later',
  TEMPORARILY_UNAVAILABLE: 'Temporarily unavailable',
  ACCESS_RESTRICTED: 'Access restricted',
  HIDDEN: 'Hidden',
};

const NavigationItems = ({ items }: { readonly items: GlobalShellView['navigation'] }) => (
  <>
    {items
      .filter((item) => item.availability !== 'HIDDEN')
      .map((item) => (
        <li key={item.id}>
          {item.availability === 'AVAILABLE' && item.targetRoute ? (
            <NavLink to={item.targetRoute.href} end={item.targetRoute.href === '/'}>
              {({ isActive }) => (
                <span aria-current={isActive ? 'page' : undefined}>{item.label}</span>
              )}
            </NavLink>
          ) : (
            <span className="navigation-disabled" aria-disabled="true" title={item.reason}>
              {item.label}
              <small>{availabilityLabel[item.availability]}</small>
            </span>
          )}
        </li>
      ))}
  </>
);

export const PrimaryNavigation = ({
  navigation,
}: {
  readonly navigation: GlobalShellView['navigation'];
}) => {
  const visible = navigation.filter((item) => item.availability !== 'HIDDEN');
  const mobilePrimary = visible.slice(0, 4);
  const mobileMore = visible.slice(4);
  return (
    <>
      <nav className="primary-navigation" aria-label="Primary navigation">
        <ul>
          <NavigationItems items={visible} />
        </ul>
      </nav>
      <nav className="mobile-navigation" aria-label="Mobile navigation">
        <ul>
          <NavigationItems items={mobilePrimary} />
          {mobileMore.length > 0 ? (
            <li>
              <details>
                <summary>More</summary>
                <ul>
                  <NavigationItems items={mobileMore} />
                </ul>
              </details>
            </li>
          ) : null}
        </ul>
      </nav>
    </>
  );
};
