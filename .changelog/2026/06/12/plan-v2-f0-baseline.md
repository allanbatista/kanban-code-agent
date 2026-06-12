# Plan V2 F0 Baseline

Date: 2026-06-12

## Changed

- Stabilized F0 baseline by making unit tests deterministic with fake Pi by default.
- Added opt-in Pi smoke test script and stricter assistant behavior assertions.
- Expanded `plan-v2.md` with product-ready clauses and marked F0 tasks validated.

## Files

- `package.json`: adds deterministic `test:unit` and opt-in `test:pi`.
- `tests/unit/orchestrator.test.js`: requires persisted assistant actions instead of accepting text-only replies.
- `tests/unit/pi-adapter.test.js`: skips real Pi smoke tests unless explicitly enabled.
- `tests/unit/fsdb-cli.test.js`: expects fake Pi doctor behavior during unit tests.
- `plan-v2.md`: records product-ready definition and F0 validation.
- `.memory/RULES_AND_DEFINITION.md`: records durable ready definition.
- `.memory/TODO.md`: records remaining v2 implementation debt.

## Validation

- `rtk pnpm lint`
- `rtk pnpm test:unit`
- `rtk pnpm test:pi`
