# Task Modal Form Tabs

Date: 2026-06-12

## Changed

- Improved task modal fields, tabs, uploads, chat attachments, sizing, global text settings, modal input layout, form label structure, and board/chat height behavior.

## Files

- `apps/web/src/components/TaskModal.tsx`: updated summary form, multi-select projects, upload UI, and vertical task chat actions.
- `apps/web/src/components/AssistantPanel.tsx`: added assistant chat attachment UI.
- `apps/web/src/components/SettingsDialog.tsx`: added global text scale and font controls.
- `apps/web/src/components/Board.tsx`: removed type and priority chips from task cards and updated search label structure.
- `apps/web/src/App.tsx`: applies global text CSS settings on `documentElement` for portal modals, mapping `serif` to Slabo 13px and `sans-serif` to Arial/Helvetica.
- `apps/web/src/styles.css`: imports Slabo 13px and updates global typography, board/chat height containment, portal modals, modal inputs, dropdown, description height, attachment, settings, and main area layout styles.
- `apps/web/src/types.ts`: added task text UI settings.
- `CODE_RULES.md`: added form label structure rule.

## Validation

- `rtk pnpm lint`
