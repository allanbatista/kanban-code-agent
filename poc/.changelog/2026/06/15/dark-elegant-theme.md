# Dark Elegant Theme

Date: 2026-06-15

## Changed

- Revisada paleta dark do layout com fundo navy/graphite, accent periwinkle e superfícies mais elegantes.
- Ajustadas cards, drawers, dialogs, kanban, projects, settings e workflow para melhor contraste e hierarquia visual.
- Atualizados README e estilos compartilhados do tema.

## Files

- `layout/src/index.css`: novos tokens, gradiente de fundo e seleção.
- `layout/src/components/ui/*`: surfaces e variants refinados.
- `layout/src/components/{layout,shared,kanban,projects,settings,workflow}/*`: páginas e componentes visualmente harmonizados.
- `layout/src/mocks/mockAgents.ts`: paleta de agentes alinhada ao tema.
- `README.md`: documentação do novo sistema visual e validação.

## Validation

- `cd layout && npm run build`
- `cd layout && npm run lint`
- Browser screenshots: `layout/screenshots/validation-home.png`, `layout/screenshots/validation-projects.png`, `layout/screenshots/validation-project-detail.png`, `layout/screenshots/validation-settings-appearance.png`, `layout/screenshots/validation-settings-providers.png`, `layout/screenshots/validation-settings-advanced.png`, `layout/screenshots/validation-drawer-workflow.png`
