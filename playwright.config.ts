import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'MG_TEST_HOOKS=1 MG_CORS_ORIGIN=* PORT=8787 DATA_DIR=./server-data-e2e npx vite-node server/src/main.ts',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: true,
      timeout: 60000,
    },
    {
      command: 'VITE_API_BASE=http://127.0.0.1:8787 npm run build:test && npm run preview',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
});
