# Node Strip Types Compat

Date: 2026-06-15

## Changed

- Removed TypeScript parameter properties so `node index.ts` works in Node strip-only TypeScript mode.

## Files

- `index.ts`: replaces constructor parameter properties with explicit class fields.

## Validation

- `rtk yarn typecheck`
- `rtk node index.ts`
