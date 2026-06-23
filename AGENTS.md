# Kanban Code Agent

## Propósito

O **Kanban Code Agent** é uma plataforma de orquestração multi-agent para
trabalho de engenharia de software. O usuário cria uma *task* em um quadro
kanban web; um agente **Manager** recebe a task, a decompõe em subtasks e as
delega a agentes especializados — Produto, Architecture, Engineer,
CodeReviewer, QA e Generic — cada um executado sobre o SDK
`@earendil-works/pi-coding-agent` (Pi). O objetivo é deixar o usuário **criar,
delegar e observar todo o processo até a entrega** da task concluída, sem
acompanhar manualmente cada passo.

O sistema é **event-driven** e **event-sourced**: o event log append-only
(`.swarm/events/current.jsonl`) é a fonte da verdade e os snapshots são
projeções reconstruíveis. Isso garante que tudo seja **auditável e
rastreável** e que o estado sobreviva a reinícios e crashes (recuperação por
replay). A persistência usa **filesystem como banco de dados** (snapshot JSON,
event log NDJSON, chat e anexos por task), sem dependência de um SGBD externo.

As tasks seguem um ciclo de vida explícito
(`PENDING → QUEUED → RUNNING → WAITING → COMPLETED | FAILED | CANCELLED`),
com *wait groups* (`WAIT_ALL` e `ON_DEMAND`) para dependências entre subtasks,
retry com escalonamento automático de modelo/effort, e budget tracking de
tokens e custo por run. O **WorkerPool** controla concorrência, timeout e
cancelamento.

A interface web é um **kanban em tempo real** (React + Vite + shadcn/ui) que
atualiza via WebSocket (com fallback SSE), exibindo o board por status, o
detalhe da task (chat streaming, workflow de dependências, histórico, summary),
projetos e configurações.

O código segue **Clean Architecture em 3 camadas mais um entry point de CLI**:

- **Domain** (`src/domain/`) — entidades e eventos puros, sem dependências
  externas (Task, Agent, Run, SwarmEvent, WaitGroup, IDs).
- **Application** (`src/application/`) — casos de uso e orquestração com
  inversão de dependência (Orquestrator, Scheduler, WorkerPool, PiClient,
  PromptBuilder, DecisionParser, BudgetTracker).
- **Infrastructure** (`src/infrastructure/`) — adaptadores concretos de
  persistência, filesystem, rede e logging (EventStore, SnapshotStore,
  TaskFileStore, PathSandbox, AtomicWriter, Logger, AuditTrail, Config, API
  Fastify HTTP/WS/SSE).
- **CLI** (`src/cli/`) — entry points: modo `server` (API + UI) e modo `run`
  (task única).

Em resumo: um orquestrador resiliente que transforma um pedido em linguagem
natural numa árvore de subtasks executadas por agentes de IA, com observação
em tempo real e trilha de auditoria completa.

## Proof of Concept

Para a prova de conceito foi implementado uma arquitetura totalmente event driven em `./poc/index.ts` e a base do layout em `./poc/layout`.

## Documentação

- usage documentation: ./docs/usage/
- software documentation: ./docs/software/

## Rules

- Convention over configuration
- Utilize padroes de projeto, solid e event-driven.
- Sempre priorize consistência e resiliencia
- Utilize Stack node
- Tudo precisa ser auditável e rastreável
- Database as filesystem
- Configurações podem ser feitas via file ou envvar, sempre priorizando a envvar.
- Siga os guidelines de codificação em ./docs/software/CODE_GUIDELINE.md
- Utilize o graphify desde o começo. após grandes alterações, atualize o graphify com `graphify update`
