# Remove BlockedBy Simplify Loop

Date: 2026-06-13

## Changed

- Removed `blockedBy` from active runnability and workflow writes.
- Human input requests now become visible comments and move tasks to `human_wait` as `idle`.
- Technical problems now create comments and route tasks to `manager` as `queued`.
- Comments added during a running agent are deferred and requeue the same agent after completion.
- Removed blocked-language UI affordances from board/orchestrator surfaces.

## Files

- `packages/orchestrator/src/*`: updated run, comment, human wait, merge, decomposition, and runnability flows.
- `packages/task-service/src/index.js`: routes problem states to manager and clears legacy `blockedBy`.
- `packages/fsdb/src/index.js`, `packages/pi-adapter/src/index.js`, `apps/web/src/*`: aligned prompts/tooling/UI language.
- `tests/unit/*`: updated and added coverage for simplified flow.

## Validation

- `rtk proxy pnpm test:unit`
- `rtk proxy pnpm --filter @kca/web build`
- Browser snapshot via `agent-browser` confirmed the board no longer shows the `Bloqueadas` filter.
