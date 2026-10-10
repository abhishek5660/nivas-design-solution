import { defineConfig } from '@playwright/test';

// E2E tests drive a real browser against a running app + database.
// Start everything with `npm run dev` (or `npm run build && npm start` with the DB running), then `npm run test:e2e`.
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
    channel: process.env.PW_CHANNEL ?? 'chrome', // use the installed Chrome; set PW_CHANNEL="" and run `npx playwright install chromium` otherwise
    headless: true,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    viewport: { width: 1500, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: process.env.NO_WEB_SERVER ? undefined : { command: 'node scripts/dev.mjs', url: 'http://localhost:3000/login', reuseExistingServer: true, timeout: 180_000 },
});
