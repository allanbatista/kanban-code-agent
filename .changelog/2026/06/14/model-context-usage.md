# Model Context Usage

Date: 2026-06-14

## Changed

- Cached OpenRouter model metadata at startup and used model context windows to calculate task `ctx`.
- Updated usage aggregation to compute `ctx` from latest input plus output tokens over the model context window.

## Files

- `packages/core/src/providers.js`: added OpenRouter model fetch normalization.
- `packages/fsdb/src/index.js`: added provider model cache and context-aware usage aggregation.
- `apps/daemon/src/server.js`: refreshes OpenRouter model cache on startup.
- `scripts/cache-openrouter-models.mjs`: added manual cache refresh script.
- `packages/pi-adapter/src/index.js`: emits usage context percent with the updated formula.

## Validation

- `rtk env KCA_PI_ADAPTER=fake node --test tests/unit/pi-adapter.test.js tests/unit/orchestrator.test.js`
- `rtk pnpm test:unit`
- `rtk pnpm run lint`
- `rtk pnpm cache:openrouter-models -- --root /tmp/kca-openrouter-cache-validation`
- HTTP validation: daemon `/health` and `/api/state` on temporary storage with OpenRouter cache containing `deepseek/deepseek-v4-pro` context `1048576`.
