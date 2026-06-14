# Agent Driven Execution

Date: 2026-06-14

## Changed

- Removed coded routing/decomposition decisions so agents own routing and subtask creation.
- Required explicit agent-provided subtasks for decomposition and made direct Done completion executable.

## Files

- `packages/agent-runtime/src/index.js`: Removed manager routing context generation and exposed task-creation tools to agents.
- `packages/orchestrator/src/workflow-command-handlers.js`: Stopped redirecting manager decomposition to Product and stopped auto-gating Done moves.
- `packages/orchestrator/src/task-decomposition-service.js`: Removed fallback subtasks and failed invalid decomposition without rerouting.
- `packages/schemas/src/index.js`, `packages/pi-adapter/src/index.js`, `apps/cli/src/kca.js`: Enforced explicit subtask payloads in command/tool/CLI contracts.
- `packages/orchestrator/src/runnability-service.js`, `packages/orchestrator/src/task-agent-workflow-service.js`, `packages/task-service/src/index.js`, `packages/orchestrator/src/state-machine.js`: Kept readiness/failure handling mechanical and direct.
- `tests/unit/*`: Updated coverage for agent-driven execution behavior.

## Validation

- `rtk pnpm test:unit`
- `rtk pnpm lint`
- `rtk rg "managerRoutingContext|Manager Routing Context|managerRouting|task.decompose.redirected|manager_intake_requires_product|direct_task" packages tests -n`
