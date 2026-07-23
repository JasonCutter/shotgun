import { describe, expect, it } from 'vitest';

import { projectQueryKey } from '../../apps/shotgun-web/src/app/query-keys.js';

describe('Frontend project query keys', () => {
  it('isolates the same resource by project', () => {
    expect(projectQueryKey('principal-a', 'project-a', 'sources')).not.toEqual(
      projectQueryKey('principal-a', 'project-b', 'sources'),
    );
  });

  it('isolates the same project by principal', () => {
    expect(projectQueryKey('principal-a', 'project-a', 'sources')).not.toEqual(
      projectQueryKey('principal-b', 'project-a', 'sources'),
    );
  });
});
