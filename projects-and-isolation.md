# Projects and Isolation

Status: implementado e validado em 2026-06-25.

Este documento é o contrato atual da feature. O plano executável e a trilha de
evidência ficam em `plan-projects-and-isolation.md`.

## Contrato de produto

- Projeto tem `slug`, `gitUrl`, `defaultBranch` e `autoMerge`.
- Task pode estar ligada a 0, 1 ou N projetos por `projectIds`.
- Task sem projeto mantém o fluxo anterior.
- Task com projeto roda em workspace próprio e, quando há `gitUrl`, em worktree
  Git dentro de `.swarm/tasks/<taskId>/workspace/<slug>/`.
- Worker nunca escreve no branch protegido; o Master faz merge serial por
  projeto.
- `inproc` é o modo padrão; `systemd` é opt-in por `SWARM_ISOLATION=systemd`.
- Credencial Git entra via `$CREDENTIALS_DIRECTORY/git-token` ou
  `SWARM_GIT_TOKEN`, usada por `GIT_ASKPASS`, sem gravar token no script,
  worktree, config Git ou erro.
- O gate de merge usa o estado `REVIEW`.

## Estado implementado

| Área | Estado | Evidência principal |
| --- | --- | --- |
| Projetos | `slug/gitUrl/defaultBranch/autoMerge`, storage em `.swarm/projects/<slug>/project.json`, migração de UUID e eventos `PROJECT_*` | `src/infrastructure/persistence/project-file-store.ts`, `src/application/orquestrator.ts`, testes de project store/API/replay |
| Task-projeto | `projectIds` em domínio, snapshot, replay, API e UI | `src/domain/task.ts`, `src/infrastructure/api/routes/tasks.ts`, `web/src/components/kanban/CreateTaskDialog.tsx` |
| Workspace | `workspace/` por task, com rejeição de traversal | `src/infrastructure/persistence/task-file-store.ts` |
| Git | mirror por projeto, worktree por task, branch `kca/<taskId>/integration`, commit, merge e cleanup | `src/infrastructure/git/git-repo.ts`, `src/application/orquestrator.ts` |
| Merge serial | lock em memória por projeto; Master é o único escritor do branch padrão | `src/application/orquestrator.ts`, `src/__tests__/application/git-worktree.test.ts` |
| Conflito | `MERGE_BLOCKED` + subtask de resolução | `src/application/orquestrator.ts` |
| Worker pool | concorrência real, fila N+1, cancel e timeout | `src/application/worker-pool.ts` |
| Isolamento | `inproc` e `systemd`; worker UDS com `/run`, `/cancel`, `/health`, `/events`; RPC mínimo de tools para o Master | `src/infrastructure/process/worker-supervisor.ts`, `src/worker/main.ts`, `src/worker/server.ts` |
| Credenciais | `$CREDENTIALS_DIRECTORY`, fallback env, `GIT_ASKPASS`, redaction e `LoadCredentialEncrypted` | `src/infrastructure/security/credentials.ts`, `src/infrastructure/git/git-repo.ts` |
| Gate | approve/reject em `REVIEW`; `autoMerge=true` pula gate humano | `src/infrastructure/api/routes/tasks.ts`, `web/src/components/kanban/TaskDrawer.tsx` |
| Docs/Graphify | docs de uso/software atualizadas; Graphify atualizado | `docs/usage/README.md`, `docs/software/README.md`, `graphify-out/` |

## Fluxo de execução

1. O usuário cria uma task, opcionalmente com `projectIds`.
2. O Master cria diretório da task e `workspace/`.
3. Para cada projeto com `gitUrl`, o Master garante o mirror em
   `.swarm/projects/<slug>/repo.git/` e cria worktree da task.
4. A run entra no `WorkerPool`, respeitando `SWARM_MAX_CONCURRENT_RUNS` e
   `SWARM_RUN_TIMEOUT_MS`.
5. Em `SWARM_ISOLATION=inproc`, o Master chama o `PiAgentClient` no processo
   atual.
6. Em `SWARM_ISOLATION=systemd`, o Master sobe um worker UDS com `systemd-run`,
   envia o config serializado por `/run` e expõe um socket de callback para as
   tools (`post_message`, `create_subtask`, `create_artifact`, validação de
   subtasks e `ask_human`).
7. O Worker executa o Pi SDK no `cwd` do workspace e chama as tools remotas
   quando necessário.
8. Ao concluir, o Master aplica a decisão, commita worktrees com mudanças e
   reconcilia branches de subtasks no branch de integração.
9. Se houver conflito, o Master emite `MERGE_BLOCKED` e cria subtask de
   resolução.
10. Manager root chega a `REVIEW` quando o DoD passa. Com `autoMerge=true`, o
    Master mergeia direto no branch padrão; caso contrário, o usuário aprova ou
    rejeita pelo gate.

## Isolamento systemd (histórico)

> **Substituído por Docker.** Nesta iteração o modo systemd foi **removido** do
> código; `SWARM_ISOLATION` aceita apenas `inproc` (default) e `docker`. O
> worker externo passou a rodar em container efêmero (`docker run --rm --init`),
> com mounts, limites de mem/CPU e segredos via `--env-file`. Ver o plano
> executável em `plan-agents-and-container-isolation.md` e a documentação de uso
> em `docs/usage/README.md` (seção "Isolamento Docker"). O restante deste
> documento descreve o corte anterior (projetos + isolamento, jun/2026) e é
> mantido como referência histórica.

## Credenciais Git

Ordem de resolução:

1. `$CREDENTIALS_DIRECTORY/git-token`
2. `SWARM_GIT_TOKEN`
3. `GIT_TOKEN`

O token vai para o Git por `GIT_ASKPASS`; o script lê `KCA_GIT_TOKEN` em runtime
e não contém o segredo. Erros Git passam por redaction antes de subir para o
orquestrador.

## Configuração

```yaml
runTimeoutMs: 300000
maxConcurrentRuns: 4
isolation: inproc
```

Envvars:

- `SWARM_RUN_TIMEOUT_MS`
- `SWARM_MAX_CONCURRENT_RUNS`
- `SWARM_ISOLATION=inproc|systemd`
- `SWARM_WORKER_MEMORY_MAX`
- `SWARM_WORKER_CPU_QUOTA`
- `SWARM_WORKER_HOLD_MS`
- `CREDENTIALS_DIRECTORY`
- `SWARM_GIT_TOKEN`

## Fora de escopo

- Vault externo.
- Multi-host.
- Estado `DEPLOY`.
- Plugin system de runtimes.
- Partial clone.

## Evidência final

- `rtk pnpm test`
- `rtk pnpm typecheck`
- `rtk pnpm lint`
- `rtk pnpm build`
- `rtk systemd-run --user --wait --collect true`
- smoke real: worker `src/worker/main.ts` sobe via `systemd-run` e responde
  `/health` no socket Unix.
- `rtk /home/allanbatista/Apps/bin/graphify-project-sync --update`
