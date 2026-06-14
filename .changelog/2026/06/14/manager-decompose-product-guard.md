# Manager Decompose Product Guard

Date: 2026-06-14

## Changed

- Redirected manager-originated decomposition to Product when manager routing says the product contract is missing.
- Preserved `runId` on `task.decompose` commands so runtime command policy can identify agent-originated tool calls.
- Added regression coverage for the KCA-884177 request shape.

## Files

- `packages/agent-runtime/src/index.js`: exports manager routing classification for runtime policy reuse.
- `packages/orchestrator/src/workflow-command-handlers.js`: redirects premature manager `task.decompose` calls to Product.
- `packages/schemas/src/index.js`: keeps optional `runId` on `task.decompose`.
- `tests/unit/orchestrator.test.js`: covers missing-product-contract decomposition redirect.

## Validation

- `rtk pnpm exec node --test --test-name-pattern "manager decomposition with missing product contract" tests/unit/orchestrator.test.js`
- `rtk env KCA_PI_ADAPTER=fake pnpm exec node --test --test-name-pattern "orchestrator decomposes a master task into queued subtasks|manager decomposition with missing product contract" tests/unit/orchestrator.test.js`
- `rtk env KCA_PI_ADAPTER=fake pnpm exec node --test --test-name-pattern "orchestrator decomposes a master task into N subtasks with DAG edges|orchestrator rejects invalid DAG decomposition" tests/unit/orchestrator.test.js`
- `rtk pnpm exec node --test tests/unit/schemas.test.js`
- `rtk pnpm exec node --test tests/unit/orchestrator-drain-policy.test.js`
- `rtk node --check packages/agent-runtime/src/index.js`
- `rtk node --check packages/orchestrator/src/workflow-command-handlers.js`
- `rtk node --check packages/schemas/src/index.js`
- `rtk node --check tests/unit/orchestrator.test.js`
