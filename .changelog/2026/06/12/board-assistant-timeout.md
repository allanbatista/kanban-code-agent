# Board Assistant Timeout

Date: 2026-06-12

## Changed

- Added a configurable timeout for real Pi SDK board assistant prompts so `/api/command` `agent.chat` requests cannot hang indefinitely.

## Files

- `packages/pi-adapter/src/index.js`: wraps `session.prompt` with `KCA_BOARD_ASSISTANT_TIMEOUT_MS` timeout and returns a controlled timeout reply.
- `tests/unit/pi-adapter.test.js`: adds regression coverage with a hanging fake SDK.

## Validation

- `rtk pnpm test:unit`
- `rtk pnpm lint`
- HTTP probe: hanging `agent.chat` returned timeout reply in 95ms with `KCA_BOARD_ASSISTANT_TIMEOUT_MS=50`.
