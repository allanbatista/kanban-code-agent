# Phase 5 - Frontend Integration

Date: 2026-06-16

## Changed

- Movei `poc/layout/` para `web/` como frontend oficial do monorepo
- Criei cliente HTTP (`web/src/api/client.ts`) com endpoints para tasks, agents, projects, settings, health
- Criei cliente WebSocket (`web/src/api/ws-client.ts`) com auto-reconnect exponencial e subscribe
- Criei adapters (`web/src/api/adapter.ts`) para transformar tipos da API em tipos da UI
- Reescrevi `kanbanStore` para consumir API real de tasks/agents com fetch, create, cancel
- Reescrevi `projectsStore` para consumir API real com fetch, create, update, delete
- Reescrevi `settingsStore` para consumir API real com fetch de appearance, advanced, providers
- Atualizei `App.tsx` para inicializar WebSocket e buscar dados iniciais ao montar
- Atualizei `KanbanBoard` para usar agents do store (sem mock `AGENTS`)
- Atualizei `CreateTaskDialog` para chamar `api.createTask` ao inves de mock
- Atualizei `Navbar` para buscar tasks do store no CommandDialog
- Atualizei `ProjectsGrid`, `ProjectDetail`, `ProjectDialog` para API real
- Atualizei `AppearanceSettings`, `AdvancedSettings`, `ProvidersSettings` para API real
- Atualizei `AgentConfigDialog` para usar providers do store
- Removi todas as importacoes de mocks (`@/mocks/*`) dos componentes
- Atualizei tipo `Project` para incluir `taskIds?: string[]`
- Adicionei tipos da API em `web/src/types/api.ts`

## Files

- `web/src/api/client.ts`: HTTP client para backend (tasks, agents, projects, settings, health)
- `web/src/api/ws-client.ts`: WebSocket client com reconnect exponencial
- `web/src/api/adapter.ts`: Transformadores API -> UI (tasks, agents, projects, settings, events)
- `web/src/types/api.ts`: Tipagem completa das respostas da API backend
- `web/src/stores/kanbanStore.ts`: Zustand store com fetchTasks, fetchAgents, createTask, cancelTask
- `web/src/stores/projectsStore.ts`: Zustand store com fetchProjects, createProject, updateProject, deleteProject
- `web/src/stores/settingsStore.ts`: Zustand store com fetchSettings, updateAppearance, updateAdvanced, saveSettings
- `web/src/App.tsx`: Inicializacao do WebSocket e fetch inicial
- `web/src/components/kanban/KanbanBoard.tsx`: Uso de agents do store
- `web/src/components/kanban/CreateTaskDialog.tsx`: Chamada a api.createTask
- `web/src/components/kanban/AgentConfigDialog.tsx`: Providers do store
- `web/src/components/kanban/RuntimeConfigSelector.tsx`: Constantes inline
- `web/src/components/layout/Navbar.tsx`: Tasks do store no CommandDialog
- `web/src/components/projects/ProjectsGrid.tsx`: API real com fetch, create, delete
- `web/src/components/projects/ProjectDetail.tsx`: API real com taskIds
- `web/src/components/projects/ProjectDialog.tsx`: API real com create/update assincronos
- `web/src/components/projects/ProjectCard.tsx`: Ajuste de location para tasks
- `web/src/components/settings/AppearanceSettings.tsx`: fetchSettings no mount
- `web/src/components/settings/AdvancedSettings.tsx`: fetchSettings no mount
- `web/src/components/settings/ProvidersSettings.tsx`: Dados do store
- `web/src/components/workflow/WorkflowView.tsx`: Cores/icones inline
- `web/src/types/project.ts`: Campo taskIds opcional

## Validation

- `cd web && pnpm install && pnpm run build` - build TypeScript + Vite concluido com sucesso
- Nenhum componente referencia mocks (`@/mocks/*`)
- dist/ gerado com index.html + assets
