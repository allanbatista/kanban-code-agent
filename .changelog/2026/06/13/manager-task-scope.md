# Manager Task Scope

Date: 2026-06-13

## Changed

- Added `manager` as the default task triage column/role and default creation target.
- Added board migration for existing storage missing default columns.
- Documented prompt-only task worktree scope and recorded real filesystem sandboxing as debt.

## Files

- `packages/fsdb/src/index.js`: manager defaults, board migration, prompts, and task creation routing.
- `packages/core/src/roles.js`: task-scoped manager role.
- `apps/web/src/App.tsx`: default new task column.
- `packages/orchestrator/src/agent-chat-workflow-service.js`: assistant-created tasks default to manager.
- `packages/agent-runtime/src/index.js`: prompt-only filesystem scope context.
- `tests/unit/*`: updated manager/default/migration expectations.

## Validation

- `rtk proxy pnpm test:unit`
- `rtk proxy pnpm --filter @kca/web build`
- Browser snapshot confirmed `Manager` column renders between `Entrada` and `Produto`.
