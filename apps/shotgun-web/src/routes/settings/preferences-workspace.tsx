import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppRuntime } from '../../app/providers.js';
import { sessionQueryOptions } from '../../session/session-query.js';
import { purgeSettingsScopedCaches } from '../../app/query-keys.js';

export const PreferencesWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const queryClient = useQueryClient();
  const { data: session } = useQuery(sessionQueryOptions(apiClient));

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['settings', 'preferences', session?.principal.id],
    queryFn: () => apiClient.getPrincipalPreferences(),
  });

  const [locale, setLocale] = useState('ko-KR');
  const [timezone, setTimezone] = useState('Asia/Seoul');
  const [dateDisplay, setDateDisplay] = useState('YYYY-MM-DD');
  const [screenDensity, setScreenDensity] = useState('COMFORTABLE');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (prefs) {
      if (typeof prefs.preferences['locale'] === 'string') setLocale(prefs.preferences['locale']);
      if (typeof prefs.preferences['timezone'] === 'string')
        setTimezone(prefs.preferences['timezone']);
      if (typeof prefs.preferences['dateDisplay'] === 'string')
        setDateDisplay(prefs.preferences['dateDisplay']);
      if (typeof prefs.preferences['screenDensity'] === 'string')
        setScreenDensity(prefs.preferences['screenDensity']);
      if (typeof prefs.preferences['reducedMotion'] === 'boolean')
        setReducedMotion(prefs.preferences['reducedMotion']);
    }
  }, [prefs]);

  const mutation = useMutation({
    mutationFn: (updated: Record<string, unknown>) => {
      const activeProjectId = session?.activeProject?.id;
      if (!activeProjectId) throw new Error('An active Project is required.');
      return apiClient.updatePrincipalPreferences({
        activeProjectId,
        targetProjectId: activeProjectId,
        resourceProjectId: activeProjectId,
        clientRequestId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        expectedPreferenceRevision: prefs?.revision ?? 0,
        preferences: updated,
      });
    },
    onSuccess: async () => {
      await purgeSettingsScopedCaches(queryClient);
      setSavedMessage('Preferences updated successfully.');
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedMessage(null);
    mutation.mutate({
      locale,
      timezone,
      dateDisplay,
      screenDensity,
      reducedMotion,
    });
  };

  if (isLoading) return <div>Loading user preferences...</div>;

  return (
    <section className="preferences-workspace">
      <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>User Preferences Workspace</h2>
      <p style={{ color: '#64748b', marginBottom: '20px' }}>
        Configure personal display options, regional settings, and accessibility choices.
      </p>

      {savedMessage && (
        <div
          className="success-banner"
          style={{
            padding: '12px',
            background: '#dcfce7',
            color: '#166534',
            borderRadius: '4px',
            marginBottom: '16px',
          }}
        >
          {savedMessage}
        </div>
      )}

      <form onSubmit={handleSave} style={{ display: 'grid', gap: '16px', maxWidth: '500px' }}>
        <div>
          <label
            htmlFor="pref-locale"
            style={{ display: 'block', fontWeight: 600, marginBottom: '4px' }}
          >
            Locale & Language
          </label>
          <select
            id="pref-locale"
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '4px',
              border: '1px solid #cbd5e1',
            }}
          >
            <option value="ko-KR">Korean (ko-KR)</option>
            <option value="en-US">English (en-US)</option>
            <option value="ja-JP">Japanese (ja-JP)</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="pref-timezone"
            style={{ display: 'block', fontWeight: 600, marginBottom: '4px' }}
          >
            Timezone
          </label>
          <select
            id="pref-timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '4px',
              border: '1px solid #cbd5e1',
            }}
          >
            <option value="Asia/Seoul">Asia/Seoul (KST)</option>
            <option value="UTC">UTC</option>
            <option value="America/New_York">America/New_York (EST)</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="pref-date-display"
            style={{ display: 'block', fontWeight: 600, marginBottom: '4px' }}
          >
            Date & Time Format
          </label>
          <select
            id="pref-date-display"
            value={dateDisplay}
            onChange={(e) => setDateDisplay(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '4px',
              border: '1px solid #cbd5e1',
            }}
          >
            <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="pref-density"
            style={{ display: 'block', fontWeight: 600, marginBottom: '4px' }}
          >
            Screen Density
          </label>
          <select
            id="pref-density"
            value={screenDensity}
            onChange={(e) => setScreenDensity(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '4px',
              border: '1px solid #cbd5e1',
            }}
          >
            <option value="COMFORTABLE">Comfortable</option>
            <option value="COMPACT">Compact</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            id="pref-reduced-motion"
            checked={reducedMotion}
            onChange={(e) => setReducedMotion(e.target.checked)}
          />
          <label htmlFor="pref-reduced-motion" style={{ fontWeight: 600 }}>
            Reduce Motion / Animations
          </label>
        </div>

        <button
          type="submit"
          disabled={mutation.isPending}
          style={{
            padding: '10px 20px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {mutation.isPending ? 'Saving...' : 'Save Preferences'}
        </button>
      </form>
    </section>
  );
};
