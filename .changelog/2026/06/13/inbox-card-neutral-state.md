# Inbox Card Neutral State

Date: 2026-06-13

## Changed

- Cards in `Entrada` with idle status no longer show the `Fila` badge.
- Removed technical `role` and `parallel` metadata from board cards.

## Files

- `apps/web/src/components/Board.tsx`: simplifies card metadata display.

## Validation

- `rtk proxy pnpm --filter @kca/web build`
