# Agent Responsibilities

Date: 2026-06-13

## Changed

- Added canonical `architecture` role and removed legacy development agents from default canonical agents.
- Tightened manager routing so placeholder acceptance goes to product before execution, QA, or review.
- Clarified prompts for product, architecture, engineering, quality, review, and deployment responsibilities.
- Updated subtask decomposition to prefer `role` and normalize legacy agent aliases.

## Files

- `packages/core/src/roles.js`: added `architecture` to the canonical role registry.
- `packages/fsdb/src/index.js`: updated default columns, agents, prompts, tokens, and planning roles.
- `packages/agent-runtime/src/index.js`: added acceptance placeholder detection and routing context rules.
- `packages/orchestrator/src/task-decomposition-service.js`: normalized subtask roles.
- `tests/unit/orchestrator.test.js`: covered role defaults and manager routing behavior.
- `tests/e2e/kanban.spec.js`: updated browser validation for canonical agent labels and stable daemon commands.

## Validation

- `rtk pnpm test:unit`
- `rtk pnpm lint`
- `rtk pnpm test:e2e`
