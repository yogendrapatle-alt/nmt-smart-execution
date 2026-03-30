import { defineConfig, devices } from '@playwright/test';

/**
 * Config for testing against app on port 3000 (assumes server already running)
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'on',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'echo "Using existing server on port 3000"',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 5000,
  },
});
