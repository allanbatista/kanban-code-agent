import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const webPort = Number(process.env.KCA_WEB_PORT || 15001);
const webUrl = `http://127.0.0.1:${webPort}`;
const daemonPort = Number(process.env.KCA_E2E_DAEMON_PORT || 15000);
const daemonUrl = `http://127.0.0.1:${daemonPort}`;
const storageRoot = resolve(process.env.KCA_E2E_STORAGE_ROOT || "tmp/playwright-fsdb");
process.env.KCA_DAEMON_URL = daemonUrl;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: webUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  webServer: [
    {
      command: `VITE_KCA_DAEMON_URL=${daemonUrl} pnpm --filter @kca/web dev --port ${webPort}`,
      url: webUrl,
      reuseExistingServer: false,
      timeout: 60_000
    },
    {
      command: `rm -rf ${storageRoot} && KCA_STORAGE_ROOT=${storageRoot} KCA_DAEMON_PORT=${daemonPort} KCA_PI_ADAPTER=fake pnpm dev:daemon`,
      url: `${daemonUrl}/health`,
      reuseExistingServer: false,
      timeout: 60_000
    }
  ]
});
