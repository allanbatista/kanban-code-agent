# Agent Workflow: Enxame Hierarquico e Recursivo

Este documento descreve o workflow de agentes no modelo de Recursive Swarm. A regra central e que Task e Subtask sao a mesma entidade: uma Subtask e apenas uma Task com `parent_task_id`.

## Modelo Recursivo

```mermaid
classDiagram
  class Agent {
    +id
    +persona
    +system_prompt
    +tools
  }

  class Task {
    +id
    +parent_task_id
    +context_input
    +manager_id
    +assignee_id
    +status
    +output
    +depth
  }

  Agent "1" --> "0..*" Task : manages
  Agent "1" --> "0..*" Task : executes
  Task "0..1" --> "0..*" Task : parent/subtasks
```

## Maquina de Estados

```mermaid
stateDiagram-v2
  [*] --> InProgress: task assigned

  InProgress --> WaitingReview: responder diretamente
  InProgress --> WaitingResponse: pedir informacao ao manager
  InProgress --> Orchestrating: decompor em subtasks

  WaitingResponse --> InProgress: manager responde

  Orchestrating --> WaitingReview: subtasks aprovadas e output consolidado
  Orchestrating --> InProgress: feedback ou nova decomposicao

  WaitingReview --> Completed: manager aprova
  WaitingReview --> InProgress: manager rejeita com feedback

  Completed --> [*]
```

## Decisao do Assignee

```mermaid
flowchart TD
  A[Assignee recebe Task] --> B{Tem dados e capacidade?}
  B -->|Sim| C[Gerar output]
  C --> D[Status: Waiting Review]

  B -->|Nao, falta contexto| E[Perguntar ao Manager]
  E --> F[Status: Waiting Response]
  F --> G[Manager responde]
  G --> A

  B -->|Nao, problema complexo| H[Criar N Subtasks]
  H --> I[Assignee vira Manager das Subtasks]
  I --> J{Dependencia entre Subtasks?}
  J -->|Independentes| K[Orquestracao paralela]
  J -->|Dependentes| L[Pipeline sequencial]
  K --> M[Revisar outputs das Subtasks]
  L --> M
  M --> N[Consolidar output da Task-mae]
  N --> D
```

## Orquestracao Paralela

```mermaid
flowchart LR
  M[Agent Manager] --> T1[Subtask: Financas]
  M --> T2[Subtask: Marketing]
  M --> T3[Subtask: Tecnologia]

  T1 --> R[Waiting Review]
  T2 --> R
  T3 --> R

  R --> A[Manager aprova]
  A --> C[Combina outputs]
  C --> O[Output da Task-mae]
```

## Orquestracao Sequencial

```mermaid
flowchart LR
  M[Agent Manager] --> D[Subtask 1: Design]
  D --> RD[Review e aprovacao]
  RD --> P[Subtask 2: Programacao]
  P --> RP[Review e aprovacao]
  RP --> Q[Subtask 3: QA]
  Q --> RQ[Review e aprovacao]
  RQ --> O[Output da Task-mae]
```

## Encerramento Recursivo

```mermaid
flowchart BT
  L1[Task folha: Waiting Review] --> M1[Manager intermediario aprova]
  M1 --> T1[Task intermediaria consolida output]
  T1 --> M2[Manager superior aprova]
  M2 --> R[Task raiz: Waiting Review]
  R --> U[Usuario humano aprova]
  U --> C[Completed]
```

## Perguntas e Respostas

Subtasks nao perguntam diretamente ao usuario humano. Uma Task sempre pergunta ao seu `manager_id`.

Se o manager souber responder, ele responde e a Task volta para `In Progress`. Se o manager tambem depender de informacao externa, ele transforma a duvida em uma pergunta para o proprio manager. A pergunta sobe pela arvore ate encontrar um agent que saiba responder ou ate chegar na Task raiz. Apenas o manager da Task raiz pergunta ao usuario humano.

Quando a resposta chega, ela desce pela mesma cadeia de correlacao da pergunta ate a Task que estava bloqueada.

```mermaid
sequenceDiagram
  participant L4 as Subtask depth 4
  participant L3 as Manager depth 3
  participant L2 as Manager depth 2
  participant L1 as Manager depth 1
  participant U as Usuario

  L4->>L3: pergunta ao manager
  alt L3 sabe responder
    L3-->>L4: resposta
  else L3 nao sabe
    L3->>L2: propaga pergunta
    L2->>L1: propaga se necessario
    L1->>U: pergunta ao humano se necessario
    U-->>L1: resposta
    L1-->>L2: resposta
    L2-->>L3: resposta
    L3-->>L4: resposta
  end
```

Mesmo no ultimo nivel (`depth = 4`), a Task pode pedir informacao ao manager. O limite de profundidade bloqueia apenas nova decomposicao em subtasks, nao bloqueia perguntas.

## Review e Resposta de Subtask

O manager de uma subtask e o assignee da Task-mae. Quando uma subtask entrega output, ela entra em `Waiting Review` para esse manager.

- Se o manager aprova, a subtask vira `Completed` e o output fica disponivel para a Task-mae.
- Se o manager rejeita, ele anexa feedback objetivo ao input da subtask e ela volta para `In Progress` com o mesmo assignee.
- Se o manager precisa de mais dados para revisar, ele usa o fluxo de perguntas e respostas acima.
- Quando todas as subtasks diretas estao `Completed`, a Task-mae volta para `In Progress` para consolidar os outputs.

```mermaid
flowchart TD
  S[Subtask gera output] --> W[Waiting Review]
  W --> M{Manager aprova?}
  M -->|Sim| C[Subtask Completed]
  C --> P[Task-mae absorve output]
  M -->|Nao| F[Feedback anexado ao input]
  F --> R[Subtask volta para In Progress]
  M -->|Precisa info| Q[Manager pergunta ao proprio manager]
  Q --> W
```

## Limites de Controle

Para evitar que o enxame saia de controle, a primeira versao usa limite hard-coded de profundidade e nao usa limiter de budget:

- `MAX_DEPTH = 4`: profundidade maxima da arvore de Tasks.
- `max_subtasks_per_task`: limite de fan-out por Task, quando necessario.
- Sem `token_budget` e sem `cost_budget` nesta versao.
- Escalada para usuario humano acontece apenas por pergunta da Task raiz.

Regra recomendada inicial:

```mermaid
flowchart TD
  A[Assignee quer criar Subtasks] --> B{depth < max_depth?}
  B -->|Nao| C[Proibir decomposicao]
  B -->|Sim| D{subtasks <= max_subtasks_per_task?}
  D -->|Nao| C
  D -->|Sim| F[Criar Subtasks com depth + 1]
```

Valores iniciais sugeridos:

- `MAX_DEPTH`: 4.
- `max_subtasks_per_task`: 5.
- Ao atingir `depth = 4`, a Task pode responder, pedir informacao ou entregar output para review, mas nao pode criar subtasks.
