# React Agent Runtime E2E

Date: 2026-06-12

## Changed

- Migrated the frontend to React 19, Vite 6, TypeScript, Tailwind CSS 4, Radix UI, React Router, TanStack Query, React Hook Form + Zod, Recharts and Lucide.
- Unified daemon storage default with FSDB/CLI and removed implicit fixture seeding.
- Added editable default prompts for all agents and backend `agent.chat`.
- Added deterministic E2E storage/ports, clean-state tests, agent tests and runtime evidence.
- Added task-modal assistant responses, assistant move/rename commands, per-column task creation and strict topbar/column-header compliance.
- Added Settings UI support for editing agent prompts, skills and token limits.
- Aligned React UI visual structure with `kanban-code-agent-mock-v4.html`, including light theme, segmented filters, horizontal board, rail tabs and mock-style cards.
- Added FSDB external-change watcher in the daemon and E2E coverage for direct `task.yaml` edits.
- Added feature parity audit against `kanban-code-agent-spec-v2.md` and visual diff evidence against `kanban-code-agent-mock-v4.html`.

## Files

- `apps/web/src/*`: React app, API client, board, assistant, task modal, settings and orchestrator components.
- `apps/daemon/src/server.js`: unified storage root, explicit fixture seeding flag and FSDB poller events.
- `packages/fsdb/src/index.js`: default agent prompts, task descriptions in snapshots and mock-aligned default column labels.
- `packages/orchestrator/src/index.js`: `agent.chat` command.
- `packages/pi-adapter/src/index.js`: fake adapter env and session timeout fallback.
- `tests/e2e/kanban.spec.js`: clean E2E coverage, drag/drop movement and FSDB watcher validation.
- `tests/unit/orchestrator.test.js`: default agent and assistant chat coverage.
- `.features/20260611-1906-kanban-code-agent-mvp/acceptance-audit.md`: current AC-by-AC audit.
- `current_state/kanban-code-agent/*`: runtime, feature parity and visual diff evidence.

## Validation

- `rtk pnpm lint`
- `rtk pnpm build`
- `rtk pnpm test:unit` (30 tests)
- `rtk pnpm test:e2e` (11 tests)
- Runtime screenshot: `current_state/kanban-code-agent/evidence/screenshots/board-runtime-1920x1080.png`
- Visual parity: `current_state/kanban-code-agent/evidence/visual-parity/visual-diff.json`
