import { NavLink } from 'react-router';

import type { GlobalShellView, NavigationAvailability } from '@shotgun/api-client';

import { useProductLocalization } from '../localization/product-localization.js';

const NavigationItems = ({ items }: { readonly items: GlobalShellView['navigation'] }) => {
  const { t } = useProductLocalization();
  const availabilityLabel: Record<NavigationAvailability, string> = {
    AVAILABLE: t('nav.available'),
    COMING_LATER: t('nav.coming_later'),
    TEMPORARILY_UNAVAILABLE: t('nav.temporarily_unavailable'),
    ACCESS_RESTRICTED: t('nav.access_restricted'),
    HIDDEN: 'Hidden',
  };
  const navigationLabel = (item: GlobalShellView['navigation'][number]) =>
    item.id === 'home'
      ? t('nav.home')
      : item.id === 'sources'
        ? t('nav.sources')
        : item.id === 'ask'
          ? t('nav.ask')
          : item.label;
  return (
    <>
      {items
        .filter((item) => item.availability !== 'HIDDEN')
        .map((item) => (
          <li key={item.id}>
            {item.availability === 'AVAILABLE' && item.targetRoute ? (
              <NavLink to={item.targetRoute.href} end={item.targetRoute.href === '/'}>
                {({ isActive }) => (
                  <span aria-current={isActive ? 'page' : undefined}>{navigationLabel(item)}</span>
                )}
              </NavLink>
            ) : (
              <span className="navigation-disabled" aria-disabled="true" title={item.reason}>
                {navigationLabel(item)}
                <small>{availabilityLabel[item.availability]}</small>
              </span>
            )}
          </li>
        ))}
    </>
  );
};

export const PrimaryNavigation = ({
  navigation,
}: {
  readonly navigation: GlobalShellView['navigation'];
}) => {
  const { t } = useProductLocalization();
  const visible = navigation.filter((item) => item.availability !== 'HIDDEN');
  return (
    <nav className="primary-navigation" aria-label={t('shell.primary_navigation')}>
      <ul>
        <NavigationItems items={visible} />
      </ul>
    </nav>
  );
};
