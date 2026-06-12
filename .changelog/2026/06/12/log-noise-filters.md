# Log Noise Filters

Date: 2026-06-12

## Changed

- Hid FSDB logs by default unless `KCA_LOG_FSDB=1`.
- Hid daemon HTTP request logs by default unless `KCA_LOG_HTTP_REQUESTS=1`.

## Files

- `packages/core/src/log.js`: added scoped stdout log filters.

## Validation

- `rtk node --check packages/core/src/log.js`
- `rtk pnpm test:unit`
