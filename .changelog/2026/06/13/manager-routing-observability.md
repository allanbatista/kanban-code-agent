# Manager Routing Observability

Date: 2026-06-13

## Changed

- Added runtime manager routing classification, handoff tools, and visible structured log details.

## Files

- `packages/agent-runtime/src/index.js`: adds manager routing context, terminal-action guidance, and manager tool normalization.
- `packages/fsdb/src/index.js`: updates default manager tools/prompt and normalizes existing manager settings reads.
- `packages/core/src/roles.js`: aligns manager role tools/gate.
- `packages/pi-adapter/src/index.js`: preserves more structured provider text in transcript normalization.
- `apps/web/src/components/TaskModal.tsx`: shows structured log details from raw events.
- `apps/web/src/styles.css`: styles log detail blocks and keeps logs inside their tab space.
- `tests/unit/orchestrator.test.js`: covers direct research routing to `generalist`.

## Validation

- `rtk node --test --test-name-pattern "manager prompt classifies direct research" tests/unit/orchestrator.test.js`
- `rtk node --test tests/unit/pi-adapter.test.js`
- `rtk proxy pnpm --filter @kca/web typecheck`
- Browser validation at `http://127.0.0.1:15002/`, screenshot `/home/allanbatista/.agent-browser/tmp/screenshots/screenshot-1781382307351.png`
