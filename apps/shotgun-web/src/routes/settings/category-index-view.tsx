import { Link } from 'react-router';

export const CategoryIndexView = () => {
  const categories = [
    {
      id: 'ai',
      label: 'AI',
      description: 'Configure active AI provider, model, credentials, and connection testing.',
      href: '/settings/ai',
    },
    {
      id: 'privacy',
      label: 'Privacy',
      description:
        'Review provider privacy status, external transfer permissions, and data retention.',
      href: '/settings/privacy',
    },
    {
      id: 'preferences',
      label: 'Preferences',
      description: 'Manage personal display preferences, locale, and timezone settings.',
      href: '/settings/preferences',
    },
    {
      id: 'projects',
      label: 'Project',
      description: 'View Project settings, rename, archive, or request project lifecycle actions.',
      href: '/settings/projects',
    },
  ];

  return (
    <section className="category-index-view">
      <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Settings Overview</h2>
      <p style={{ color: 'var(--muted)', marginBottom: '24px' }}>
        Select a primary settings category to view or update your configuration.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: '16px',
        }}
      >
        {categories.map((cat) => (
          <div
            key={cat.id}
            className="category-card"
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius)',
              padding: '16px',
              background: 'var(--surface)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '16px' }}>{cat.label}</h3>
              <p style={{ fontSize: '13px', color: 'var(--muted)', margin: '0 0 16px 0' }}>
                {cat.description}
              </p>
            </div>
            <Link
              to={cat.href}
              style={{
                display: 'inline-block',
                width: '100%',
                textAlign: 'center',
                padding: '8px 12px',
                background: 'var(--accent)',
                color: '#ffffff',
                borderRadius: 'var(--radius)',
                textDecoration: 'none',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              Open {cat.label}
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
};
