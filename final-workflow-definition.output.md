# Final Workflow Definition — Kanban Agent

Data: 2026-06-14  
Status: definição final consolidada para implementação  
Base: revisão do `final-workflow-definition.output.md`, auditoria do projeto atual, benchmark de Spec Kit e BMAD Method.

---

## 0. Sumário executivo

O Kanban Agent deve evoluir para um sistema **spec-first, gate-driven e auditável**, onde uma task criada pelo usuário não vira implementação diretamente. A experiência final desejada é:

1. O usuário cria uma task em linguagem natural.
2. O **Manager Agent** recebe a demanda e atua como gerente, project manager e orquestrador.
3. Antes de qualquer execução técnica, o Manager encaminha a demanda ao **Product Agent**.
4. O Product Agent transforma a demanda em uma **Task Spec** clara, verificável e acionável.
5. Se houver ambiguidade, subjetividade ou falta de contexto, o Product Agent pergunta ao usuário.
6. Quando a spec estiver pronta, o Manager decide se precisa de plano técnico, design, arquitetura, pesquisa ou execução direta.
7. A execução só começa depois do **Definition of Ready Gate**.
8. Engineering implementa seguindo a spec e o plano aprovado.
9. QA valida os critérios de aceite e registra evidências.
10. Review verifica qualidade, riscos e aderência à spec.
11. Deployment registra evidência de entrega, mas **não conclui a task sozinho**.
12. O Manager executa o **Definition of Done Gate** e só então move a task para `Done`.

A auditoria anterior confirmou que a base do produto existe, mas ainda há bypasses críticos: `complete_task` pode concluir sem DoD, a UI ainda tem botão direto de `Completar`, `deploy_task` move automaticamente para `done`, artefatos como `task-spec.md`, `validation-report.md`, `decision-log.md` e `handoffs/` ainda não são obrigatórios, e o roteamento Manager -> Product ainda é heurístico.

Este documento transforma esse diagnóstico em uma especificação final de workflow, arquitetura operacional, UX, tools, configurações e plano de implementação.

---

## 1. Princípios fundamentais

### 1.1 Spec-first

Nenhuma task técnica deve entrar em execução antes de ter uma especificação mínima registrada. A spec é o contrato da task. Código, testes, documentação e validação devem servir à spec, não o contrário.

### 1.2 Gate-driven workflow

A movimentação da task não pode depender apenas de intenção textual do agente ou de botão manual na UI. Mudanças críticas de fase devem passar por gates verificáveis.

Gates obrigatórios:

- **Spec Gate**: existe `task-spec.md` suficientemente completo.
- **Clarification Gate**: dúvidas bloqueadoras foram resolvidas ou a task está aguardando usuário.
- **DoR Gate**: a task está pronta para execução.
- **Validation Gate**: critérios de aceite foram validados com evidências.
- **DoD Gate**: a task pode ir para `Done`.

### 1.3 Separação entre fase, role e coluna

O produto não deve misturar fase da task, agente responsável e coluna visual do board.

Modelo final:

```yaml
task_phase: intake | spec | planning | execution | validation | review | delivery | done | blocked | cancelled
current_role: manager | product | design | architecture | engineering | qa | review | deployment | documentation | none
board_column: inbox | needs_spec | waiting_user | ready | in_progress | in_review | blocked | done | cancelled
gate_status: pending | passed | failed | waiting_user | skipped_with_reason
```

A coluna é uma representação visual. A fase e o gate são a verdade operacional.

### 1.4 Nunca assumir subjetividade

O agent nunca deve assumir decisões subjetivas, de produto, UX, escopo ou comportamento esperado quando houver múltiplas interpretações plausíveis.

Deve perguntar ao usuário quando a decisão impactar:

- comportamento de produto;
- experiência do usuário;
- arquitetura relevante;
- contrato público;
- dados persistidos;
- remoção de funcionalidade;
- critério de aceite;
- custo, risco ou prazo;
- segurança;
- privacidade;
- compatibilidade;
- operação em produção.

### 1.5 Evidência obrigatória

Uma task só pode ser concluída quando existir evidência objetiva de entrega. Evidência pode ser:

- testes automatizados;
- comandos executados;
- screenshots;
- logs;
- diffs relevantes;
- validação manual registrada;
- links para artefatos;
- checklist de critérios de aceite;
- justificativa explícita quando algum teste não for possível.

### 1.6 Fast path extremamente restrito

O fast path só pode existir para tarefas operacionais simples, sem alteração de código, sem decisão de produto e sem risco destrutivo. Mesmo nesse caso, deve existir uma **Mini Spec** registrada.

Exemplos permitidos:

- renomear título de task;
- adicionar nota interna;
- gerar um resumo simples;
- organizar documentação sem alterar comportamento.

Exemplos proibidos no fast path:

- alterar código;
- alterar schema;
- alterar UX;
- remover funcionalidade;
- concluir task técnica;
- fazer deploy;
- modificar hooks, providers, tools ou permissões.

---

## 2. Benchmark: Spec Kit e BMAD

### 2.1 Spec Kit

#### Resumo do conceito

Spec Kit é um toolkit open source para **Spec-Driven Development**. A ideia central é inverter o fluxo tradicional: especificações deixam de ser documentação auxiliar e passam a ser o artefato central que dirige planejamento, tarefas e implementação.

Conceitos relevantes observados:

- especificação define o **what** antes do **how**;
- desenvolvimento acontece por refinamento multi-etapa, não por prompt único;
- artefatos como spec, plan e tasks guiam o agente;
- a implementação deve seguir o plano derivado da spec;
- o processo é independente de stack e pode ser adaptado a projetos diferentes;
- a constituição ou princípios do projeto funcionam como guardrails permanentes.

#### Pontos fortes

- Reduz ambiguidade antes da implementação.
- Cria um contrato rastreável entre intenção do usuário e código.
- Ajuda a evitar vibe coding sem controle.
- Favorece entregas verificáveis.
- Separa especificação, planejamento e execução.
- Dá ao agente um caminho previsível.

#### Limitações para o Kanban Agent

- Spec Kit é orientado a comandos e artefatos de feature; o Kanban Agent precisa integrar isso ao board, estados, handoffs, hooks e múltiplos agentes.
- Spec Kit não resolve sozinho UI operacional, permissões, retries, interrupções manuais e retomada de tasks.
- O Kanban Agent precisa adaptar o conceito para FSDB por task, não simplesmente copiar a árvore de arquivos do Spec Kit.

#### Conceitos aplicáveis ao Kanban Agent

- `task-spec.md` como fonte de verdade da task.
- `technical-plan.md` antes de execução técnica quando necessário.
- `implementation-tasks.md` ou subtasks derivadas do plano.
- gates entre spec, plan, tasks e implementação.
- princípios globais do projeto como `workflow-constitution.md`.
- validação explícita de ambiguidades antes de implementação.

#### Conceitos descartados ou adaptados

- Não adotar comandos `/speckit.*` literalmente; criar tools nativas do Kanban Agent.
- Não criar árvore paralela de specs fora da task; manter tudo dentro do FSDB da task.
- Não tornar toda task pesada; permitir Mini Spec para tarefas simples, mas sem permitir bypass de DoD.

---

### 2.2 BMAD / BMAD Method

#### Resumo do conceito

BMAD Method é uma metodologia de desenvolvimento assistido por IA com agentes especializados, workflows guiados e construção progressiva de contexto. O workflow é dividido em fases, e cada fase produz documentos que informam a próxima, permitindo que os agentes saibam o que construir e por quê.

Conceitos relevantes observados:

- agentes especializados;
- workflows por fase;
- contexto estruturado e progressivo;
- planning antes de implementation;
- artefatos como PRD, design, architecture, decision log e validation report;
- core tools que funcionam em diferentes fases;
- revisão adversarial e edge-case review;
- possibilidade de customização de agentes e workflows.

#### Pontos fortes

- Define papéis claros para agentes.
- Favorece handoff estruturado.
- Evita que um único agente misture Product, Engineering, QA e Review.
- Ajuda a controlar contexto em projetos grandes.
- Trabalha bem com fluxos de complexidade variável.
- Usa artefatos como memória operacional.

#### Limitações para o Kanban Agent

- BMAD é uma metodologia e conjunto de skills; o Kanban Agent precisa virar um produto com UI, FSDB, permissões, hooks e gates sistêmicos.
- Algumas fases podem ser pesadas demais para tasks simples.
- O Kanban Agent precisa integrar o modelo ao board e à experiência do usuário, não apenas ao prompt.

#### Conceitos aplicáveis ao Kanban Agent

- Manager como orquestrador, não executor.
- Product Agent como dono do contrato de produto.
- Architecture e Design sob demanda.
- QA e Review como fases separadas.
- Documentation Agent ou responsabilidade formal de documentação.
- Decision log obrigatório.
- Validation report obrigatório.
- Handoff com contexto, artefatos e critérios de sucesso.
- Revisão adversarial/edge-case opcional para tasks de risco.

#### Conceitos descartados ou adaptados

- Não copiar todos os agentes do BMAD se o projeto não precisar.
- Não exigir fase completa de análise para toda task.
- Não depender apenas de skills carregadas no prompt; gates precisam existir no orquestrador.

---

### 2.3 Síntese do benchmark

O Kanban Agent deve incorporar:

- Spec-first como regra operacional.
- Product Agent como dono de `task-spec.md`.
- Manager como orquestrador de gates.
- Separação formal entre Product Spec, Technical Plan, Execution, Validation e Delivery.
- Artefatos Markdown por task como memória e contrato.
- Handoffs estruturados entre agentes.
- Decision log obrigatório para decisões relevantes.
- Validation report obrigatório antes de Done.
- UX que mostre Spec, Plan, Execution, Validation, Handoffs e Decisions.

O Kanban Agent deve evitar:

- execução direta a partir de prompt vago;
- conclusão por botão direto;
- deploy como sinônimo de done;
- roteamento heurístico baseado apenas em palavras-chave;
- mistura entre coluna visual e estado operacional;
- agentes assumindo subjetividade;
- artefatos opcionais para etapas críticas.

---

## 3. Visão geral do produto

O Kanban Agent é um sistema de execução de trabalho baseado em board, filesystem database e agentes especializados. Ele permite que o usuário descreva uma task e delegue sua condução a um Manager Agent, que coordena Product, Engineering, QA, Review, Deployment e Documentation até a entrega final.

O produto deve resolver estes problemas:

- transformar demandas vagas em specs executáveis;
- reduzir ambiguidade antes da implementação;
- coordenar múltiplos agentes sem perda de contexto;
- preservar histórico, decisões e evidências;
- impedir conclusão sem validação;
- dar visibilidade ao usuário sobre o progresso real;
- permitir intervenção manual sem quebrar consistência;
- tornar o projeto legível para humanos e agentes.

---

## 4. Experiência ideal do usuário

### 4.1 Criação da task

O usuário cria uma task com linguagem natural, por exemplo:

```text
Melhore o workflow do Kanban Agent para garantir que toda task passe por spec, planejamento, execução e validação antes de Done.
```

A UI deve permitir ao usuário informar opcionalmente:

- prioridade;
- contexto adicional;
- arquivos relevantes;
- deadline;
- projeto/repositório afetado;
- preferências de aprovação;
- nível de autonomia permitido.

### 4.2 Intake pelo Manager

O Manager recebe a task e registra:

- intenção do usuário;
- contexto disponível;
- riscos aparentes;
- se a task é técnica, produto, documentação, pesquisa ou operação;
- se existe ambiguidade inicial;
- próximo responsável.

Por padrão, o próximo responsável é o Product Agent.

### 4.3 Especificação pelo Product Agent

O Product Agent cria ou atualiza `task-spec.md`. Ele deve:

- transformar pedido em requisito claro;
- separar escopo e fora de escopo;
- definir comportamento esperado;
- criar critérios de aceite;
- identificar dúvidas;
- pesquisar quando necessário;
- pedir esclarecimento ao usuário quando houver subjetividade.

### 4.4 Planejamento técnico

O Manager decide se a task precisa de Technical Plan.

Precisa de plano técnico quando houver:

- alteração de código;
- alteração de arquitetura;
- alteração de schema;
- integração externa;
- impacto em runtime;
- risco de regressão;
- múltiplos arquivos/módulos;
- migração;
- alteração de tool, agent ou orchestrator.

### 4.5 Execução

Engineering só executa depois do DoR Gate. Durante a execução, deve seguir a spec e registrar:

- arquivos alterados;
- comandos executados;
- decisões técnicas;
- bloqueios;
- desvios em relação ao plano;
- evidências parciais.

### 4.6 Validação

QA valida critério por critério. A saída é `validation-report.md`, contendo:

- critério de aceite;
- método de validação;
- evidência;
- resultado;
- falhas encontradas;
- recomendação: aprovar, reprovar ou pedir ajuste.

### 4.7 Review

Review avalia:

- aderência à spec;
- qualidade técnica;
- riscos;
- regressões;
- completude da validação;
- documentação necessária;
- se há pendências antes de delivery.

### 4.8 Delivery

Deployment registra evidência de entrega, mas não move a task para Done automaticamente. Depois do delivery, a task volta ao Manager para DoD Gate.

### 4.9 Conclusão

O Manager só move para Done se:

- spec existe;
- DoR passou;
- implementação foi concluída;
- validação passou;
- review passou ou foi justificado;
- deployment não deixou pendência;
- documentação necessária foi atualizada;
- resumo final foi registrado;
- não há dúvidas bloqueadoras.

---

## 5. Modelo operacional final

### 5.1 Entidades principais

```yaml
Task:
  id: string
  title: string
  description: string
  phase: TaskPhase
  current_role: AgentRole
  board_column: BoardColumn
  gate_status: GateStatus
  priority: low | normal | high | urgent
  autonomy_level: manual | assisted | autonomous_with_gates
  created_at: datetime
  updated_at: datetime
  created_by: user | system | agent

TaskPhase:
  - intake
  - spec
  - planning
  - execution
  - validation
  - review
  - delivery
  - done
  - blocked
  - cancelled

AgentRole:
  - manager
  - product
  - design
  - architecture
  - engineering
  - qa
  - review
  - deployment
  - documentation
  - none

GateStatus:
  - pending
  - passed
  - failed
  - waiting_user
  - skipped_with_reason
```

### 5.2 Board columns recomendadas

```yaml
BoardColumn:
  inbox:
    purpose: Tasks recém-criadas aguardando intake do Manager.

  needs_spec:
    purpose: Tasks que precisam de Product Spec.

  waiting_user:
    purpose: Tasks bloqueadas por dúvida, aprovação ou decisão do usuário.

  ready:
    purpose: Tasks com spec e DoR aprovados, prontas para execução.

  in_progress:
    purpose: Tasks em planejamento, execução, validação ou delivery.

  in_review:
    purpose: Tasks aguardando QA, Review ou DoD Gate.

  blocked:
    purpose: Tasks bloqueadas por erro, dependência externa, conflito ou falta de contexto.

  done:
    purpose: Tasks concluídas com DoD aprovado.

  cancelled:
    purpose: Tasks encerradas sem entrega.
```

### 5.3 Separação visual recomendada

Cada card deve exibir:

- título;
- phase;
- current role;
- gate atual;
- próximo gate;
- status de spec;
- status de validação;
- bloqueios;
- última atividade;
- botão principal contextual.

Exemplo:

```text
[In Progress]
Task: Implement final spec-first workflow gates
Phase: validation
Role: qa
Gate: Validation Gate pending
Spec: approved
Plan: approved
Validation: running
```

---

## 6. Workflow final da task

### 6.1 Fluxo padrão

```text
User creates task
  -> Manager Intake
  -> Product Spec
  -> Clarification, se necessário
  -> Spec Gate
  -> Manager Planning Decision
  -> Technical Plan, se necessário
  -> DoR Gate
  -> Engineering Execution
  -> QA Validation
  -> Review
  -> Documentation, se necessário
  -> Deployment, se necessário
  -> DoD Gate
  -> Done
```

### 6.2 Fluxo com dúvida do usuário

```text
Product/Manager detects ambiguity
  -> record_question
  -> phase = spec ou planning
  -> board_column = waiting_user
  -> current_role = none
  -> user answers
  -> Product updates task-spec.md
  -> Manager resumes workflow
```

### 6.3 Fluxo com validação falhando

```text
QA fails one or more acceptance criteria
  -> record_validation(status = failed)
  -> phase = validation
  -> board_column = in_review ou blocked
  -> Manager reviews failure
  -> Engineering receives fix handoff
  -> Execution resumes
  -> QA validates again
```

### 6.4 Fluxo com task manualmente movida pelo usuário

Quando o usuário move uma task manualmente:

1. O orquestrador deve interromper execução ativa com segurança.
2. Deve registrar evento `manual_move`.
3. Deve avaliar se a nova coluna é compatível com os gates.
4. Se a nova coluna violar gate crítico, deve colocar a task em `waiting_user` ou `blocked`, explicando o motivo.
5. Se for válido, deve atualizar phase/current_role/board_column.
6. Deve preservar o contexto e permitir retomada.

Exemplo: se o usuário mover para `Done`, o sistema não deve concluir automaticamente. Deve executar o DoD Gate. Se falhar, a task vai para `in_review` ou `blocked`.

---

## 7. Agentes e responsabilidades

### 7.1 Manager Agent

Responsável por orquestração, não por implementação.

Deve:

- receber toda task;
- fazer intake;
- acionar Product Agent antes de execução técnica;
- garantir que existe spec;
- decidir se precisa de Design, Architecture, Engineering, QA, Review, Deployment ou Documentation;
- quebrar trabalho em subtasks quando necessário;
- executar gates;
- lidar com bloqueios;
- preservar contexto entre agentes;
- registrar decisões relevantes;
- impedir bypass de DoR/DoD;
- fazer resumo final;
- mover para Done somente após DoD Gate.

Não deve:

- alterar código diretamente;
- inventar requisito;
- concluir sem validação;
- aceitar deploy como Done;
- permitir que Engineering pule QA;
- mover task técnica para execução sem spec.

### 7.2 Product Agent

Dono da Task Spec.

Deve:

- transformar demanda em `task-spec.md`;
- identificar ambiguidades;
- pesquisar referências externas quando útil;
- definir escopo e fora de escopo;
- definir personas impactadas;
- definir comportamento esperado;
- definir critérios de aceite;
- definir riscos e dependências;
- registrar perguntas ao usuário;
- atualizar a spec quando houver resposta;
- marcar spec como ready apenas quando critérios mínimos forem atendidos.

Não deve:

- implementar;
- decidir arquitetura sem Architecture Agent quando houver risco;
- inventar comportamento de produto;
- esconder incertezas;
- aprovar sua própria spec quando política exigir aprovação do Manager ou usuário.

### 7.3 Design Agent

Usado quando houver impacto visual, interação, layout, usabilidade ou experiência do usuário.

Deve produzir:

- `design-notes.md`;
- descrição de UI/UX esperada;
- fluxos de interação;
- estados vazios, loading, erro e sucesso;
- recomendações de simplificação.

### 7.4 Architecture Agent

Usado quando houver impacto estrutural.

Deve produzir ou atualizar:

- `architecture-notes.md`;
- riscos técnicos;
- alternativas consideradas;
- decisão recomendada;
- impacto em módulos;
- plano de migração quando necessário.

### 7.5 Engineering Agent

Responsável por implementação.

Deve:

- seguir `task-spec.md` e `technical-plan.md`;
- registrar alterações;
- não alterar escopo;
- reportar bloqueios;
- executar testes relevantes;
- registrar evidências;
- criar handoff para QA.

Não deve:

- mover direto para Done;
- decidir comportamento de produto não especificado;
- ignorar critérios de aceite;
- fazer alterações destrutivas sem confirmação.

### 7.6 QA / Validation Agent

Responsável por validação.

Deve:

- mapear cada critério de aceite para evidência;
- executar testes automatizados quando existirem;
- registrar testes manuais quando necessários;
- criar `validation-report.md`;
- aprovar ou reprovar a entrega;
- devolver para Engineering quando falhar.

### 7.7 Review Agent

Responsável por revisão crítica.

Deve:

- revisar aderência à spec;
- revisar riscos;
- revisar qualidade técnica;
- revisar evidências de QA;
- bloquear severidades high, critical ou blocking;
- recomendar documentação ou ajustes.

### 7.8 Deployment Agent

Responsável por delivery operacional.

Deve:

- executar deploy ou preparar instrução de deploy;
- registrar evidência;
- registrar ambiente, versão, commit ou release;
- reportar falha;
- devolver ao Manager para DoD Gate.

Não deve:

- mover task diretamente para Done;
- substituir validação de QA;
- ignorar aprovação final.

### 7.9 Documentation Agent

Responsável por documentação quando a task alterar comportamento, uso, arquitetura, setup ou operação.

Deve:

- atualizar docs relevantes;
- gerar changelog quando necessário;
- registrar decisões importantes;
- manter clareza para futuros agentes.

---

## 8. Artefatos oficiais por task

### 8.1 Estrutura recomendada no FSDB

```text
tasks/{task_id}/
  task.yaml
  task-spec.md
  technical-plan.md
  implementation-tasks.md
  validation-report.md
  review-report.md
  deployment-report.md
  decision-log.md
  summary.md
  events.jsonl
  handoffs/
    001-manager-to-product.md
    002-product-to-manager.md
    003-manager-to-engineering.md
    004-engineering-to-qa.md
  evidence/
    commands.log
    tests.log
    screenshots/
    artifacts/
```

### 8.2 Obrigatoriedade

| Artefato | Obrigatório quando | Dono |
|---|---|---|
| `task.yaml` | Sempre | System/Manager |
| `task-spec.md` | Sempre, inclusive Mini Spec | Product |
| `technical-plan.md` | Alteração técnica não trivial | Manager/Architecture/Engineering |
| `implementation-tasks.md` | Quando houver subtasks técnicas | Manager/Engineering |
| `validation-report.md` | Antes de Done | QA |
| `review-report.md` | Quando houver review formal | Review |
| `deployment-report.md` | Quando houver deploy/delivery | Deployment |
| `decision-log.md` | Sempre que houver decisão relevante | Todos, coordenado pelo Manager |
| `summary.md` | Antes de Done | Manager |
| `handoffs/*.md` | Toda troca relevante de agente | Agente remetente |
| `events.jsonl` | Sempre | System |

---

## 9. Template oficial da Task Spec

O Product Agent deve gerar `task-spec.md` usando este template.

```md
# Task Spec

## 1. Título

Nome curto, claro e acionável da task.

## 2. Contexto

Por que essa task existe, qual problema levou a ela e quais informações relevantes já são conhecidas.

## 3. Problema a resolver

Descrição objetiva do problema. Deve evitar misturar solução com problema.

## 4. Objetivo final

Resultado esperado em termos verificáveis.

## 5. Escopo

O que deve ser feito.

## 6. Fora de escopo

O que explicitamente não deve ser feito nesta task.

## 7. Usuários ou personas impactadas

Quem será impactado pela mudança.

## 8. Comportamento esperado

Como o sistema deve se comportar depois da entrega.

## 9. Fluxo esperado

Passo a passo do fluxo do usuário, agente ou sistema.

## 10. Requisitos funcionais

Lista de requisitos que o sistema deve cumprir.

## 11. Requisitos não funcionais

Performance, confiabilidade, segurança, rastreabilidade, UX, manutenibilidade ou compatibilidade.

## 12. Critérios de aceite

Critérios objetivos, testáveis e rastreáveis.

## 13. Casos de teste esperados

Cenários mínimos que QA ou Engineering deve validar.

## 14. Dependências

Arquivos, módulos, tools, sistemas, dados, decisões ou integrações necessárias.

## 15. Riscos

Riscos técnicos, de produto, UX, dados, segurança ou operação.

## 16. Dúvidas em aberto

Dúvidas que ainda precisam ser resolvidas.

## 17. Decisões que precisam de confirmação do usuário

Decisões subjetivas, destrutivas, de escopo ou de produto.

## 18. Definition of Ready

Checklist para liberar execução.

## 19. Definition of Done

Checklist para concluir a task.

## 20. Histórico de revisões da spec

Registro de alterações relevantes na spec.
```

### 9.1 Mini Spec

Para tasks simples, o Product Agent pode criar uma Mini Spec:

```md
# Mini Task Spec

## Intenção do usuário

## Resultado esperado

## Escopo

## Fora de escopo

## Critérios de aceite

## Riscos ou dúvidas

## Pode seguir sem perguntar?
```

Mini Spec não elimina DoD. Ela apenas reduz o peso da especificação.

---

## 10. Definition of Ready Gate

A task só pode entrar em execução se:

- existe `task-spec.md` ou Mini Spec;
- objetivo final está claro;
- escopo e fora de escopo estão definidos;
- critérios de aceite existem;
- dúvidas bloqueadoras estão resolvidas;
- agente executor está definido;
- dependências principais estão conhecidas;
- riscos relevantes estão mapeados;
- plano técnico existe quando necessário;
- usuário aprovou decisões subjetivas quando necessário;
- Manager registrou aprovação do DoR.

### 10.1 Saída do DoR Gate

```yaml
gate: definition_of_ready
status: passed | failed | waiting_user
checked_by: manager
required_artifacts:
  - task-spec.md
optional_artifacts:
  - technical-plan.md
  - design-notes.md
  - architecture-notes.md
blocking_issues: []
decision: proceed | ask_user | block
```

---

## 11. Definition of Done Gate

A task só pode ir para `Done` se:

- `task-spec.md` existe;
- critérios de aceite foram validados;
- `validation-report.md` existe;
- falhas críticas foram resolvidas;
- review foi executado ou justificado;
- deployment foi executado ou marcado como não aplicável;
- documentação foi atualizada ou marcada como não aplicável;
- decisões relevantes estão registradas em `decision-log.md`;
- handoffs principais estão registrados;
- resumo final existe;
- não há dúvidas bloqueadoras;
- Manager aprovou a conclusão.

### 11.1 Regra absoluta

Nenhuma tool, botão de UI, agente executor ou deploy pode mover uma task para `Done` sem passar pelo DoD Gate.

---

## 12. Handoff entre agentes

Todo handoff relevante deve gerar um arquivo em `handoffs/`.

Template:

```md
# Handoff

## De

Agente remetente.

## Para

Agente destinatário.

## Motivo

Por que o handoff está acontecendo.

## Contexto necessário

Resumo do que o próximo agente precisa saber.

## Artefatos relevantes

- task-spec.md
- technical-plan.md
- decision-log.md

## Decisões tomadas

Lista de decisões já registradas.

## Dúvidas abertas

Dúvidas que ainda existem.

## Critérios de sucesso

O que o próximo agente deve entregar.

## Restrições

O que o próximo agente não pode fazer.

## Próxima ação recomendada
```

---

## 13. Regras para perguntar ao usuário

### 13.1 Deve perguntar

O agent deve perguntar quando houver:

- requisito ambíguo;
- múltiplas soluções plausíveis com trade-offs relevantes;
- impacto de UX ou produto;
- mudança destrutiva;
- alteração de dados persistidos;
- alteração de contrato público;
- remoção de funcionalidade;
- mudança de arquitetura;
- conflito entre requisitos;
- falta de critério de aceite;
- risco operacional relevante;
- decisão de negócio;
- alteração de permissões;
- alteração de comportamento de agentes;
- falta de contexto que impeça entrega concreta.

### 13.2 Não deve perguntar

O agent pode seguir sem perguntar quando a decisão for:

- correção técnica objetiva;
- melhoria interna sem impacto de produto;
- ajuste de typo ou documentação;
- refactor seguro e local;
- execução de teste;
- validação automática;
- ação já especificada e aprovada;
- registro de evidência;
- criação de artefato obrigatório.

Mesmo nesses casos, deve registrar a decisão se ela for relevante.

### 13.3 Formato de pergunta ao usuário

Quando precisar perguntar, o agent deve:

- explicar o bloqueio;
- listar opções plausíveis;
- recomendar uma opção quando houver base técnica;
- deixar claro o impacto;
- não continuar execução até receber resposta se a dúvida for bloqueadora.

---

## 14. Tools necessárias

### 14.1 Tools de spec

#### `create_task_spec`

- Agente: Product.
- Input: task id, contexto, pedido original, arquivos relevantes.
- Output: `task-spec.md`.
- Efeito: atualiza phase para `spec`.
- Regra: obrigatório antes de execução técnica.

#### `update_task_spec`

- Agente: Product.
- Input: task id, mudança, motivo, resposta do usuário.
- Output: spec atualizada e revision log.
- Regra: deve registrar mudança relevante em `decision-log.md` quando alterar escopo.

#### `approve_task_spec`

- Agente: Manager ou usuário, conforme política.
- Input: task id.
- Output: Spec Gate `passed`.
- Regra: não aprova se houver dúvida bloqueadora.

### 14.2 Tools de planejamento

#### `create_technical_plan`

- Agente: Architecture ou Engineering, coordenado pelo Manager.
- Output: `technical-plan.md`.
- Regra: obrigatório para mudanças técnicas não triviais.

#### `approve_plan`

- Agente: Manager.
- Output: Planning Gate `passed`.

### 14.3 Tools de gates

#### `run_definition_of_ready_gate`

- Agente: Manager.
- Output: status DoR.
- Bloqueia execução quando falhar.

#### `run_definition_of_done_gate`

- Agente: Manager.
- Output: status DoD.
- Único caminho para `Done`.

### 14.4 Tools de execução

#### `start_execution`

- Agente: Manager.
- Output: handoff para Engineering.
- Regra: só roda com DoR `passed`.

#### `record_execution_evidence`

- Agente: Engineering.
- Output: evidências em `evidence/` e eventos.

### 14.5 Tools de validação

#### `record_validation`

- Agente: QA.
- Output: `validation-report.md`.
- Regra: obrigatório antes de DoD.

#### `request_fix`

- Agente: QA ou Review.
- Output: handoff para Engineering com falhas.

### 14.6 Tools de decisão e handoff

#### `record_decision`

- Agente: qualquer agente, coordenado pelo Manager.
- Output: entrada em `decision-log.md`.

#### `record_handoff`

- Agente: agente remetente.
- Output: arquivo em `handoffs/`.

### 14.7 Tools a alterar ou bloquear

#### `complete_task`

Mudança obrigatória:

- não pode aceitar `nextColumn: done` diretamente;
- deve virar `request_completion` ou chamar DoD Gate;
- se DoD falhar, task não vai para Done.

#### `deploy_task`

Mudança obrigatória:

- não pode mover direto para `done`;
- deve gerar `deployment-report.md`;
- deve devolver ao Manager para DoD Gate.

### 14.8 Tools a remover ou descontinuar

- Qualquer tool que mova task para `done` sem DoD.
- Qualquer ação de UI que chame conclusão direta.
- Qualquer roteamento puramente heurístico que pule Product Spec.

---

## 15. Estados e transições

### 15.1 Transições permitidas

| Origem | Destino | Quem decide | Gate |
|---|---|---|---|
| inbox | needs_spec | Manager | Intake |
| needs_spec | waiting_user | Product/Manager | Clarification |
| waiting_user | needs_spec | Manager/Product | User answered |
| needs_spec | ready | Manager | Spec Gate + DoR |
| ready | in_progress | Manager | Start execution |
| in_progress | in_review | Engineering/Manager | Execution handoff |
| in_review | in_progress | QA/Review/Manager | Validation failed |
| in_review | blocked | Manager | Blocking issue |
| in_review | done | Manager | DoD Gate |
| any | cancelled | User/Manager | Cancellation policy |
| any | blocked | Manager/System | Blocking failure |

### 15.2 Transições proibidas

- Engineering -> Done.
- Deployment -> Done.
- UI button -> Done.
- Manual move -> Done sem DoD.
- Product -> Execution sem Manager.
- Manager -> Engineering sem Spec Gate.
- Review -> Done sem Validation Report.

---

## 16. Revisão de telas, UX e configurações

### 16.1 Problema atual

A auditoria apontou que board, modal e settings ainda expõem colunas e controles baseados em role/status, não em gates formais de Spec/Plan/Execution/Validation. Também existe botão `Completar` direto, o que permite bypass da Definition of Done.

### 16.2 Tela principal do Kanban

#### Deve mostrar

- colunas visuais simples;
- fase real da task;
- agente atual;
- gate atual;
- status de spec;
- status de validação;
- bloqueios;
- última evidência;
- próxima ação recomendada.

#### Deve alterar

- separar visualmente `board_column` de `task_phase`;
- remover conclusão direta;
- adicionar CTA contextual:
  - “Gerar Spec”;
  - “Responder dúvida”;
  - “Aprovar Spec”;
  - “Iniciar execução”;
  - “Validar”;
  - “Solicitar conclusão ao Manager”.

### 16.3 Modal de task

O modal deve ter abas oficiais:

1. **Overview**
2. **Spec**
3. **Plan**
4. **Execution**
5. **Validation**
6. **Review**
7. **Handoffs**
8. **Decisions**
9. **Files**
10. **Timeline**
11. **Chat**

#### Overview

Mostra estado, fase, role, gates, bloqueios e próxima ação.

#### Spec

Mostra `task-spec.md`, status da spec e aprovação.

#### Plan

Mostra `technical-plan.md`, subtasks e dependências.

#### Execution

Mostra arquivos alterados, comandos, logs e evidências.

#### Validation

Mostra `validation-report.md`, critério por critério.

#### Review

Mostra riscos, severidades, comentários e pendências.

#### Handoffs

Mostra a cadeia de handoffs entre agentes.

#### Decisions

Mostra `decision-log.md` com filtro por agente/data.

#### Timeline

Mostra eventos do `events.jsonl` em formato legível.

#### Chat

Permite conversar com o Manager no contexto da task.

### 16.4 Settings globais

Criar configurações para:

- exigir spec para toda task;
- permitir ou não Mini Spec;
- exigir aprovação de spec pelo usuário;
- exigir plano técnico por tipo de mudança;
- exigir QA antes de Review;
- exigir Review antes de Done;
- impedir deploy automático;
- autonomia do Manager;
- política de perguntas ao usuário;
- timeout de execução;
- retry policy;
- sandbox policy;
- tool permissions por agent;
- hooks por estado/fase;
- artefatos obrigatórios;
- current-state validation;
- políticas de ações destrutivas.

### 16.5 Settings por projeto

- stack do projeto;
- comandos de test/build/lint;
- paths relevantes;
- agentes habilitados;
- providers habilitados;
- regras de branch/worktree;
- ambiente de execução;
- critérios de documentação;
- Definition of Done customizada.

### 16.6 Settings por coluna/fase

- hooks de entrada;
- hooks de saída;
- agente padrão;
- gates obrigatórios;
- timeout;
- retry;
- aprovação necessária;
- transições permitidas.

### 16.7 Settings por agent

- tools permitidas;
- escopo de responsabilidade;
- limites de autonomia;
- prompt base;
- critérios para perguntar;
- critérios para handoff;
- artefatos que pode criar/alterar;
- transições que pode solicitar.

### 16.8 Componentes a criar

#### Approval Drawer

Centraliza aprovações pendentes:

- aprovar spec;
- aprovar plano;
- aprovar decisão subjetiva;
- aprovar ação destrutiva;
- aprovar conclusão.

#### Blockers View

Mostra tasks bloqueadas, motivo, responsável e próxima ação.

#### Gate Inspector

Mostra por que uma task pode ou não avançar.

#### Evidence Panel

Mostra evidências vinculadas a critérios de aceite.

#### Handoff Timeline

Mostra a sequência Manager -> Product -> Manager -> Engineering -> QA -> Review -> Deployment -> Manager.

### 16.9 Componentes a remover ou substituir

| Componente/Ação | Decisão | Motivo |
|---|---|---|
| Botão `Completar` direto | Remover/substituir | Bypassa DoD |
| `deploy_task` movendo para Done | Alterar | Deployment não é conclusão |
| Colunas como fonte de verdade operacional | Alterar | Mistura visual com workflow |
| Roteamento heurístico como regra principal | Substituir | Frágil e não determinístico |
| Controles de settings sem gate policy | Expandir | Não sustenta operação real |

---

## 17. O que existe hoje e deve ser aproveitado

Com base na auditoria anterior, já existem bases importantes:

- roles principais em `packages/core/src/roles.js`;
- contratos em `packages/core/src/contracts.js`;
- schemas em `packages/schemas/src/index.js`;
- FSDB em `packages/fsdb/src/index.js`;
- agent runtime em `packages/agent-runtime/src/index.js`;
- orquestrador em `packages/orchestrator/src/task-agent-workflow-service.js`;
- gate service inicial em `packages/orchestrator/src/gate-service.js`;
- review service em `packages/orchestrator/src/review-service.js`;
- deployment service em `packages/orchestrator/src/deployment-service.js`;
- UI principal em `apps/web/src/App.tsx`;
- modal de task em `apps/web/src/components/TaskModal.tsx`;
- board em `apps/web/src/components/Board.tsx`;
- settings dialog em `apps/web/src/components/SettingsDialog.tsx`;
- testes unitários e e2e iniciais.

Essas peças não devem ser descartadas. Elas devem ser adaptadas para o modelo de gates e artefatos obrigatórios.

---

## 18. O que precisa ser refinado

| Item | Problema atual | Refinamento | Prioridade |
|---|---|---|---|
| `complete_task` | Permite Done sem DoD | Transformar em request de conclusão + DoD Gate | P0 |
| Botão `Completar` | Bypass manual | Trocar por “Solicitar conclusão ao Manager” | P0 |
| `deploy_task` | Move para Done | Gerar deployment report e voltar ao Manager | P0 |
| Manager routing | Heurístico | Gate determinístico Product -> Spec -> DoR | P0 |
| Product Agent | Usa `acceptance.md`/heurísticas | Dono formal de `task-spec.md` | P0 |
| QA | Sem artefato obrigatório | Exigir `validation-report.md` | P0 |
| Review | Não exige QA evidence | Bloquear review sem validation report | P0 |
| Board | Mistura coluna/role/status | Separar board_column, phase, role e gate | P1 |
| Modal | Sem abas oficiais | Criar painéis Spec/Plan/Validation/Handoffs/Decisions | P1 |
| Settings | Poucas políticas de workflow | Adicionar gates, approvals, tools, hooks e retry | P1 |
| Retry/resume | Parcial | Formalizar timeout, retries e rehydration | P1 |
| Sandbox | Pendente | Isolamento real por task | P2 |

---

## 19. O que precisa ser criado

### P0

- `task-spec.md` obrigatório.
- `validation-report.md` obrigatório.
- `decision-log.md` obrigatório.
- Diretório `handoffs/`.
- DoR Gate sistêmico.
- DoD Gate sistêmico.
- Tools `create_task_spec`, `approve_task_spec`, `record_validation`, `record_decision`, `record_handoff`.
- Testes impedindo Done sem DoD.

### P1

- `technical-plan.md` formal.
- `implementation-tasks.md`.
- `review-report.md`.
- `deployment-report.md`.
- Gate Inspector na UI.
- Approval Drawer.
- Blockers View.
- Evidence Panel.
- Settings por workflow, projeto, fase, agent e tool.

### P2

- Sandbox real por task.
- Rehydration completa de contexto.
- Current-state validation com browser/API/logs.
- Documentation Agent formal.
- Revisão adversarial/edge-case opcional para tasks de alto risco.

---

## 20. O que precisa ser removido

| Item | Por que remover | Risco de manter |
|---|---|---|
| Done direto via `complete_task` | Viola DoD | Tasks falsas como concluídas |
| Botão direto `Completar` | Permite bypass humano | Perda de confiabilidade |
| Deployment -> Done automático | Confunde entrega com conclusão | Falhas pós-deploy sem revisão |
| Fast path técnico | Pula spec e validação | Regressões e escopo inventado |
| Roteamento por palavra-chave como regra final | Não determinístico | Agent toma decisão errada |
| Artefatos críticos opcionais | Quebra rastreabilidade | Impossível auditar entrega |

---

## 21. Falhas, bloqueios e retries

### 21.1 Erro de tool

- registrar erro em `events.jsonl`;
- registrar contexto mínimo;
- tentar retry conforme policy;
- se persistir, mover para `blocked`;
- Manager decide próxima ação.

### 21.2 Timeout

- interromper execução com segurança;
- registrar último estado conhecido;
- preservar handoff parcial;
- mover para `blocked` ou `waiting_user` se precisar de decisão;
- permitir retomada com contexto reidratado.

### 21.3 Validação reprovada

- QA registra falhas em `validation-report.md`;
- Manager cria handoff para Engineering;
- Engineering corrige apenas o necessário;
- QA valida novamente.

### 21.4 Conflito entre spec e implementação

- bloquear avanço;
- registrar conflito;
- Manager decide se ajusta implementação ou reabre spec;
- se alterar spec de produto, pode exigir aprovação do usuário.

### 21.5 Falta de contexto

- Product ou Manager deve perguntar;
- task vai para `waiting_user`;
- nenhuma execução técnica continua se a dúvida for bloqueadora.

---

## 22. Plano de implementação

### Fase 1 — Bloqueios críticos

Objetivo: impedir conclusão falsa.

Tarefas:

1. Alterar `complete_task` para não aceitar `done` diretamente.
2. Criar `run_definition_of_done_gate`.
3. Remover/substituir botão `Completar` na UI.
4. Alterar `deploy_task` para não mover para Done.
5. Criar `task-spec.md` obrigatório na triagem.
6. Criar `validation-report.md` obrigatório antes de Done.
7. Criar testes unitários para Done sem DoD.
8. Criar teste e2e tentando concluir sem validação.

Critério de aceite:

- nenhuma task técnica consegue ir para Done sem DoD aprovado.

### Fase 2 — Spec e handoff formais

Objetivo: tornar o workflow spec-first.

Tarefas:

1. Implementar `create_task_spec`.
2. Implementar `update_task_spec`.
3. Implementar `approve_task_spec`.
4. Implementar `record_handoff`.
5. Implementar `record_decision`.
6. Atualizar prompts do Manager e Product.
7. Atualizar schemas e FSDB para artefatos oficiais.
8. Substituir roteamento heurístico por gate determinístico.

Critério de aceite:

- toda task técnica passa por Product Spec antes de Engineering.

### Fase 3 — Planejamento e validação

Objetivo: conectar execução a critérios de aceite.

Tarefas:

1. Criar `technical-plan.md`.
2. Criar `implementation-tasks.md`.
3. Implementar `run_definition_of_ready_gate`.
4. Implementar `record_validation`.
5. Criar mapeamento critério -> evidência -> status.
6. Refatorar Review para exigir QA evidence.
7. Criar e2e Spec -> Plan -> Engineering -> QA -> Review -> Done.

Critério de aceite:

- QA consegue reprovar critério específico e devolver para Engineering.

### Fase 4 — UX operacional

Objetivo: dar confiança e controle ao usuário.

Tarefas:

1. Atualizar Board para exibir phase/role/gate.
2. Criar abas oficiais no Task Modal.
3. Criar Approval Drawer.
4. Criar Blockers View.
5. Criar Gate Inspector.
6. Criar Evidence Panel.
7. Criar Settings de workflow/gates/approvals/tools/hooks/retry.
8. Trocar ações diretas por ações mediadas pelo Manager.

Critério de aceite:

- usuário entende em que fase a task está, quem está responsável e o que falta para Done.

### Fase 5 — Hardening

Objetivo: uso contínuo em produção.

Tarefas:

1. Implementar sandbox real por task.
2. Completar retry/timeout/resume rehydration.
3. Implementar current-state validation.
4. Criar Documentation Agent formal.
5. Criar revisão adversarial opcional.
6. Criar documentação operacional.
7. Criar métricas de throughput, failure rate, blocked time e DoD failures.

Critério de aceite:

- sistema consegue retomar task interrompida com contexto suficiente e sem quebrar gates.

---

## 23. Testes obrigatórios

### 23.1 Testes unitários

- `complete_task` não move para Done sem DoD.
- `deploy_task` não move para Done.
- DoR falha sem `task-spec.md`.
- DoD falha sem `validation-report.md`.
- Engineering não pode solicitar Done.
- Manager não pode iniciar Engineering sem Spec Gate.
- Manual move para Done executa DoD Gate.

### 23.2 Testes e2e

- Criar task vaga -> Product pergunta -> usuário responde -> spec -> execução -> QA -> Done.
- Criar task técnica -> spec -> plan -> engineering -> validation fails -> fix -> validation passes -> Done.
- Tentar clicar em Completar sem validação -> bloqueado.
- Deploy executado -> volta para Manager -> DoD -> Done.
- Usuário move task durante execução -> execução interrompida e retomada corretamente.

### 23.3 Testes de UX

- Card mostra fase e gate corretos.
- Modal mostra Spec, Plan, Validation, Handoffs e Decisions.
- Approval Drawer mostra aprovações pendentes.
- Blockers View mostra motivo e responsável.
- Gate Inspector explica por que a task não pode avançar.

---

## 24. Checklist final de readiness do produto

O Kanban Agent só deve ser considerado pronto para uso real quando:

- [ ] Toda task tem `task-spec.md` ou Mini Spec.
- [ ] Product Agent é dono formal da spec.
- [ ] Manager não executa código.
- [ ] Engineering não move para Done.
- [ ] QA gera `validation-report.md`.
- [ ] Review exige evidência de QA.
- [ ] Deployment não conclui sozinho.
- [ ] DoR Gate bloqueia execução sem spec suficiente.
- [ ] DoD Gate é o único caminho para Done.
- [ ] Botão `Completar` direto foi removido/substituído.
- [ ] Board separa coluna, fase, role e gate.
- [ ] Modal tem abas Spec, Plan, Validation, Handoffs e Decisions.
- [ ] Settings permitem configurar gates, approvals, tools, hooks e retries.
- [ ] Manual move não viola gates.
- [ ] Handoffs são registrados.
- [ ] Decision log existe.
- [ ] Falhas e retries são rastreáveis.
- [ ] Tests unitários e e2e cobrem bypasses críticos.
- [ ] Sandbox real por task existe ou há limitação documentada.
- [ ] O usuário consegue entender o que está acontecendo sem ler logs técnicos.

---

## 25. Critérios de aceite deste documento

Este documento é considerado completo se:

- define o workflow final de ponta a ponta;
- incorpora conceitos de Spec Kit e BMAD;
- adapta esses conceitos ao Kanban Agent;
- define papéis dos agentes;
- define artefatos obrigatórios;
- define DoR e DoD;
- define regras para perguntar ao usuário;
- define tools necessárias;
- define mudanças de UX/telas/configurações;
- lista o que existe, o que refinar, o que criar e o que remover;
- inclui plano de implementação;
- inclui testes obrigatórios;
- elimina ambiguidade sobre Done;
- deixa claro que diagnóstico não é suficiente sem enforcement sistêmico.

---

## 26. Referências consultadas

### Projeto atual

- `final-workflow-definition.output.md`
- `AGENTS.md`
- `packages/core/src/roles.js`
- `packages/core/src/contracts.js`
- `packages/schemas/src/index.js`
- `packages/fsdb/src/index.js`
- `packages/agent-runtime/src/index.js`
- `packages/orchestrator/src/task-agent-workflow-service.js`
- `packages/orchestrator/src/gate-service.js`
- `packages/orchestrator/src/review-service.js`
- `packages/orchestrator/src/deployment-service.js`
- `apps/web/src/App.tsx`
- `apps/web/src/components/TaskModal.tsx`
- `apps/web/src/components/Board.tsx`
- `apps/web/src/components/SettingsDialog.tsx`

### Benchmark externo

- Spec Kit repository: https://github.com/github/spec-kit
- Spec Kit SDD docs: https://github.github.com/spec-kit/concepts/sdd.html
- BMAD docs: https://docs.bmad-method.org/
- BMAD workflow map: https://docs.bmad-method.org/reference/workflow-map/
- BMAD core tools: https://docs.bmad-method.org/reference/core-tools/

---

## 27. Decisão final

A direção correta para o Kanban Agent é:

```text
Kanban visual + FSDB auditável + Manager como orquestrador + Product Spec obrigatória + gates sistêmicos + QA evidence + DoD único para Done.
```

O produto não deve depender apenas de prompts para garantir qualidade. Prompts ajudam os agentes a se comportarem bem, mas o sistema precisa impor invariantes no orquestrador, schemas, FSDB, tools e UI.

A principal mudança conceitual é parar de tratar o Kanban como um quadro de status e passar a tratá-lo como uma **máquina operacional de workflow com contratos, gates, handoffs e evidências**.

