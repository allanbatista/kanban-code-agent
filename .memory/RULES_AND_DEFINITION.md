# Project Agent Workflow Rules

Follow the project instructions supplied for this workspace: use concise responses, read applicable AGENTS.md before implementation, prefix shell commands with `rtk`, create `.features/{YYYYMMDD-HHMM}-{feature-name}/plan.md` for complex/cross-cutting work, create `.changelog/{YYYY}/{MM}/{DD}/{feature-name}.md` after implementation code changes, record pending work in `.memory/TODO.md`, and finish task reports with the `task-completion-report` format.

# Product Ready Definition

For Kanban Code Agent, "pronto" means the user can start the application, create a task, and see the autonomous end-to-end flow working through integrated functionality: concurrent tasks, role-specific agents, filesystem persistence, global and task-scoped assistants, planning that creates N DAG subtasks, orchestrator-controlled semaphores, review, deployment, and visible runtime evidence. Tests, mock/fake-only behavior, static UI, or isolated commands do not count as product ready.
# Form List Inputs Use Multi Select

Todo input de form que represente uma lista simples deve ser implementado como multi select.

# Form Field Label Structure

Em toda UI, campos de formulario devem usar container `div.field` com `label htmlFor` associado ao controle por `id`. Use `label` envolvendo controle apenas para checkbox/radio simples. Campos compostos como multi-select, upload, grupos de botoes ou grupos de checkbox nao devem usar `label.field`; use `div.field` com `span`/`label` apropriado e associacoes explicitas quando houver controle principal.

# Agentic Workflow Blocking Semantics

No Kanban Code Agent, bloqueado deve significar que a task depende do usuário/humano. A coluna de bloqueio deve ser tratada como "Aguardando Humano". Quando uma task depende de outra persona/agent, ela deve ser movida para a coluna/responsabilidade dessa persona, não para bloqueado. Toda mensagem de agent no chat deve carregar persona.

# Agent Chat Context Isolation

O Kanban Code Agent possui dois chats distintos: o assistant da interface e o chat de execução da task por persona. Não existe compartilhamento implícito de contexto entre agents. Cada task por persona mantém um único chat ativo; quando ficar longo, o chat ativo deve ser compactado, preservado no histórico e substituído por um novo chat ativo que recebe a compactação como contexto.

# Provider Secrets via Envvars Only

Providers/modelos podem ser configurados por persona, incluindo provider, modelo e effort. API keys não devem ser cadastradas nem persistidas no app; o sistema deve apenas detectar envvars de provedores e instruir o usuário a configurá-las. Providers esperados incluem OpenAI, OpenRouter, OpenAI-compatible genérico e provedores OpenAI-compatible separados.

# Generalist Persona Routing

O Kanban Code Agent deve ter uma persona generalista. Toda próxima ação que não depender de engenheiro, alteração técnica profunda, worktree técnico ou decisão de engenharia deve ser roteada para a persona generalista. A generalista pode escalar para engenharia se descobrir dependência técnica real.

# Full Agentic E2E Validation

A validação final do workflow agentico deve cobrir o fluxo completo ponta a ponta: criar uma task, planejar, rotear por personas, executar, validar, revisar/deployar quando aplicável, e encerrar em Pronto com evidências persistidas, chats/personas e eventos verificáveis.

# Task Creation Requirements

Ao criar uma nova task, o único requisito é entender o que o usuário está pedindo. Prioridade e tipo de task não devem ser solicitados nem expostos como requisito. Se o usuário não indicar coluna/local, o padrão é entrada/inbox. O agent deve interpretar se o usuário forneceu título ou descrição; se for descrição, deve inferir um título. Se houver referência subjetiva sem contexto suficiente, deve pedir clarificação objetiva.

# Manager Task Triage and Prompt Sandbox

Novas tasks devem passar primeiro pelo manager, que decide a ação mais simples: responder por comentário quando bastar, pedir input humano, rotear para a persona correta, ou só então criar/usar sandbox/worktree. O escopo de segurança por enquanto é contrato de prompt: agents devem trabalhar via ferramentas KCA e dentro do sandbox/worktree indicado; isolamento forte de filesystem é dívida técnica.

# Optimistic Frontend Interactions

Frontend interactions should be optimistic by default: immediately update the visible UI for user actions such as moving cards, then reconcile with the backend response or rollback on failure.

# No BlockedBy Workflow

O Kanban Code Agent não deve usar `dependencies.blockedBy` como conceito ativo. Quando um agent precisar de informação humana, deve perguntar nos comentários e colocar a task `idle` em `human_wait`. Quando houver problema técnico, deve registrar comentário explicando o problema e enviar a task `queued` para `manager` triar. Comentários adicionados durante execução entram depois do run atual e reexecutam o mesmo agent.
