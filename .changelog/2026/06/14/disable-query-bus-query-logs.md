# Disable Query Bus Query Logs

Date: 2026-06-14

## Changed

- Removed query start/done logs from the query bus.

## Files

- `packages/application/src/query-bus.js`: stops emitting `[query-bus] query.*` logs.

## Validation

- `rtk node --check packages/application/src/query-bus.js`
