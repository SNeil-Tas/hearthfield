import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5187',
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev -- --port 5187 --strictPort',
      url: 'http://127.0.0.1:5187',
      reuseExistingServer: false,
    },
    {
      command: 'npm run preview -- --port 4187 --strictPort',
      url: 'http://127.0.0.1:4187',
      reuseExistingServer: false,
    },
  ],
});
