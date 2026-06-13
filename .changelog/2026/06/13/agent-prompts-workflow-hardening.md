# Agent Prompts Workflow Hardening

Date: 2026-06-13

## Changed

- Enforced task-agent tool allowlists, added non-terminal `run_command`, registered runs before prompt execution, deduped blocker comments, and expanded role prompts with benchmark-backed structure.

## Files

- `packages/agent-runtime/src/index.js`: registers run context before prompt and includes recent task chat in the effective prompt.
- `packages/pi-adapter/src/index.js`: filters task tools by allowed role tools and adds `run_command`.
- `packages/orchestrator/src/task-agent-workflow-service.js`: validates active run ownership, adds command execution evidence, and avoids duplicate blocker comments.
- `packages/orchestrator/src/workflow-command-handlers.js`: registers the `agent.run_command` workflow command.
- `packages/orchestrator/src/gate-service.js`: rejects stale review/deploy tool calls by run id.
- `packages/schemas/src/index.js`: adds `agent.run_command`, run ids on gate commands, and `agent.command` events.
- `packages/fsdb/src/chat-store.js`: dedupes repeated visible comments.
- `packages/fsdb/src/index.js`: updates default role prompts and tools.
- `packages/core/src/roles.js`: grants `run_command` to engineering, quality, and review roles.
- `tests/unit/orchestrator.test.js`: adds KCA-247658 regression coverage.

## Validation

- `rtk pnpm test:unit`
- `rtk pnpm lint`
- `rtk node ~/.codex/skills/feature-workflow/scripts/audit-feature-docs.mjs .features/20260613-1641-agent-prompts-workflow` passes with plan status `IN_PROGRESS`; final-status audit is deferred because unrelated pre-existing dirty files are outside this feature scope.
