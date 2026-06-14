# Provider Models Configured

Date: 2026-06-14

## Changed

- Allowed model listing for configured providers before they are enabled in settings.

## Files

- `packages/core/src/providers.js`: provider model queries now require provider configuration, not enabled/active status.
- `tests/unit/orchestrator.test.js`: covers configured-but-disabled provider model listing.

## Validation

- `rtk node --check packages/core/src/providers.js && rtk node --test --test-name-pattern "provider models query normalizes context metadata" tests/unit/orchestrator.test.js`
- `rtk pnpm --dir apps/web exec tsc -p tsconfig.json --noEmit`
- HTTP endpoint: `provider.models` for `deepseek` returned `count: 2`, `error: null`.
