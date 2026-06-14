# Agent Response File Actions

Date: 2026-06-14

## Changed

- Added fixed agent response/artifact policy to runtime prompts and artifact tool guidance.
- Added task file metadata, safe file serving, and UI actions for opening text/images and downloading binaries.

## Files

- `packages/core/src/agent-response-policy.js`: shared fixed policy text.
- `packages/fsdb/src/index.js`: task file metadata and safe path helpers.
- `apps/daemon/src/server.js`: task file HTTP route.
- `apps/web/src/components/TaskModal.tsx`: action-aware task file list.

## Validation

- `rtk proxy pnpm --filter @kca/web typecheck`
- `rtk node --test tests/unit/pi-adapter.test.js --test-name-pattern ...`
- `rtk proxy bash -lc 'KCA_WEB_PORT=15101 KCA_E2E_DAEMON_PORT=15100 KCA_E2E_STORAGE_ROOT=tmp/playwright-file-actions pnpm exec playwright test tests/e2e/kanban.spec.js -g "task files open text and images inline and download binaries"'`
- Full orchestrator unit suite still has existing scheduler/assistant failures recorded in `.memory/TODO.md`.
