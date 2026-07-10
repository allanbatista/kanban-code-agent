# Projects and Isolation - implementation plan

## Contrato de produto

- Projetos têm `slug`, `gitUrl`, `defaultBranch` e `autoMerge`.
- Tasks podem estar ligadas a 0, 1 ou N projetos por `projectIds`.
- Task sem projeto mantém o fluxo atual.
- Task com projeto deve rodar em workspace isolado e, depois, em worktree Git.
- Worker nunca escreve no branch protegido; o Master faz o merge serial.
- `inproc` continua sendo o modo padrão; `systemd` é opt-in e validado por worker UDS.
- Credenciais Git não podem aparecer em log, chat, worktree, `.swarm` ou `git config`.
- O gate de merge usa o estado `REVIEW` existente.

## Plano executável

| Fase | Tarefa | Dono | Arquivos planejados | Arquivos reais | Evidência requerida | Evidência produzida | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | Migrar `ProjectData` para `slug/gitUrl/defaultBranch/autoMerge`, storage em `.swarm/projects/<slug>/project.json`, tombstones limpos | Codex | `src/infrastructure/persistence/project-file-store.ts` | `src/infrastructure/persistence/project-file-store.ts`, `src/__tests__/infrastructure/project-file-store.test.ts` | Testes de create/read/update/delete, slug único e migração de UUID | `rtk pnpm test -- ...` passou; suíte principal rodou 396 testes | Concluído |
| 0 | Atualizar API de projetos | Codex | `src/infrastructure/api/routes/projects.ts` | `src/infrastructure/api/routes/projects.ts`, `src/infrastructure/api/http-server.ts`, `src/__tests__/infrastructure/api/routes.test.ts` | Testes de payload válido/inválido | `rtk pnpm test` verde; rota cria projeto, cria task associada e rejeita projeto inexistente | Concluído |
| 0 | Adicionar `projectIds` em tasks | Codex | `src/domain/task.ts`, `src/domain/types.ts`, `src/application/orquestrator.ts`, `src/infrastructure/api/routes/tasks.ts` | `src/domain/task.ts`, `src/application/orquestrator.ts`, `src/infrastructure/api/routes/tasks.ts`, testes de domínio/aplicação | Round-trip preserva `projectIds`; subtasks herdam projetos do pai | `rtk pnpm test -- ...`, `rtk pnpm typecheck` verdes | Concluído |
| 0 | Atualizar UI para novos campos de projeto e remover associação por substring | Codex | `web/` | `web/src/components/projects/*`, `web/src/components/kanban/CreateTaskDialog.tsx`, `web/src/types/*`, `web/src/api/*`, stores/mocks/testes | Browser smoke criando projeto e mostrando/criando tasks por `projectIds` | `rtk proxy pnpm --dir web test -- CreateTaskDialog`, `rtk proxy pnpm --dir web build` e smoke browser criaram `task_137` com `projectIds:["smoke-event-project"]` | Concluído |
| 0 | Event-sourcear projetos e links task-projeto | Codex | `src/domain/types.ts`, persistence/snapshot | `src/domain/types.ts`, `src/application/orquestrator.ts`, `src/infrastructure/persistence/snapshot-store.ts`, `src/infrastructure/persistence/project-file-store.ts`, testes | Replay reconstrói projeto e link sem ler arquivo solto | `rtk pnpm test` verde; teste remove snapshot/projeção e reconstrói projeto + link pelo event log | Concluído |
| 0 | Formalizar `scope-spec.verification` | Codex | `src/infrastructure/persistence/task-file-store.ts`, `src/application/orquestrator.ts`, `src/application/prompt-builder.ts` | `src/infrastructure/persistence/task-file-store.ts`, `src/application/orquestrator.ts`, `src/application/prompt-builder.ts`, testes focados | Scope multi-item incompleto bloqueia `REVIEW` | Teste focado e `rtk pnpm typecheck` verdes; `rtk pnpm test` com 403 passed/1 skipped; `rtk pnpm lint` com 0 errors/2 warnings antigos | Concluído |
| 1 | Criar `workspace/` por task | Codex | `src/infrastructure/persistence/task-file-store.ts` | `src/infrastructure/persistence/task-file-store.ts`, `src/__tests__/infrastructure/task-file-store.test.ts` | Teste cria workspace e rejeita traversal | `rtk pnpm exec vitest run src/__tests__/application/orquestrator.test.ts src/__tests__/infrastructure/task-file-store.test.ts` verde; `rtk pnpm typecheck` verde | Concluído |
| 1 | Rodar agente a partir de `workspace/` | Codex | `src/application/orquestrator.ts`, `src/application/pi-client.ts` | `src/application/orquestrator.ts`, `src/application/pi-client.ts`, testes de orquestrador/e2e ajustados | Run recebe `cwd=workspace`; task sem projeto preservada | Teste `runs task without project from its workspace`; suíte focada de cwd/e2e com 96 passed; `rtk pnpm typecheck` verde | Concluído |
| 2 | Criar wrapper Git mínimo | Codex | `src/infrastructure/git/git-repo.ts` | `src/infrastructure/git/git-repo.ts`, `src/__tests__/infrastructure/git-repo.test.ts` | Repo temporário cobre mirror, worktree, commit e merge | `rtk pnpm exec vitest run src/__tests__/infrastructure/git-repo.test.ts src/__tests__/application/git-worktree.test.ts` verde | Concluído |
| 2 | Criar worktree/branch antes da run | Codex | `src/application/orquestrator.ts` | `src/application/orquestrator.ts`, `src/infrastructure/persistence/task-file-store.ts`, `src/__tests__/application/git-worktree.test.ts` | `WORKTREE_CREATED` com `baseSha` | Teste cria mirror/worktree em `workspace/<slug>` e emite `WORKTREE_CREATED` com `baseSha` | Concluído |
| 2 | Reconciliar subtasks em `kca/<taskId>/integration` | Codex | `src/application/orquestrator.ts`, `src/infrastructure/git/git-repo.ts` | `src/application/orquestrator.ts`, `src/infrastructure/git/git-repo.ts`, `src/__tests__/application/git-worktree.test.ts` | Duas subtasks viram branch de integração determinístico | Teste mergeia `task_2` e `task_3` em `kca/<taskId>/integration` e valida arquivos no branch | Concluído |
| 2 | Converter conflito em subtask de resolução | Codex | `src/application/orquestrator.ts` | `src/application/orquestrator.ts`, `src/__tests__/application/git-worktree.test.ts` | `MERGE_BLOCKED` + task `resolve-conflict` | Teste de conflito add/add emite `MERGE_BLOCKED{reason:conflict}` e cria subtask `Resolver conflito app` | Concluído |
| 2 | Merge final serial pelo Master | Codex | `src/application/orquestrator.ts`, `src/infrastructure/git/git-repo.ts` | `src/application/orquestrator.ts`, `src/infrastructure/git/git-repo.ts`, `src/__tests__/application/git-worktree.test.ts` | Duas tasks no mesmo projeto não escrevem em paralelo | Lock em memória por projeto; teste aprova task em `REVIEW`, mergeia integração em `main` e valida arquivos no branch padrão | Concluído |
| 2 | Limpar worktrees/branches antes de arquivar | Codex | `src/infrastructure/git/git-repo.ts`, `src/infrastructure/persistence/task-file-store.ts` | `src/application/orquestrator.ts`, `src/infrastructure/git/git-repo.ts`, `src/__tests__/application/git-worktree.test.ts` | Sem worktree/branch órfão após terminal | Teste arquiva task concluída e valida ausência de `workspace/<slug>` em `_archived` | Concluído |
| 3 | Criar Worker UDS com `node:http` | Codex | `src/worker/main.ts` | `src/worker/main.ts`, `src/worker/server.ts`, `src/__tests__/worker/server.test.ts` | `/run`, `/cancel`, `/health`, `/events` testados | `rtk pnpm test` verde; teste cobre health, run, cancel abortando run ativa e SSE ready | Concluído |
| 3 | Criar `WorkerSupervisor` `inproc` e `systemd` | Codex | `src/infrastructure/process/worker-supervisor.ts` | `src/infrastructure/process/worker-supervisor.ts`, `src/application/pi-client.ts`, `src/worker/main.ts`, `src/__tests__/infrastructure/worker-supervisor.test.ts` | `inproc` compatível; `systemd` skipa se indisponível | `inproc` executa via `PiAgentClient`; `systemd` usa worker UDS e RPC mínimo para tools; teste cobre pai + subtasks pelo supervisor `systemd`; smoke real de `/health` via `systemd-run` passou | Concluído |
| 3 | Adicionar `SWARM_ISOLATION=systemd|inproc` | Codex | `src/infrastructure/config.ts` | `src/infrastructure/config.ts`, `src/cli/orquestrator-factory.ts`, `docs/usage/README.md`, testes de config | Default `inproc`; env override | `rtk pnpm test` verde; `SWARM_ISOLATION=systemd` e `SWARM_MAX_CONCURRENT_RUNS` cobertos em teste | Concluído |
| 3 | Substituir run e repair pelo supervisor | Codex | `src/application/orquestrator.ts` | `src/application/orquestrator.ts`, `src/infrastructure/process/worker-supervisor.ts`, testes de orquestrador | Guard `activeRunId` preservado nos 3 pontos | `rtk pnpm test` verde; run normal, repair, cancel, retry e filas passam pelo supervisor em modo `inproc` | Concluído |
| 3 | Implementar concorrência e timeout reais | Codex | `src/application/orquestrator.ts`, `src/application/worker-pool.ts`, `src/infrastructure/config.ts` | `src/application/worker-pool.ts`, `src/application/orquestrator.ts`, `src/__tests__/application/worker-pool.test.ts`, `src/__tests__/application/orquestrator.test.ts` | N+1 enfileira; timeout aborta | `rtk pnpm test` verde; `WorkerPool` cobre fila, concorrência, timeout e cancel; orquestrador cobre `RUN_TIMEOUT` | Concluído |
| 3 | Aplicar limites systemd | Codex | `src/infrastructure/process/worker-supervisor.ts` | `src/infrastructure/process/worker-supervisor.ts`, `src/__tests__/infrastructure/worker-supervisor.test.ts` | `RuntimeMaxSec`, `ReadWritePaths` e cancel validados | Teste cobre args `RuntimeMaxSec`, `WorkingDirectory`, `MemoryMax`, `CPUQuota`, `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem`, `ReadWritePaths`, `LoadCredentialEncrypted`, stop da unit e worker/cancel por UDS | Concluído |
| 3 | Reconciliar restart sem duplicar run nem budget | Codex | `src/application/orquestrator.ts`, snapshot store | `src/application/orquestrator.ts`, testes e2e de resiliência/re-wait | Restart com run ativa não zera custo | `rtk pnpm test` verde; e2e de resiliência/replay/re-wait passa e `shutdown` devolve `QUEUED/RUNNING` para `PENDING` | Concluído |
| 4 | Resolver credencial por `$CREDENTIALS_DIRECTORY` e fallback env | Codex | `src/infrastructure/security/credentials.ts` | `src/infrastructure/security/credentials.ts`, `src/__tests__/infrastructure/credentials.test.ts` | Teste lê dir simulado; ausência tem erro claro | `rtk pnpm test` verde; teste cobre precedência de `CREDENTIALS_DIRECTORY`, fallback env e `MissingCredentialError` | Concluído |
| 4 | Integrar `LoadCredentialEncrypted` e `GIT_ASKPASS` | Codex | `worker-supervisor.ts`, `git-repo.ts` | `src/infrastructure/process/worker-supervisor.ts`, `src/infrastructure/git/git-repo.ts`, `src/infrastructure/security/credentials.ts`, testes | Push autenticado sem token em `git config` | Testes cobrem `GIT_ASKPASS`, env de push, ausência de token no script, redaction e args `LoadCredentialEncrypted`; remoto real fica dependente de credencial operacional | Concluído |
| 4 | Validar anti-vazamento | Codex | testes/smoke | `src/__tests__/infrastructure/credentials.test.ts`, `src/__tests__/infrastructure/git-repo.test.ts`, `src/infrastructure/git/git-repo.ts` | `grep -r <token> .swarm` vazio | Testes garantem token fora do script askpass, sem `git config` no push fake e erro Git redigido | Concluído |
| 5 | Endpoints approve/reject sobre `REVIEW` | Codex | `src/infrastructure/api/routes/tasks.ts` | `src/infrastructure/api/routes/tasks.ts`, `src/__tests__/infrastructure/api/routes.test.ts`, `web/src/api/client.ts`, `web/src/stores/kanbanStore.ts` | Approve mergeia; reject reabre com feedback | `rtk pnpm test` verde; teste HTTP aprova para `COMPLETED` e rejeita reabrindo com feedback | Concluído |
| 5 | Implementar `autoMerge` opt-in | Codex | `src/application/orquestrator.ts` | `src/application/orquestrator.ts`, `src/__tests__/application/git-worktree.test.ts` | `autoMerge=true` mergeia direto; `false` para em `REVIEW` | Teste `auto-merges Manager root when every linked project has autoMerge=true` passa; fluxo padrão permanece em `REVIEW` | Concluído |
| 5 | Atualizar UI do gate | Codex | `web/` | `web/src/components/kanban/TaskDrawer.tsx`, `web/src/api/client.ts`, `web/src/stores/kanbanStore.ts` | Browser aprova/rejeita task em `REVIEW` | `rtk pnpm build` verde; UI mostra `Aprovar`/`Rejeitar` em `REVIEW` e chama endpoints novos | Concluído |
| 6 | Atualizar documentação e Graphify | Codex | `docs/`, `graphify-out/` | `docs/usage/README.md`, `docs/software/README.md`, `graphify-out/*` | Docs atualizadas; `graphify update` | `rtk /home/allanbatista/Apps/bin/graphify-project-sync --update` verde; `graphify-out/graph.json` e `GRAPH_REPORT.md` atualizados | Concluído |

## Definition of Done

- Projeto com slug/git/branch é persistido e auditável.
- Task mantém `projectIds` em snapshot, replay, API e UI.
- Task com projeto roda em workspace/worktree próprio.
- Master é o único escritor do branch padrão.
- `inproc` permanece funcional em dev/CI.
- `systemd` aplica limites de tempo, recurso e path quando habilitado.
- Units transitórias `kca-*.service` são inspecionáveis com `SWARM_WORKER_HOLD_MS`.
- Token Git não vaza.
- Gate `REVIEW` controla merge quando `autoMerge=false`.
- Validação automatizada passa ou blocker fica registrado.
- Graphify é atualizado após mudanças estruturais.

## Validação final

- `rtk pnpm lint` — 0 erros; 2 warnings antigos em `src/infrastructure/api/middleware/error-handler.ts`.
- `rtk pnpm typecheck` — verde.
- `rtk pnpm test` — 38 arquivos, 422 testes passed, 1 skipped.
- `rtk pnpm build` — verde; Vite manteve warning antigo de chunk > 500 kB.
- `rtk systemd-run --user --wait --collect true` — verde.
- Smoke real: worker `src/worker/main.ts` subiu via `systemd-run`, respondeu `/health` em socket Unix e apareceu como unit transient ativa `kca-smoke-*.service`.
- `rtk /home/allanbatista/Apps/bin/graphify-project-sync --update` — verde; `graphify-out/graph.json` e `GRAPH_REPORT.md` atualizados.

## Decisões adiadas

- Vault externo.
- Multi-host.
- Estado `DEPLOY`.
- Plugin system de runtimes.
- Partial clone.
