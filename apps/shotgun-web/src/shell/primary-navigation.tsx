import { NavLink } from 'react-router';

const navigation = [
  ['/', 'Home'],
  ['/sources', 'Sources'],
  ['/ask', 'Ask'],
  ['/knowledge', 'Knowledge'],
  ['/review', 'Review'],
  ['/activity', 'Activity'],
  ['/history', 'History'],
  ['/settings', 'Settings'],
] as const;

export const PrimaryNavigation = () => (
  <nav className="primary-navigation" aria-label="주요 탐색">
    <ul>
      {navigation.map(([to, label]) => (
        <li key={to}>
          <NavLink to={to} end={to === '/'}>
            {({ isActive }) => <span aria-current={isActive ? 'page' : undefined}>{label}</span>}
          </NavLink>
        </li>
      ))}
    </ul>
  </nav>
);
