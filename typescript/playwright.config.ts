import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5173',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: 'bun run --filter=@activity-calendar/server dev',
      port: 3000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'bun run --filter=@activity-calendar/client dev',
      port: 5173,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
