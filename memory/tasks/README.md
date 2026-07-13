# Tasks

## Responsabilidade

Mapear o ciclo de vida persistido das tasks e suas ações explícitas de usuário.

## Componentes

- [Ciclo de vida](./LIFECYCLE.md)

## Relações

```mermaid
flowchart LR
  Board[KanbanBoard] --> Store[kanbanStore.cancelTask]
  Store --> API[DELETE /api/tasks/:taskId]
  API --> Orc[Orquestrator.cancelTask]
  Orc --> Event[TASK_CANCELLED]
  Event --> Disk[EventStore e SnapshotStore]
  Disk --> Refresh[GET /api/tasks]
```

## Fontes no codigo

- `web/src/components/kanban/KanbanBoard.tsx`
- `web/src/stores/kanbanStore.ts`
- `src/infrastructure/api/routes/tasks.ts`
- `src/application/orquestrator.ts`
