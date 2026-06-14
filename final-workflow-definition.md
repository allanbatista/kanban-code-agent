# Kanban Agent — Definição Final do Workflow

Data: 2026-06-14

Status: definição final proposta para implementação.

Base técnica investigada: `AGENTS.md`, `plan-v2.md`, `kanban-code-agent-spec-v2.md`, `apps/daemon`, `apps/web`, `packages/core`, `packages/schemas`, `packages/fsdb`, `packages/task-service`, `packages/board-service`, `packages/orchestrator`, `packages/agent-runtime`, `packages/pi-adapter`, `packages/git-worktree`, `tests/unit`, `tests/e2e`, `.memory/TODO.md`.

Benchmark externo consultado:

- Spec Kit docs: https://github.github.io/spec-kit/
- Spec Kit quickstart: https://github.github.io/spec-kit/quickstart.html
- Spec Kit SDD concept: https://github.github.io/spec-kit/concepts/sdd.html
- Spec Kit repo: https://github.com/github/spec-kit
- BMAD docs: https://docs.bmad-method.org/
- BMAD workflow map: https://docs.bmad-method.org/reference/workflow-map/
- BMAD agents: https://docs.bmad-method.org/reference/agents/
- BMAD core tools: https://docs.bmad-method.org/reference/core-tools/
- BMAD repo: https://github.com/bmad-code-org/BMAD-METHOD

## 1. Visão geral do produto

O Kanban Agent é uma aplicação local-first para transformar demandas do usuário em tasks executáveis por agentes especializados. O produto usa um board Kanban como interface operacional e um daemon local como orquestrador determinístico.

O problema central que ele resolve é a perda de controle em workflows agentic-driven: agentes tendem a pular de uma solicitação vaga para execução técnica sem especificação clara, sem rastreabilidade, sem validação e sem evidências. O Kanban Agent deve tornar esse processo explícito: uma task precisa ser entendida, especificada, planejada, executada, validada e entregue com histórico verificável.

Hoje o projeto já tem uma base real para isso:

- FSDB local em YAML/Markdown/JSONL em `packages/fsdb/src/index.js`.
- Tasks com `task.yaml`, `description.md`, `acceptance.md`, `planning.yaml`, `subtasks.yaml`, `events.jsonl` e artefatos.
- Papéis configuráveis em `packages/core/src/roles.js`.
- Schemas versionados em `packages/schemas/src/index.js`.
- Orquestração por comandos em `packages/orchestrator/src/workflow-command-handlers.js`.
- Runtime de agentes em `packages/agent-runtime/src/index.js`.
- Tools customizadas em `packages/pi-adapter/src/index.js`.
- UI com board, modal de task, chat, logs, arquivos e configurações em `apps/web/src`.

A lacuna principal é que o workflow ainda é mais “role-column-driven” e “prompt-driven” do que “spec-first-driven”. A produção exige gates formais, artefatos obrigatórios e bloqueios de sistema que impeçam execução técnica antes de uma especificação suficiente.

## 2. Experiência ideal do usuário

1. O usuário cria uma task pelo board, pelo modal ou pelo Assistant do board.
2. A task entra em `Inbox` como rascunho ou solicitação nova.
3. O Manager Agent recebe a task e faz triagem.
4. Antes de execução técnica, o Manager encaminha para o Product Agent quando a demanda requer produto, comportamento, escopo, aceite, arquitetura ou implementação.
5. O Product Agent transforma a demanda em uma Task Spec padronizada, identifica ambiguidades e pergunta ao usuário quando houver dúvida bloqueadora.
6. O Manager revisa a Task Spec contra o pedido original.
7. Quando a spec está pronta, a task entra em planejamento técnico.
8. O Manager decide se precisa de Architecture, Design, Engineering, QA, Review, Deployment, Documentation ou Generalist.
9. O Architecture/Design Agent produz plano técnico ou UX quando necessário.
10. O Manager cria subtasks se houver trabalho paralelizável.
11. Engineering implementa somente o escopo aprovado.
12. QA/Validation valida critérios de aceite com evidência concreta.
13. Review avalia diff, riscos e merge readiness.
14. Deployment executa ou registra release quando aplicável.
15. Documentation atualiza changelog/documentos quando a task exigir.
16. O usuário acompanha progresso no board, modal da task, chat, timeline, logs e artefatos.
17. A task só vai para `Done` quando houver entrega concreta, validação e evidências suficientes.

## 3. Papéis dos agentes

### Manager Agent

Responsável por:

- receber a task;
- entender objetivo e origem;
- acionar Product Agent antes de execução técnica;
- revisar a Task Spec;
- separar dúvidas bloqueadoras de não bloqueadoras;
- quebrar trabalho em subtasks quando necessário;
- escolher agentes executores;
- coordenar execução;
- acompanhar progresso;
- lidar com bloqueios;
- validar se as evidências existem antes de concluir;
- decidir próxima coluna/estado;
- manter rastreabilidade.

Estado atual: existe como role e agent default (`manager`) em `packages/core/src/roles.js` e `packages/fsdb/src/index.js`. O prompt atual permite triagem, delegação, subtasks e input humano. Problema: `managerRoutingContext` em `packages/agent-runtime/src/index.js` usa heurísticas por texto e ainda permite bypass do Product Agent em tarefas classificadas como diretas. Isso é útil para operações não técnicas, mas frágil para qualquer entrega de produto/código.

Regra final: o Manager nunca executa, implementa, valida ou conclui entrega técnica. Ele aplica gates e coordena agentes.

### Product Agent

Responsável por:

- transformar demanda em Task Spec;
- identificar ambiguidades;
- fazer perguntas ao usuário quando necessário;
- pesquisar informações externas quando útil;
- definir escopo;
- definir fora de escopo;
- definir critérios de aceite;
- definir comportamento esperado;
- definir riscos e dependências;
- produzir a Task Spec final.

Estado atual: existe como role e agent (`product`), com permissão para `request_user_input`, `emit_artifact` e `spawn_subtasks`. O prompt atual exige substituir `acceptance.md` placeholder. Problema: o artefato oficial ainda é `acceptance.md`, não uma Task Spec completa.

Regra final: Product Agent é o único dono da Task Spec. Outros agentes podem propor alterações, mas a spec só muda por Product Agent ou aprovação do Manager com registro de decisão.

### Engineering Agent

Responsável por:

- implementar mudanças técnicas;
- seguir a Task Spec e o Technical Plan;
- não alterar escopo por conta própria;
- reportar bloqueios;
- registrar arquivos alterados;
- explicar decisões técnicas objetivas;
- executar validação local relevante.

Estado atual: existe como role `engineering`, requer worktree e usa `complete_task`, `report_blocker`, `emit_artifact`, `run_command`. Problema: o sistema ainda aceita `complete_task` para qualquer `nextColumn`, e a UI permite completar manualmente.

Regra final: Engineering só pode concluir para QA/Validation quando houver evidência local. Não pode enviar direto para Done.

### QA/Validation Agent

Responsável por:

- validar critérios de aceite;
- testar comportamento;
- registrar evidências;
- apontar falhas;
- aprovar ou reprovar entrega.

Estado atual: existe como role `quality`, com prompt de validação e tools de comando. Problema: não há artefato obrigatório `validation-report.md` nem enforcement sistêmico de aceitação por critério.

Regra final: QA precisa mapear cada critério de aceite para evidência, resultado e status.

### Review Agent

Responsável por:

- revisar diff, segurança, manutenção e regressões;
- verificar se QA existe antes de merge/deploy;
- bloquear findings críticos;
- registrar decisão de merge readiness.

Estado atual: `reviewTaskGate` em `packages/orchestrator/src/gate-service.js` registra JSON e bloqueia apenas findings high/critical/blocking via `packages/orchestrator/src/review-service.js`.

Regra final: Review não substitui QA. Ele valida qualidade do código e readiness, não aceitação funcional.

### Documentation Agent

Responsável por:

- atualizar documentação;
- gerar changelog quando necessário;
- documentar decisões importantes;
- manter clareza para futuros agents.

Estado atual: não existe role explícita `documentation`; parte disso fica disperso entre `generalist`, prompts e regras do projeto. Deve ser criado como role opcional ou incorporado formalmente ao Generalist com gate próprio.

### Architecture Agent

Responsável por:

- definir plano técnico;
- explicitar contratos internos;
- mapear riscos;
- definir migrações, APIs, schemas e dependências;
- decompor trabalho quando houver paralelismo técnico.

Estado atual: existe como role `architecture`, requer worktree e pode criar subtasks.

### Design Agent

Responsável por:

- definir UX, fluxos, estados, acessibilidade e impacto visual;
- produzir handoff de UI antes de Engineering.

Estado atual: existe como role `design`, mas a UI final ainda não tem seção dedicada a design spec.

### Generalist Agent

Responsável por:

- tarefas operacionais não técnicas;
- pesquisa, sumarização, documentação simples e análise;
- completar direto em Done apenas quando não houver escopo de produto/código.

Estado atual: existe como role `generalist`.

## 4. Template oficial da Task Spec

O Product Agent deve gerar `task-spec.md` na pasta da task. `acceptance.md` pode continuar existindo como artefato derivado, mas não deve ser a fonte única de readiness.

Template oficial:

```md
# Task Spec

## 1. Título

## 2. Contexto

## 3. Problema a resolver

## 4. Objetivo final

## 5. Escopo

## 6. Fora de escopo

## 7. Usuários ou personas impactadas

## 8. Comportamento esperado

## 9. Fluxo esperado

## 10. Requisitos funcionais

## 11. Requisitos não funcionais

## 12. Critérios de aceite

## 13. Casos de teste esperados

## 14. Dependências

## 15. Riscos

## 16. Dúvidas em aberto

## 17. Decisões que precisam de confirmação do usuário

## 18. Definition of Ready

## 19. Definition of Done
```

Como preencher:

- `Título`: nome curto e específico da entrega.
- `Contexto`: origem da demanda, motivo e referências.
- `Problema a resolver`: dor ou falha atual.
- `Objetivo final`: resultado verificável do ponto de vista do usuário.
- `Escopo`: o que será entregue.
- `Fora de escopo`: o que explicitamente não será entregue.
- `Usuários ou personas impactadas`: usuário final, operador, agente, administrador ou desenvolvedor afetado.
- `Comportamento esperado`: comportamento observável após a entrega.
- `Fluxo esperado`: sequência de uso ou execução.
- `Requisitos funcionais`: capacidades obrigatórias.
- `Requisitos não funcionais`: performance, segurança, rastreabilidade, UX, compatibilidade, observabilidade.
- `Critérios de aceite`: checks verificáveis; nenhum critério pode ser subjetivo sem métrica.
- `Casos de teste esperados`: unidade, integração, e2e, browser, API, consumidor ou validação manual.
- `Dependências`: decisões, dados, credenciais, APIs, arquivos, módulos, tasks, contratos.
- `Riscos`: produto, técnico, segurança, dados, regressão, custo.
- `Dúvidas em aberto`: dúvidas não bloqueadoras ou informativas.
- `Decisões que precisam de confirmação do usuário`: apenas decisões subjetivas, destrutivas ou com trade-off relevante.
- `Definition of Ready`: checklist para permitir execução.
- `Definition of Done`: checklist para permitir conclusão.

## Benchmark: Spec Kit e BMAD

### Spec Kit

Resumo do conceito:

- Spec Kit é um toolkit de Spec-Driven Development.
- O processo central é Spec -> Plan -> Tasks -> Implement.
- A documentação oficial recomenda usar clarify, checklist e analyze como gates para trabalhos com ambiguidade relevante.
- Cada fase gera artefatos Markdown que alimentam a próxima fase.
- A filosofia é definir o “what” antes do “how” e refinar specs antes de implementar.

Pontos fortes:

- Força separação entre especificação, plano, tasks e implementação.
- Trata clarificação e análise como gates antes de código.
- Mantém artefatos persistentes por feature.
- Ajuda a reduzir prompt ad hoc e guessing.
- Tem templates, checklists e comandos de pré-requisito.

Pontos fracos ou limitações:

- Não resolve por si só orquestração multiagente em board local-first.
- Pode gerar overhead para tasks pequenas.
- A política de persistência/mutação de spec após mudanças não é totalmente prescrita.
- Não modela nativamente estados Kanban, worktrees, semáforos, hooks e agentes especializados do Kanban Agent.

Conceitos aplicáveis ao Kanban Agent:

- Spec-first workflow.
- Gates de clarificação antes de planejamento.
- Checklist de qualidade da spec.
- Análise de consistência entre spec, plano e tasks antes de execução.
- Artefatos obrigatórios por fase.
- Separação clara entre intenção do usuário, Product Spec, Technical Plan, Tasks e Implementação.

Conceitos que não devem ser aplicados:

- Copiar estrutura de diretórios `specs/<feature>` como fonte paralela ao FSDB. O Kanban Agent já tem `tasks/<task-id>`.
- Trocar o board por comandos slash como interface principal.
- Exigir fluxo pesado para toda ação operacional simples do board.

Adaptações recomendadas:

- Criar `task-spec.md`, `technical-plan.md`, `execution-plan.md`, `validation-report.md` dentro da pasta da task.
- Adicionar gates equivalentes a `clarify`, `checklist` e `analyze` como tools/estados do Kanban Agent.
- Guardar resultado de cada gate em `events.jsonl`.
- Exibir spec, plano, execução e validação como painéis do modal da task.

### BMAD / BMAD Method

Resumo do conceito:

- BMAD é uma metodologia/framework de desenvolvimento agentic-driven com agentes especializados.
- A documentação divide o fluxo em fases: Analysis, Planning, Solutioning e Implementation.
- Usa agentes como Analyst, PM, Architect, Developer, UX Designer e Technical Writer.
- Cada fase produz documentos que viram contexto para a próxima.
- O método enfatiza context engineering, workflows estruturados, elicitation, revisão adversarial e context management.

Pontos fortes:

- Define papéis especializados.
- Separa planejamento e execução.
- Usa artefatos intermediários como PRD, architecture, stories, decision logs e project context.
- Tem gates como implementation readiness.
- Trabalha melhor com handoffs explícitos.
- Valoriza elicitação e revisão antes de execução.

Pontos fracos ou limitações:

- É mais amplo que o Kanban Agent e pode ser pesado para o uso local-first atual.
- Nem todos os agentes BMAD são necessários.
- “Party mode” e múltiplas personas simultâneas podem poluir o workflow se usados como padrão.
- A estrutura BMAD não conhece nativamente FSDB, worktrees e comandos tipados do projeto.

Conceitos aplicáveis ao Kanban Agent:

- Product/PM antes de execução.
- Architecture antes de Engineering quando houver risco técnico.
- QA e Review como papéis separados.
- Documentation/Technical Writer como responsabilidade explícita.
- Implementation readiness gate.
- Decision log.
- Context artifact progressivo.
- Correct course quando spec e implementação entram em conflito.

Conceitos que não devem ser aplicados:

- Criar 12+ agentes por padrão.
- Exigir Analysis completa para bugs objetivos.
- Usar debate multiagente como caminho padrão de execução.
- Duplicar PRD/epics/stories fora da task sem sincronização.

Adaptações recomendadas:

- Manter os papéis já existentes e adicionar Documentation formal.
- Usar Manager como orquestrador equivalente a Scrum Master/PM operacional.
- Usar Product Agent como dono de Task Spec, não como executor técnico.
- Usar Architecture Agent como gate apenas quando há impacto de contratos, schema, API, infra, migração ou arquitetura.
- Adicionar `decision-log.md` por task.

### Síntese do benchmark

O Kanban Agent deve incorporar:

- Spec-first obrigatório para entregas de produto/código.
- Separação Product Spec, Technical Plan, Execution e Validation.
- Gates de readiness entre fases.
- Handoffs estruturados.
- Critérios de aceite verificáveis.
- Decision log por task.
- Validação antes de Done.
- Artefatos persistentes e visíveis.

O Kanban Agent deve evitar:

- Workflow pesado para tasks triviais.
- Estados duplicados entre coluna, role e status.
- Agentes tomando decisões subjetivas sem usuário.
- Conclusão textual sem tool terminal.
- Done sem evidência.

Como esses conceitos alteram o workflow final:

- As colunas atuais por role deixam de ser o contrato principal de estado.
- A task passa a ter gates formais derivados de artefatos.
- Manager deve sempre acionar Product para qualquer entrega técnica/funcional sem spec.
- `acceptance.md` deixa de ser suficiente; precisa haver Task Spec.
- UI deve mostrar progresso por fase e não só por coluna/status.

## 5. Workflow final da task

Workflow final:

1. `Inbox`: task criada ou rascunho salvo.
2. `Needs Spec`: Manager identificou que a task exige Product Spec.
3. `Spec In Progress`: Product Agent está produzindo `task-spec.md`.
4. `Waiting User Clarification`: existe dúvida bloqueadora.
5. `Ready for Planning`: spec suficiente e DoR de produto atendido.
6. `Planning`: Manager/Architecture/Design definem plano técnico, UX e execução.
7. `Ready for Execution`: Technical Plan aprovado.
8. `In Progress`: Engineering ou outros agentes executam.
9. `In Review`: QA/Validation e Review validam.
10. `Validation Failed`: QA ou Review reprovou.
11. `Blocked`: execução não pode continuar por falha, dependência ou tool.
12. `Cancelled`: usuário cancelou.
13. `Done`: entrega validada com evidências.

Quem move:

- Usuário pode mover manualmente, mas ações destrutivas ou durante execução exigem confirmação.
- Manager move por decisão operacional.
- Product move apenas para estados de spec/readiness.
- Engineering move para QA/Validation, nunca Done.
- QA move para Review ou Validation Failed.
- Review move para Deployment, Done ou Engineering.
- Deployment move para Done ou Blocked.

Quando o Manager interrompe execução:

- Task não tem Task Spec.
- Critério de aceite falta ou é subjetivo.
- Agente tenta executar fora de escopo.
- Usuário move manualmente a task durante run.
- Spec e implementação entram em conflito.
- Validação reprova.

Quando pedir confirmação:

- Decisão subjetiva ou com trade-off de produto.
- Ação destrutiva.
- Mudança de contrato público.
- Remoção de funcionalidade.
- Mudança de dados persistidos.
- Execução/deploy com risco real.

Quando delegar:

- Product: falta spec, escopo, aceite ou decisão de produto.
- Design: impacto em UI/UX.
- Architecture: API, schema, migração, integrações, arquitetura, locks, worktree complexa.
- Engineering: implementação pronta para execução.
- QA: entrega precisa validar aceite.
- Review: há diff/código pronto.
- Deployment: release/deploy configurado.
- Documentation: docs/changelog/decisões.

## 6. Estados/colunas recomendados

### Inbox

- Propósito: entrada ou rascunho.
- Entrada: task criada.
- Saída: Manager triage ou cancelamento.
- Responsável: usuário/Manager.
- Hooks: gerar título, validar intenção mínima.
- Condição: descrição minimamente acionável ou pergunta ao usuário.

### Needs Spec

- Propósito: indicar que falta Product Spec.
- Entrada: Manager triage.
- Saída: Spec In Progress.
- Responsável: Manager.
- Hooks: criar `task-spec.md` placeholder.
- Condição: demanda exige produto/código ou contém ambiguidade.

### Spec In Progress

- Propósito: Product Agent produz spec.
- Entrada: Product Agent iniciado.
- Saída: Ready for Planning ou Waiting User Clarification.
- Responsável: Product.
- Hooks: spec checklist.
- Condição: `task-spec.md` completo.

### Waiting User Clarification

- Propósito: aguardar decisão humana.
- Entrada: dúvida bloqueadora.
- Saída: Spec In Progress, Planning, In Progress ou Cancelled.
- Responsável: usuário + agente solicitante.
- Hooks: resumir blocker.
- Condição: resposta recebida.

### Ready for Planning

- Propósito: spec pronta para plano.
- Entrada: Product finaliza spec.
- Saída: Planning.
- Responsável: Manager.
- Hooks: DoR check.
- Condição: objetivos, escopo e aceite claros.

### Planning

- Propósito: definir Technical Plan e subtasks.
- Entrada: Manager/Architecture/Design.
- Saída: Ready for Execution ou Waiting User Clarification.
- Responsável: Manager/Architecture/Design.
- Hooks: analyze spec-plan consistency.
- Condição: plano técnico implementável.

### Ready for Execution

- Propósito: execução liberada.
- Entrada: plano aprovado.
- Saída: In Progress.
- Responsável: Manager.
- Hooks: criar worktree, validar provider, locks/semaphores.
- Condição: agente executor definido.

### In Progress

- Propósito: execução técnica ou operacional.
- Entrada: scheduler inicia run.
- Saída: In Review, Blocked, Waiting User Clarification.
- Responsável: executor.
- Hooks: logs, command evidence, retry policy.
- Condição: entrega feita ou bloqueio.

### In Review

- Propósito: QA, Review e Deployment quando aplicável.
- Entrada: Engineering conclui.
- Saída: Done, Validation Failed, Blocked.
- Responsável: QA/Review/Deployment.
- Hooks: validation report, review gate, deploy gate.
- Condição: evidência suficiente.

### Validation Failed

- Propósito: reprovação de QA/review.
- Entrada: falha validada.
- Saída: Planning ou In Progress.
- Responsável: Manager.
- Hooks: gerar reprodução e owner.
- Condição: falha endereçada.

### Done

- Propósito: entrega concluída.
- Entrada: DoD satisfeito.
- Saída: reabertura apenas por ação explícita.
- Responsável: Manager.
- Hooks: final summary, changelog/doc check.
- Condição: evidências registradas.

### Blocked

- Propósito: bloqueio operacional/técnico.
- Entrada: tool error, falta contexto, dependência.
- Saída: estado anterior ou Waiting User Clarification.
- Responsável: Manager.
- Hooks: blocker summary.
- Condição: blocker resolvido.

### Cancelled

- Propósito: tarefa encerrada sem entrega.
- Entrada: usuário cancela ou Manager decide por obsolescência.
- Saída: reabertura explícita.
- Responsável: usuário/Manager.
- Hooks: cancel reason.
- Condição: motivo registrado.

## 7. Tools necessárias

### Tools existentes boas

| Tool | Objetivo | Agente | Input | Output | Efeitos | Limitações |
|---|---|---|---|---|---|---|
| `complete_task` | concluir etapa e mover fluxo | agentes de task | `nextColumn`, `summary` | task atualizada | muda estado | precisa gate para impedir Done indevido |
| `request_user_input` | pedir input humano | Manager/Product/outros | pergunta | `human_wait` | pausa task | não tipa dúvida bloqueadora vs não bloqueadora |
| `report_blocker` | reportar problema ao Manager | todos | blocker | task ao Manager | registra blocker | não classifica severidade |
| `emit_artifact` | persistir artefato | todos autorizados | path/content | arquivo | escreve FSDB | paths livres demais |
| `spawn_subtasks` | criar subtasks DAG | Manager/Product/Architecture | subtasks | tasks filhas | cria tasks | não exige spec/plan readiness |
| `run_command` | executar validação/evidência | Engineering/QA/Review/Generalist | command/args/cwd | stdout/stderr | comando local | não substitui sandbox real |
| `wait_for_persona` | handoff de role | Manager e afins | target/question | task roteada | muda role/coluna | handoff não é artefato estruturado |
| `delegate_task` | criar subtask delegada | Manager | persona/request | subtask | cria child | pode fragmentar contexto |
| `review_task` | registrar review gate | Review | findings/evidence | pass/fail | escreve JSON | lógica atual é simples |
| `deploy_task` | registrar deploy | Deployment | command/rollback | JSON + Done | pode executar command | hoje manda Done automaticamente |

### Tools existentes a refinar

- `complete_task`: bloquear `nextColumn=done` se DoD não estiver satisfeito.
- `request_user_input`: exigir `questionType`, `blocking`, `options`, `decisionImpact`.
- `emit_artifact`: validar artefatos oficiais (`task-spec.md`, `technical-plan.md`, `validation-report.md`, `decision-log.md`).
- `task.decompose`: exigir Task Spec e plano antes de subtasks técnicas.
- `task.move`: confirmar movimento manual durante execução e registrar invalidação.
- `deploy_task`: não concluir automaticamente; precisa approval e deployment result.
- Hooks: executar agentes ou commands reais conforme policy, não apenas noop.

### Tools ausentes

| Tool | Objetivo | Agente | Input | Output | Efeitos | Quando usar |
|---|---|---|---|---|---|---|
| `create_task_spec` | criar spec oficial | Product | template preenchido | `task-spec.md` | escreve spec | toda entrega técnica/produto |
| `approve_task_spec` | aprovar spec | Manager/usuário | spec version | gate passed | muda readiness | antes de planning |
| `create_technical_plan` | criar plano técnico | Architecture/Manager | approach/tasks | `technical-plan.md` | escreve plano | antes de Engineering |
| `approve_plan` | liberar execução | Manager | plan version | gate passed | muda readiness | antes de In Progress |
| `record_handoff` | registrar handoff | todos | from/to/context | `handoffs/*.md/json` | evento + artefato | toda troca de agente |
| `record_decision` | decision log | Manager/Product/Architecture | decisão/razão | `decision-log.md` | append | decisões relevantes |
| `record_validation` | mapear aceite -> evidência | QA | critérios/evidência | `validation-report.md` | gate | antes de Review/Done |
| `set_gate_status` | gate determinístico | orchestrator | gate/status | task atualizado | bloqueia/libera | todos gates |
| `pause_task` | pausar sem cancelar | usuário/Manager | reason | paused | pausa | intervenção humana |
| `resume_task` | retomar task | usuário/Manager | reason | queued | retoma | após pausa/blocker |
| `cancel_task` | cancelar | usuário/Manager | reason | cancelled | encerra | escopo abandonado |
| `retry_task` | retry controlado | Manager | policy/reason | new run | reexecuta | tool/agent failure |
| `request_user_confirmation` | pedir aprovação explícita | Manager/Product | decisão/opções | aprovação | pausa | decisão subjetiva/destrutiva |

### Tools a remover ou simplificar

- Botão UI `Completar` direto para Done.
- `acceptance.md` placeholder como prova de readiness.
- `deploy_task` auto-Done.
- Colunas por role como única representação de workflow.

## 8. Responsabilidades do Manager

O Manager deve operar com estas regras:

- Nunca executar antes da spec para entrega técnica/produto.
- Nunca assumir subjetividade.
- Sempre registrar decisões relevantes.
- Sempre validar existência de Task Spec antes de planejamento.
- Sempre validar existência de Technical Plan antes de Engineering quando houver complexidade técnica.
- Sempre exigir QA/Validation antes de Done.
- Sempre manter histórico.
- Sempre escalar dúvida bloqueadora ao usuário.
- Sempre separar planejamento de execução.
- Sempre preservar contexto entre agentes por artefatos, não só chat.
- Sempre decidir próxima ação única.
- Nunca implementar código.
- Nunca editar critério de aceite sozinho.
- Nunca aceitar Done sem evidência.

Fluxo operacional do Manager:

1. Ler `description.md`, `task.yaml`, chat e artefatos.
2. Classificar se é operação simples ou entrega de produto/código.
3. Se entrega de produto/código e não há `task-spec.md`, enviar para Product.
4. Revisar Task Spec.
5. Pedir confirmação humana se houver decisão subjetiva.
6. Criar plano/handoff.
7. Delegar execução.
8. Consumir resultados.
9. Reabrir etapa se QA/review falhar.
10. Concluir somente quando DoD está satisfeito.

## 9. Responsabilidades do Product Agent

O Product Agent deve operar com estas regras:

- Produzir specs acionáveis.
- Transformar pedidos vagos em requisitos claros.
- Perguntar quando necessário.
- Pesquisar quando necessário e registrar fonte/data.
- Separar requisito de sugestão.
- Não inventar comportamento.
- Explicitar incertezas.
- Gerar output padronizado.
- Separar dúvidas bloqueadoras de não bloqueadoras.
- Separar decisões técnicas objetivas de decisões de produto.
- Atualizar `acceptance.md` como derivado dos critérios da Task Spec.

Product Agent deve parar e perguntar quando:

- objetivo não é verificável;
- usuário pede “melhor”, “bonito”, “rápido”, “correto” sem critério;
- há múltiplas interpretações de fluxo;
- há impacto em comportamento existente;
- falta critério de aceite;
- há requisito conflitante.

Product Agent pode seguir sem perguntar quando:

- escopo e comportamento estão explícitos;
- dúvida é técnica e pode ir para Architecture;
- critérios podem ser derivados diretamente do pedido sem subjetividade;
- a decisão não altera produto e pode ser registrada como premissa.

## 10. Regras de handoff entre agentes

Todo handoff deve conter:

- task id;
- contexto necessário;
- artefatos produzidos;
- arquivos relevantes;
- decisões tomadas;
- dúvidas abertas;
- critérios de sucesso;
- próximo responsável;
- estado/gate esperado após conclusão.

Formato recomendado:

```md
# Handoff

From:
To:
Task:
Reason:

## Context

## Produced Artifacts

## Relevant Files

## Decisions

## Open Questions

## Success Criteria

## Next Expected State
```

Handoffs obrigatórios:

- Manager -> Product: pedido original, motivo da spec, perguntas conhecidas.
- Product -> Manager: Task Spec, dúvidas, decisões, critérios.
- Manager -> Architecture/Design: spec aprovada e expectativa do plano.
- Architecture/Design -> Engineering: plano, constraints, arquivos esperados.
- Engineering -> QA: mudanças, comandos, evidência local.
- QA -> Review: validation report.
- Review -> Engineering/Deployment/Manager: findings ou readiness.
- Deployment -> Manager: resultado, rollback, evidência.
- Documentation -> Manager: docs/changelog atualizados.

## 11. Memória, contexto e rastreabilidade

O sistema deve preservar:

- histórico da task em `events.jsonl`;
- mensagens do usuário em chat/task comments;
- Task Spec em `task-spec.md`;
- plano técnico em `technical-plan.md`;
- execution plan em `execution-plan.md`;
- logs de execução em runtime/session JSONL;
- outputs intermediários em `artifacts/`;
- validações em `validation-report.md`;
- decisões em `decision-log.md`;
- falhas e retries em `events.jsonl`;
- arquivos alterados em resumo de Engineering/Review;
- evidências finais em `final-evidence.md` ou `validation-report.md`;
- handoffs em `handoffs/`.

Estado atual aproveitável:

- `events.jsonl` e leitura em `readAgentLogs`.
- `comments.jsonl` e chat-store.
- `summaries/run-*.md`.
- `task.files` no BoardService.
- `agent.run` registra `promptHash`, model, provider e chat build.

Lacuna:

- Não há decision log oficial.
- Não há handoff artifact oficial.
- Não há spec/plan/validation artifact obrigatório.
- Contexto entre personas ainda depende de chat e prompt.

## 12. Critérios para pedir confirmação ao usuário

O agente deve parar e perguntar quando houver:

- escopo ambíguo;
- impacto destrutivo;
- múltiplas soluções possíveis com trade-offs relevantes;
- alteração de comportamento de produto;
- mudança de arquitetura;
- remoção de funcionalidade;
- alteração de dados persistidos;
- alteração de contratos públicos;
- falta de critério de aceite;
- requisitos conflitantes;
- acesso a credenciais/segredos;
- execução de deploy;
- custo externo relevante;
- coleta de dados externos que exige fonte específica;
- alteração de permissões;
- mudança em workflow global;
- decisão estética sem referência objetiva.

Perguntas devem ser objetivas, com:

- motivo da pergunta;
- por que bloqueia;
- opções se existirem;
- impacto de cada opção;
- default recomendado quando seguro.

## 13. Critérios para não perguntar ao usuário

O agente pode seguir sem perguntar quando:

- correção técnica é objetiva e preserva comportamento;
- ajuste interno não impacta produto;
- refactor seguro está dentro da spec;
- melhoria de clareza em documentação não muda contrato;
- validações automáticas são óbvias;
- decisão já está definida na spec;
- erro de lint/teste tem causa objetiva;
- escolha técnica é local e reversível;
- atualização de evidência ou logs não altera escopo.

Mesmo nesses casos, deve registrar decisão tomada quando ela afetar execução, arquivos, risco ou validação.

## 14. Definition of Ready

Uma task só pode entrar em execução se tiver:

- Task Spec aprovada ou suficientemente clara;
- objetivo definido;
- escopo definido;
- fora de escopo definido quando relevante;
- critérios de aceite verificáveis;
- agente executor definido;
- dependências conhecidas;
- riscos mapeados;
- dúvidas bloqueadoras resolvidas;
- plano técnico quando houver impacto técnico relevante;
- worktree/projeto alvo configurado quando houver código;
- policy de validação definida;
- confirmação do usuário para decisões subjetivas/destrutivas.

No sistema atual, isso deve ser implementado como gate antes de `engineering`, `quality`, `review`, `deployment` e `done`.

## 15. Definition of Done

Uma task só pode ir para Done se tiver:

- implementação ou entrega concluída;
- critérios de aceite validados;
- testes executados ou justificativa clara quando não existirem;
- documentação atualizada quando necessário;
- changelog criado quando houver mudança de implementação;
- evidências registradas;
- resumo final;
- próximos passos registrados, se existirem;
- falhas/retries encerrados;
- worktree/merge/deploy resolvidos quando aplicável;
- aprovação de QA/Review/Deployment quando aplicável.

O botão manual “Completar” da UI deve ser removido ou convertido em “Solicitar conclusão ao Manager”.

## 16. Falhas, bloqueios e retries

### Erro de tool

- Registrar tool, input resumido, stdout/stderr, exit code e run id.
- Retry automático no máximo conforme policy.
- Após limite, enviar para Manager com blocker.

### Erro de agente

- Se agente não chama tool terminal, recuperar para Manager.
- Já existe tratamento de non-terminal em `runTaskWorkflow`; deve virar regra formal.

### Timeout

- Registrar timeout no evento.
- Manager decide retry, pausa ou pergunta ao usuário.
- Timeout deve ser configurável por agent/tool/hook.

### Execução incompleta

- Não permitir Done.
- Retornar ao agente responsável com checklist incompleto.

### Validação reprovada

- Criar `validation-report.md`.
- Mover para `Validation Failed`.
- Manager decide Engineering, Product ou Architecture.

### Falta de contexto

- Pedir input humano se for produto.
- Pedir handoff/artefato se for contexto entre agentes.
- Bloquear se contexto externo obrigatório não está disponível.

### Conflito entre spec e implementação

- Parar execução.
- Manager aciona Product para alterar spec ou Engineering para corrigir.
- Registrar decisão em `decision-log.md`.

### Usuário movendo task manualmente durante execução

- Movimento manual vence.
- Run atual deve ser invalidado.
- Resultado tardio não pode concluir task.
- Já há `manualOverride` em `task-service`; precisa gate visual e policy completa.

### Retomada de task interrompida

- Usar último summary e session ref.
- Revalidar DoR antes de retomar.
- Reidratar tool results recentes.
- Registrar motivo da retomada.

## 17. O que existe hoje

| Item | Status | Evidência |
|---|---|---|
| FSDB local-first | aproveitável | `packages/fsdb/src/index.js` cria settings, tasks, runtime, YAML/Markdown/JSONL |
| Board settings | aproveitável | `settings/boards/default.yaml` via `initStorage`, schema em `BoardSettingsSchema` |
| Roles | aproveitável | `packages/core/src/roles.js` define manager/product/design/architecture/generalist/engineering/quality/review/deployment |
| Agent prompts | aproveitável | defaults em `packages/fsdb/src/index.js` criam prompts por agent |
| Commands tipados | aproveitável | `packages/core/src/contracts.js`, `CommandSchema` |
| Task artifacts | aproveitável | `description.md`, `acceptance.md`, `planning.yaml`, `subtasks.yaml`, `worktree.yaml` |
| Events/timeline | aproveitável | `events.jsonl`, `readAgentLogs`, modal aba `eventos` |
| Scheduler | aproveitável parcial | `packages/orchestrator/src/scheduler.js` |
| Runnability | aproveitável | `packages/orchestrator/src/runnability-service.js` |
| Semaphores | aproveitável | `packages/fsdb/src/runtime-store.js`, status no OrchestratorPanel |
| Subtasks DAG | aproveitável | `packages/orchestrator/src/task-decomposition-service.js`, `packages/core/src/dag.js` |
| Worktrees | aproveitável | `packages/git-worktree/src/index.js` |
| Board Assistant tools | aproveitável | `buildKanbanTools` em `packages/pi-adapter/src/index.js` |
| Task tools | aproveitável | `buildTaskAgentTools` em `packages/pi-adapter/src/index.js` |
| UI Board | aproveitável | `apps/web/src/components/Board.tsx` |
| Task Modal | aproveitável | `apps/web/src/components/TaskModal.tsx` |
| Settings UI | aproveitável | `apps/web/src/components/SettingsDialog.tsx` |
| Logs UI | aproveitável | `TerminalLogs` em `TaskModal.tsx` |

## 18. O que precisa ser refinado

| Item | Problema atual | Impacto | Refinamento | Prioridade |
|---|---|---|---|---|
| Manager routing | heurístico por texto | pode pular Product | gate obrigatório de spec para produto/código | alta |
| `acceptance.md` | placeholder frágil | readiness falso | gerar a partir de `task-spec.md` | alta |
| `planning.yaml` | superficial | plano não executável | adicionar `technical-plan.md` | alta |
| `complete_task` | aceita Done | Done sem QA | validar DoD no orchestrator | crítica |
| UI Completar | conclui manualmente | bypass total | remover ou converter em solicitação ao Manager | crítica |
| Deployment gate | auto-Done | deploy vira atalho | exigir resultado/aprovação/rollback | alta |
| Review gate | lógica mínima | falsa confiança | exigir QA evidence e severidade estruturada | alta |
| Hooks | noop por padrão | pouco valor operacional | hooks por gate com resultado visível | média |
| Handoffs | chat/evento solto | contexto se perde | `record_handoff` | alta |
| Decision log | inexistente | decisões não rastreáveis | `decision-log.md` | alta |
| Retomada | parcial | runs podem ficar inconsistentes | resume policy + rehydration | alta |
| Sandbox | prompt-only | risco de filesystem | isolamento real por task | crítica |
| Settings | não cobrem workflow | usuário não controla gates | settings por workflow/coluna/agent/tool | alta |

## 19. O que precisa ser criado

| Item | Objetivo | Responsável | Impacto | Prioridade |
|---|---|---|---|---|
| `task-spec.md` | contrato oficial de produto | Product | reduz ambiguidade | crítica |
| `technical-plan.md` | plano técnico executável | Architecture/Manager | evita implementação por suposição | alta |
| `validation-report.md` | mapear aceite para evidência | QA | impede Done falso | crítica |
| `decision-log.md` | decisões rastreáveis | Manager/Product/Architecture | auditoria | alta |
| `handoffs/` | handoff estruturado | todos | preserva contexto | alta |
| Gate engine | DoR/DoD sistêmicos | Orchestrator | bloqueio real | crítica |
| Workflow settings | controlar fases/gates | App/Settings | operação real | alta |
| Approval settings | aprovar spec/plan/done/deploy | App/Settings | segurança | alta |
| Documentation Agent | docs/changelog | Documentation | manutenção | média |
| Retry policy | retries controlados | Orchestrator | resiliência | alta |
| Timeout policy | timeouts por tool/agent | Orchestrator | previsibilidade | média |
| Confirmation tool | decisões do usuário | Manager/Product | reduz suposição | alta |
| UX Spec tab | mostrar spec | Web | confiança | alta |
| Plan tab | mostrar plano/handoffs | Web | rastreabilidade | alta |
| Validation tab | mostrar QA/evidência | Web | confiança | alta |
| Blocks view | centralizar blockers | Web | operação | média |

## 20. O que precisa ser removido

| Item | Por que remover | Risco de manter | Impacto |
|---|---|---|---|
| Botão `Completar` direto | bypass de workflow | Done sem entrega | força conclusão por gate |
| Done por `deploy_task` automático | deploy não equivale a aceite | falso sucesso | deploy vira evidência, não decisão final |
| Placeholder acceptance como readiness | critério genérico | execução sem clareza | Product Spec vira fonte |
| Role columns como workflow final | confunde papel e fase | usuário não entende progresso | estados de fase + role atual |
| Handoffs somente por chat | perde contexto | agentes repetem perguntas | artifacts estruturados |
| Hooks noop como validação | não prova nada | usuário confia em falso | hooks com resultado/gate |

## 21. Proposta final de arquitetura operacional

Arquitetura recomendada:

- FSDB continua fonte de verdade.
- Cada task tem pasta própria com artefatos oficiais.
- Orchestrator aplica state machine e gates.
- Roles são executores, não estados principais.
- Scheduler inicia apenas tasks/gates runnable.
- Manager é único orquestrador de fluxo.
- Product é único dono da Task Spec.
- Architecture/Design produzem planos antes de Engineering quando necessário.
- Engineering implementa em worktree.
- QA valida aceite.
- Review valida diff/readiness.
- Deployment registra release/rollback.
- Documentation registra docs/changelog.

Artefatos mínimos por task:

- `task.yaml`
- `description.md`
- `task-spec.md`
- `acceptance.md`
- `technical-plan.md` quando aplicável
- `execution-plan.md` quando houver subtasks
- `subtasks.yaml`
- `decision-log.md`
- `handoffs/*.md`
- `validation-report.md`
- `events.jsonl`
- `summaries/*.md`
- `artifacts/*`

Fluxo de recuperação:

- Detectar run stale.
- Invalidar leases.
- Reidratar contexto oficial.
- Reavaliar gate atual.
- Retomar pelo Manager, não pelo executor direto.

## 22. Plano de implementação

### Fase 1 — Correções essenciais

- Bloquear `complete_task` para Done sem DoD.
- Remover/alterar botão UI `Completar`.
- Criar `task-spec.md` no FSDB.
- Criar gate DoR antes de Engineering.
- Criar gate DoD antes de Done.
- Ajustar Manager para acionar Product antes de execução técnica.
- Adicionar tests para “não executa sem spec”.

### Fase 2 — Padronização de spec e handoff

- Implementar `create_task_spec`.
- Implementar `approve_task_spec`.
- Implementar `record_handoff`.
- Implementar `record_decision`.
- Atualizar Product prompt para preencher template oficial.
- Exibir Task Spec no modal.
- Criar `decision-log.md`.

### Fase 3 — Validação e rastreabilidade

- Implementar `record_validation`.
- Criar `validation-report.md`.
- Exigir QA mapping por critério de aceite.
- Refatorar Review para exigir QA evidence.
- Ajustar Deployment para não concluir sozinho.
- Exibir validation evidence no modal.
- Adicionar tests e2e para Spec -> Plan -> Engineering -> QA -> Review -> Done.

### Fase 4 — Refinamento de UX e operação real

- Redesenhar board para mostrar fase, role atual e gate.
- Criar abas/painéis Spec, Plan, Handoffs, Validation, Decisions.
- Criar tela/painel de bloqueios.
- Criar controles de Pause/Resume/Cancel.
- Criar confirmações para ações destrutivas e movimentos durante execução.
- Criar settings de workflow, approvals, retry e timeout.

### Fase 5 — Hardening para uso contínuo

- Implementar sandbox real por task.
- Implementar retry/timeout por agent/tool/hook.
- Implementar resumable runs com rehydration de tool results.
- Implementar locks/leases com auditoria mais forte.
- Criar current-state validation completa com browser/API/logs.
- Criar métricas de execução por fase.
- Criar documentação operacional para usuário final.

## 23. Checklist final

- [ ] Usuário cria task pela UI.
- [ ] Manager recebe e registra triagem.
- [ ] Product Agent gera `task-spec.md`.
- [ ] Dúvidas bloqueadoras pausam a task.
- [ ] Spec tem objetivo verificável.
- [ ] Spec tem escopo e fora de escopo.
- [ ] Spec tem critérios de aceite verificáveis.
- [ ] Manager aprova spec ou pede ajuste.
- [ ] Technical Plan existe quando necessário.
- [ ] Handoffs são registrados.
- [ ] Engineering não executa sem DoR.
- [ ] Engineering registra arquivos alterados.
- [ ] QA valida cada critério de aceite.
- [ ] Review exige evidência de QA.
- [ ] Deployment registra rollback quando aplicável.
- [ ] Done é bloqueado sem DoD.
- [ ] UI mostra spec, plano, execução, validação e evidência.
- [ ] Configurações cobrem agents, tools, hooks, workflow e approvals.
- [ ] Logs e eventos explicam quem fez o quê, quando e por quê.
- [ ] Retomada de task interrompida preserva contexto.
- [ ] Falhas têm retry/owner/next step.
- [ ] Sandbox real impede acesso fora do workspace da task.

## Revisão de telas, UX e configurações

### Telas existentes

| Tela/componente | Propósito atual | Evidência |
|---|---|---|
| Board principal | renderizar colunas e cards | `apps/web/src/components/Board.tsx` |
| Modal de task | criar, editar, ver execução/logs/worktree/deps/subtasks/hooks/eventos/arquivos/chat | `apps/web/src/components/TaskModal.tsx` |
| Assistant do board | chat global com tools tipadas | `apps/web/src/components/AssistantPanel.tsx` |
| Orchestrator Panel | fila, running, merges, worktrees, leases, semáforos | `apps/web/src/components/OrchestratorPanel.tsx` |
| Settings Dialog | interface, segurança, runtime, providers, agents/prompts | `apps/web/src/components/SettingsDialog.tsx` |
| File viewer/download | abrir arquivos da task | `/api/task-file` em `apps/daemon/src/server.js` |

### Problemas de UX encontrados

- O usuário vê colunas de agentes, mas não vê fases claras de Spec, Plan, Execution e Validation.
- O modal tem abas técnicas, mas não tem aba de Task Spec oficial.
- `acceptance.md` não é editado como contrato de produto de primeira classe.
- “Completar” sugere que o usuário pode finalizar sem validação.
- Logs existem, mas não há timeline interpretada por decisão/gate.
- Handoffs não aparecem como seção própria.
- Subtasks aparecem em texto, não como workflow de dependências com gates.
- Settings expõe prompts de agentes, mas não expõe workflow policies.
- Não há tela central de bloqueios.
- Não há aprovação visual de spec/plano/conclusão.

### Telas que precisam ser alteradas

| Tela | Problema atual | Mudança recomendada | Impacto | Prioridade |
|---|---|---|---|---|
| Board | mistura role e fase | mostrar fase atual, role responsável e gate | clareza | alta |
| Task Modal | falta Spec/Plan/Validation | adicionar abas oficiais | rastreabilidade | alta |
| Execução tab | permite Completar | trocar por Solicitar conclusão/Pausar/Retomar/Cancelar | segurança | crítica |
| Eventos tab | timeline crua | timeline por decisões/gates | confiança | média |
| Subtasks tab | texto simples | grafo/lista com needs/provides/status/gate | operação | média |
| Settings | sem workflow policies | adicionar Workflow, Columns, Hooks, Tools, Approvals | controle | alta |
| Orchestrator | técnico demais | adicionar blockers, gates pendentes, next action | operação | média |

### Telas que precisam ser criadas

| Tela/componente | Objetivo | Informações exibidas | Ações | Relação | Prioridade |
|---|---|---|---|---|---|
| Spec Panel | ver/aprovar Task Spec | template, dúvidas, decisões | aprovar, pedir ajuste | Product/Manager | alta |
| Plan Panel | ver plano técnico | fases, subtasks, arquivos, riscos | aprovar, pedir ajuste | Manager/Architecture | alta |
| Validation Panel | ver QA | critérios, evidências, pass/fail | reprovar/aprovar | QA | alta |
| Handoff Timeline | entender transferências | from/to/context/artifacts | abrir artefatos | todos | média |
| Blockers View | operar bloqueios | blocker, owner, next step | responder, retry, cancelar | Manager | média |
| Approval Drawer | confirmar decisões | decisão, impacto, opções | aprovar/rejeitar | usuário | alta |

### Telas ou componentes que devem ser removidos

| Item | Motivo | Risco de manter | Impacto |
|---|---|---|---|
| Botão Completar direto | bypass | Done sem validação | conclusão segura |
| Ações rápidas para mover a qualquer coluna sem gate | confunde fluxo | execução fora de ordem | transições controladas |
| Progresso percentual por status simples | comunica precisão falsa | usuário confia em barra genérica | trocar por gates |

### Configurações existentes

| Configuração | Uso atual | Evidência |
|---|---|---|
| `ui` | tema/densidade/progresso/text scale/font | `AppSettingsSchema`, `SettingsDialog` |
| `safety.allowNetwork` | permitir rede | `SettingsDialog` |
| `runtime.maxParallelTasks` | concorrência global | `scheduler.js`, `SettingsDialog` |
| `runtime.projectTokens` | tokens por projeto | `runnability-service.js` |
| `ai.defaultProvider/defaultModel/defaultEffort` | modelo padrão | `providers.js`, settings UI |
| providers enabled | provider ativo | `provider.discover` |
| agent model/effort | modelo por agente | `SettingsDialog` |
| agent prompt | prompt editável | `SettingsDialog` |
| agent maxParallelTasks | limite por agente | `agent-capacity.js` |
| board columns | colunas/agents/hooks/wip | `BoardSettingsSchema` |
| hooks | hook settings | `HookSettingsSchema`, `hook-service.js` |
| projects/worktrees | repo e worktree config | `ProjectSettingsSchema` |

### Configurações que precisam ser criadas

- Agents: role obrigatória, toolset permitido, gates de entrada/saída, max retries, timeout, approval requirement.
- Tools: permissões por tool, risco, timeout, output artifact obrigatório.
- Hooks: trigger por gate, blocking/non-blocking, retry, timeout, evidence path.
- Workflow: estados, transições, gates obrigatórios, autoStart por fase.
- Estados/colunas: mapear fase e role separadamente.
- Handoffs: template obrigatório e retenção.
- Validação: tipo de evidência por critério, comandos recomendados, browser/API/manual.
- Permissões: ações destrutivas, mover running, cancelar, deploy, merge.
- Manager: spec-first enforcement, direct-task allowlist.
- Product Agent: fontes externas permitidas, confirmação obrigatória por tipo de decisão.
- Confirmação com usuário: categorias, defaults e mensagens.
- Retry: limite por tool/agent/status.
- Timeout: global, por agent, por tool, por hook.
- Execução automática/manual: por projeto, fase e agent.
- Aprovação antes de executar: spec/plan/deploy.
- Aprovação antes de concluir: Done final.

### Configurações que precisam ser removidas ou simplificadas

- Exposição de prompts como única forma de alterar comportamento crítico.
- Configurações de progresso visual que sugerem avanço sem gate.
- Permissões globais amplas sem granularidade por tool.
- Coluna como substituta de estado/fase.

### Proposta final de UX operacional

A interface deve operar em três camadas:

1. Board: visão rápida de fase, owner, blocker e próximo gate.
2. Modal da task: contrato completo com Spec, Plan, Execution, Validation, Handoffs, Decisions, Logs e Files.
3. Settings: políticas operacionais por workflow, agente, tool, hook, projeto e aprovação.

O usuário deve conseguir responder dúvidas, aprovar spec/plano, pausar, retomar, cancelar e pedir ajuste sem entender arquivos internos. Os arquivos continuam disponíveis para auditoria e agentes.

## Apêndice A — Prompt original recebido

O prompt original consolidado que originou esta revisão pediu:

```md
# Goal

Investigue o projeto inteiro do Kanban Agent e gere o documento `final-workflow-definition.md` com a definição final do workflow, papéis dos agentes, responsabilidades, tools, estados, artefatos, lacunas e melhorias necessárias para que o software seja realmente utilizável em produção.

O objetivo desta revisão é garantir que uma task delegada ao sistema seja entendida, especificada, planejada, executada, validada e entregue de forma concreta, rastreável e acertiva.

## Contexto

1. O usuário cria uma task.
2. A task é delegada ao Manager Agent.
3. O Manager Agent atua como gerente, project manager e orquestrador da task.
4. Antes de qualquer execução técnica, o Manager deve encaminhar a demanda para o Product Agent.
5. O Product Agent é responsável por transformar a demanda em uma especificação clara, completa e executável.
6. O output do Product Agent deve ser uma Task Spec padronizada.
7. Depois que a spec estiver pronta, o Manager dá continuidade ao workflow, delegando para os agentes corretos.
8. A task só deve ser considerada concluída quando houver entrega concreta, validação e evidências suficientes.

## Regras fundamentais

- O agent nunca deve assumir decisões subjetivas.
- Se houver ambiguidade, subjetividade, falta de contexto ou múltiplas interpretações possíveis, o agent deve perguntar ao usuário antes de seguir.
- O agent não deve implementar nada com base em suposições frágeis.
- O agent deve diferenciar dúvidas bloqueadoras, dúvidas não bloqueadoras, decisões técnicas objetivas e decisões de produto que exigem confirmação.
- Toda task precisa ter objetivo verificável.
- Toda entrega precisa ter critério de aceite.
- Toda execução precisa deixar rastros claros do que foi feito, por quê, por quem e com qual resultado.

## Investigação obrigatória

Investigar arquitetura atual, fluxo de criação/movimentação/execução de tasks, agentes existentes, responsabilidades, tools, formato das tasks, outputs, estados/colunas, hooks, persistência filesystem, histórico, logs, validações, retomada, falhas, contexto, suposições indevidas, confirmações ausentes e fragilidades.

## Documento a ser gerado

Criar `final-workflow-definition.md` com seções de visão geral, experiência ideal, papéis dos agentes, template oficial da Task Spec, workflow final, estados/colunas, tools, responsabilidades do Manager e Product, handoffs, memória/contexto/rastreabilidade, critérios para perguntar/não perguntar, Definition of Ready, Definition of Done, falhas/bloqueios/retries, estado atual, refinamentos, criações, remoções, arquitetura operacional, plano de implementação e checklist final.

## Requisitos adicionais

Além do projeto atual, pesquisar e validar Spec Kit e BMAD/BMAD Method antes de definir o workflow final.

Para cada benchmark, analisar problema resolvido, specs, separação entre planejamento/execução/validação, Product/Planning/Engineering/QA, redução de ambiguidade, clareza antes da implementação, artefatos intermediários, handoffs, critérios de aceite, contexto, rastreabilidade, conceitos aplicáveis, conceitos não aplicáveis e adaptações necessárias.

Adicionar seção `## Benchmark: Spec Kit e BMAD`.

## Aplicação dos conceitos ao workflow

Avaliar spec-first workflow, separação Product Spec/Technical Plan/Execution, gates, DoR, DoD, artefatos obrigatórios, handoff estruturado, checkpoints, confirmação do usuário, rastreabilidade, validação antes de conclusão e separação entre intenção, especificação, plano técnico e implementação.

## Revisão obrigatória das telas e configurações

Investigar tela principal do Kanban, criação de tasks, detalhes da task, chat interno, configurações globais, por projeto, por coluna, por agent, por tool, hooks, workflow, permissões, logs, timeline, subtasks, handoffs, spec, plano, execução, validação, bloqueios, revisão/aprovação, board e ações manuais.

Adicionar seção `## Revisão de telas, UX e configurações`.

## Resultado esperado

O documento deve ser completo, prático, acionável, específico para este projeto, refletindo arquitetura, agents, tools e problemas reais encontrados.

## Critérios de aceite

- Projeto inteiro investigado.
- `final-workflow-definition.md` criado.
- Workflow final ponta a ponta.
- Manager e Product Agent claramente definidos.
- Template oficial de Task Spec.
- Critérios claros para perguntar ao usuário.
- Critérios claros para execução, validação e conclusão.
- Itens existentes, a refinar, a criar e a remover.
- Plano de implementação concreto.
- Benchmark de Spec Kit e BMAD realizado.
- Conceitos incorporados e descartados explicados.
- Revisão de telas, UX e configurações.
- Workflow considera experiência real do usuário na interface.

## Instrução final

Executar a investigação completa do projeto, incluindo código, arquitetura, workflow, agents, tools, persistência, estados, telas, UX e configurações. Fazer benchmark de Spec Kit e BMAD/BMAD Method. Gerar `final-workflow-definition.md`. Ao final, entregar resumo com achados, benchmark, conceitos incorporados, mudanças em agents/tools/responsabilidades, mudanças em telas/configurações, itens a criar/alterar/remover, arquivos criados/alterados e riscos/decisões pendentes.
```
