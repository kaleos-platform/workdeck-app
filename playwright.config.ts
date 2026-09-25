import { defineConfig, devices } from '@playwright/test'

const localOrigin = 'http://localhost:3100'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? localOrigin,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev -- --port 3100',
        url: localOrigin,
        env: {
          NEXT_PUBLIC_APP_URL: localOrigin,
          NEXT_PUBLIC_MARKETING_URL: localOrigin,
        },
        timeout: 120000,
      },
})
