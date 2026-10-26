import { defineConfig, devices } from '@playwright/test';

// Isolated UI contract fixture: no production backend, DB, assets or provider.
export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'conversation-layout.spec.ts',
  workers: 1,
  retries: 0,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5187',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm --workspace @shotgun/web run dev -- --port 5187',
    url: 'http://127.0.0.1:5187',
    reuseExistingServer: false,
    env: { VITE_BACKEND_TARGET: 'http://127.0.0.1:9' },
  },
});
