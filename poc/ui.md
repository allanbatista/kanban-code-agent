# UI Specification — Kanban Code Agent

## Visão Geral

Interface web single-page para orquestração visual de agentes de IA em formato kanban com chat integrado e visualização DAG de workflow. Estilo visual baseado no shadcn/ui tema escuro.

**Stack:** React 19 + Vite 6 + pnpm + TypeScript + Tailwind CSS 4 + shadcn/ui

**Localização do layout:** `./layout/`

**Roteamento:** Todas as rotas, parâmetros e estado de UI são refletidos na URL (`react-router-dom` com `useSearchParams`). Cada link é compartilhável e restaura exatamente o estado visual (task aberta, drawer, aba selecionada, filtros, etc).

---

## 1. Instalação e Configuração do Projeto

### 1.1 Setup Inicial (Vite + Tailwind 4 + shadcn/ui)

```bash
pnpm create vite layout --template react-ts
cd layout
pnpm install
pnpm add tailwindcss @tailwindcss/vite
pnpm add -D @types/node
```

### 1.2 Configurar `vite.config.ts`

```ts
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
```

### 1.3 Configurar `tsconfig.json`

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ],
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### 1.4 Configurar `tsconfig.app.json`

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### 1.5 `src/index.css`

```css
@import "tailwindcss";
@import "@xyflow/react/dist/style.css";

:root {
  --background: #0d0d0d;
  --foreground: #f5f5f5;
  --card: #1a1a1a;
  --card-foreground: #f5f5f5;
  --popover: #1a1a1a;
  --popover-foreground: #f5f5f5;
  --primary: #10a37f;
  --primary-foreground: #ffffff;
  --secondary: #242424;
  --secondary-foreground: #f5f5f5;
  --muted: #242424;
  --muted-foreground: #a0a0a0;
  --accent: #10a37f;
  --accent-foreground: #ffffff;
  --destructive: #ef4444;
  --destructive-foreground: #ffffff;
  --border: #333333;
  --input: #2a2a2a;
  --ring: #10a37f;
  --radius: 0.5rem;

  /* Status colors */
  --status-running: #22c55e;
  --status-waiting: #3b82f6;
  --status-completed: #10b981;
  --status-failed: #ef4444;
  --status-pending: #6b7280;
  --status-queued: #eab308;
  --status-cancelled: #6b7280;
}

* {
  border-color: var(--border);
}

body {
  background-color: var(--background);
  color: var(--foreground);
  font-family: "Inter", system-ui, -apple-system, sans-serif;
}
```

### 1.6 Inicializar shadcn/ui

```bash
pnpm dlx shadcn@latest init
# Selecione:
# - Style: Default
# - Base color: Neutral
# - CSS variables: Yes
# - Tailwind CSS v4: Yes
```

### 1.7 Adicionar Componentes shadcn

```bash
pnpm dlx shadcn@latest add button input select dialog drawer badge card tabs tooltip avatar separator scroll-area dropdown-menu command
```

---

## 2. Dependências Completas

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    "zustand": "^5.0.0",
    "lucide-react": "^0.460.0",
    "react-syntax-highlighter": "^15.6.0",
    "@xyflow/react": "^12.0.0",
    "@dnd-kit/core": "^6.3.0",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.6.0",
    "class-variance-authority": "^0.7.0",
    "date-fns": "^4.1.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.4.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/react-syntax-highlighter": "^15.5.0"
  }
}
```

---

## 3. Estrutura de Layout Global

```
┌──────────────────────────────────────────────────────┐
│                     Navbar (topo)                     │
│  [Logo]    Kanban  ·  Projects  ·  Settings     [?]  │
├──────────────────────────────────────────────────────┤
│                                                       │
│                  Conteúdo da Página                   │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### Navbar

- Fixa no topo, `h-14`, backdrop-blur, `bg-background/80`.
- **Esquerda:** Logo (`Workflow` + ícone Lucide `Workflow`).
- **Centro:** Tabs de navegação estilizadas.
- **Direita:** Botão de atalhos (?) com `CommandDialog` (Cmd+K), Avatar fallback.
- Navegação por `<Link>` do react-router-dom.

---

## 4. Roteamento e URL State

### 4.1 Rotas

| Rota | Página | Params |
|------|--------|--------|
| `/` | Kanban Board | `?task=<taskId>&tab=<chat\|prompt\|workflow>` |
| `/projects` | Projects Grid | `?project=<projectId>` |
| `/projects/:id` | Project Detail | `?task=<taskId>&tab=<chat\|prompt\|workflow>` |
| `/settings` | Settings | `?section=<appearance\|providers\|advanced>` |

### 4.2 URL State (via `useSearchParams`)

- `task` — taskId do drawer aberto. Abrir drawer na aba `tab`.
- `tab` — aba ativa do drawer: `chat`, `prompt`, `workflow`. Default: `chat`.
- `project` — projectId do modal de edição.
- `section` — seção ativa em settings.

### 4.3 Comportamento

- Ao clicar no card da task: navega para `?task=<id>&tab=chat`.
- Ao clicar no botão DAG do card: navega para `?task=<id>&tab=workflow`.
- Ao fechar drawer: remove params `task` e `tab` da URL.
- Links são copiáveis — ao acessar a URL diretamente, o drawer abre automaticamente na aba correta.
- O `TaskDrawer` lê `task` e `tab` dos search params e renderiza condicionalmente.

---

## 5. Página Kanban (`/`)

### 5.1 Estrutura do Board

Colunas verticais representando agentes. Altura: `calc(100vh - 56px)`.

**Colunas base (largura mínima 280px, flexível):**

| Coluna | Agent |
|--------|-------|
| Inbox | — (sem agente) |
| Manager | Manager |
| Done | — (terminal) |

**Colunas de agentes em pares (cada coluna dividida top/bottom):**

| Coluna | Agentes |
|--------|---------|
| Produto / Generic | Produto (top), Generic (bottom) |
| Architecture / Engineer | Architecture (top), Engineer (bottom) |
| Code Reviewer / QA | Code Reviewer (top), QA (bottom) |

### 5.2 Header da Coluna

```
┌─────────────────────────────┐
│ 🤖 Engineer    [2/5]        │
│ ─────────────────────────── │
└─────────────────────────────┘
```

- Ícone Lucide + nome do agente.
- **Badge:** `<Badge variant="outline">` verde quando `running > 0`, muted quando idle. Formato: `running/total`.

### 5.3 Cards de Tarefa

```
┌───────────────────────────────────┐
│ Implementar login OAuth            │
│ #task_a1b2c3          ● running   │
│ ⏱ 2m 30s    🔧 deep/high    [⛓] │
└───────────────────────────────────┘
```

- **Título:** 1-2 linhas, `truncate`.
- **ID parcial:** `#task_...` + `<StatusDot>`.
- **Métricas:** duração, runtime config atual.
- **[⛓] Botão DAG:** ícone `GitBranch` ou `Network` — click abre drawer na aba `workflow`.
- **Click no card:** abre drawer na aba `chat`.
- **Status dot:**
  - `PENDING` → `bg-muted-foreground`
  - `QUEUED` → `bg-yellow-500`
  - `RUNNING` → `bg-green-500 animate-pulse`
  - `WAITING` → `bg-blue-500`
  - `COMPLETED` → `bg-emerald-500`
  - `FAILED` → `bg-destructive`
  - `CANCELLED` → `bg-muted-foreground line-through`
- **Drag & drop:** `@dnd-kit/core` + `@dnd-kit/sortable`.

### 5.4 Task Drawer (Sheet da direita)

Usa `<Sheet>` do shadcn/ui (ou componente Drawer customizado com `vaul`). `width: 480px` ou `50vw`.

**Tabs internas:** `chat`, `prompt`, `workflow` — controladas por URL param `tab`.

```
┌──────────────────────────────────────────────┐
│ ✕  Task: Implementar login OAuth             │
│  Assigned: Engineer  ● running              │
│  [💬 Chat]  [📄 Prompt]  [⛓ Workflow]       │
├──────────────────────────────────────────────┤
│                                               │
│         Conteúdo da aba selecionada           │
│                                               │
├──────────────────────────────────────────────┤
│  Provider: [openrouter ▾]                    │
│  Model:    [deepseek-v4-pro ▾]               │
│  Effort:   [high ▾]                          │
├──────────────────────────────────────────────┤
│  📎 Attachments (2)  📦 Artifacts (1)        │
│  📊 1.2k tokens · $0.0003 · 45s             │
│  Subtasks: ▸ task_abc (Manager / COMPLETED)   │
│            ▸ task_def (Engineer / RUNNING)    │
└──────────────────────────────────────────────┘
```

#### Aba: Chat (`tab=chat`)

- Lista de `<ChatMessage>` com role styling.
- Roles: `user` (azul, alinhado direita), `assistant` (verde, esquerda), `event` (cinza, centro).
- Scroll automático para a última mensagem.

#### Aba: Prompt (`tab=prompt`)

- Render markdown com syntax highlight (`react-syntax-highlighter`).
- Mostra o system prompt e histórico relevante enviado ao agente.

#### Aba: Workflow (`tab=workflow`) — DAG interativo com React Flow

Ver seção 6 para especificação completa.

### 5.5 Criação de Tarefa

- Botão `+` no header da coluna Inbox ou FAB no canto inferior direito.
- `<Dialog>` (Modal) com: título, agente destino (`<Select>`), runtime config opcional, attachments.

---

## 6. Visualização de Workflow (DAG com React Flow)

### 6.1 Visão Geral

Grafo direcionado acíclico (DAG) que mostra a árvore de execução de uma task: a task raiz, suas subtasks, e as dependências (wait groups). Arestas animadas indicam fluxo de dados e status.

### 6.2 Componente: `WorkflowView`

```tsx
// src/components/workflow/WorkflowView.tsx
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge } from '@xyflow/react';
import { TaskNode } from './TaskNode';
import { AnimatedEdge } from './AnimatedEdge';

const nodeTypes = { taskNode: TaskNode };
const edgeTypes = { animated: AnimatedEdge };

export function WorkflowView({ task }: { task: TaskWithSubtasks }) {
  const { nodes, edges } = buildDag(task);

  return (
    <div className="w-full h-full min-h-[400px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'animated', animated: true }}
        fitView
        attributionPosition="bottom-left"
      >
        <Background gap={16} color="var(--border)" />
        <Controls className="!bg-card !border-border !text-foreground" />
        <MiniMap
          className="!bg-card !border-border"
          nodeColor={(node) => node.data?.color ?? 'var(--primary)'}
        />
      </ReactFlow>
    </div>
  );
}
```

### 6.3 Construção do DAG (`buildDag`)

```ts
function buildDag(task: TaskWithSubtasks): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Layout automático: top-down tree com espaçamento calculado
  const layout = computeLayout(task);

  for (const t of layout) {
    nodes.push({
      id: t.id,
      type: 'taskNode',
      position: { x: t.x, y: t.y },
      data: {
        label: t.title,
        status: t.status,
        agent: t.assignedTo,
        color: AGENT_COLORS[t.assignedTo] ?? 'var(--muted-foreground)',
        isRoot: t.id === task.id,
        metrics: t.metrics,
      },
    });

    // Arestas: parent -> subtask
    if (t.parentId) {
      edges.push({
        id: `${t.parentId}->${t.id}`,
        source: t.parentId,
        target: t.id,
        type: 'animated',
        animated: t.status === 'RUNNING',
        style: {
          stroke: t.status === 'RUNNING' ? 'var(--status-running)' :
                  t.status === 'COMPLETED' ? 'var(--status-completed)' :
                  t.status === 'FAILED' ? 'var(--status-failed)' :
                  'var(--muted-foreground)',
          strokeWidth: 2,
        },
        data: { status: t.status },
      });
    }

    // Arestas: wait groups (dependência entre subtasks)
    for (const run of task.runs) {
      for (const group of run.waitGroups) {
        for (const depId of group.taskIds) {
          edges.push({
            id: `wait->${t.id}->${depId}`,
            source: t.id,
            target: depId,
            type: 'animated',
            animated: group.status === 'WAITING',
            style: {
              stroke: 'var(--status-waiting)',
              strokeDasharray: '5,5',
              strokeWidth: 1.5,
            },
            data: { waitId: group.waitId, mode: group.mode },
          });
        }
      }
    }
  }

  return { nodes, edges };
}
```

### 6.4 Custom Node: `TaskNode`

```tsx
// src/components/workflow/TaskNode.tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface TaskNodeData {
  label: string;
  status: string;
  agent: string;
  color: string;
  isRoot: boolean;
  metrics: { tokens: { total: number }; cost: number; durationMs: number };
}

export function TaskNode({ data, selected }: NodeProps) {
  const { label, status, agent, color, isRoot, metrics } = data;

  return (
    <div
      className={cn(
        'px-3 py-2 rounded-lg border bg-card shadow-lg min-w-[180px] max-w-[240px]',
        'transition-all duration-200',
        selected && 'ring-2 ring-primary',
        status === 'RUNNING' && 'animate-pulse border-green-500/50',
        isRoot && 'border-primary/50'
      )}
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <div className="flex items-center gap-2 mb-1">
        <StatusDot status={status} />
        <span className="text-xs text-muted-foreground">{agent}</span>
      </div>
      <p className="text-sm font-medium truncate leading-tight">{label}</p>
      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
        <span>{metrics.tokens.total} tok</span>
        <span>·</span>
        <span>{formatDuration(metrics.durationMs)}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
}
```

### 6.5 Animated Edge

```tsx
// src/components/workflow/AnimatedEdge.tsx
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

export function AnimatedEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  data, style, animated,
  ...delegated
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} {...delegated} />
      {animated && (
        <circle r="4" fill={String(style?.stroke ?? 'var(--primary)')}>
          <animateMotion dur="1.5s" repeatCount="indefinite">
            <mpath href={`#${id}`} />
          </animateMotion>
        </circle>
      )}
    </>
  );
}
```

### 6.6 Interações no DAG

- **Zoom/Pan:** scroll do mouse + arrastar.
- **Click no nó:** abre aquela task no drawer (`?task=<nodeId>&tab=chat`).
- **Duplo click no nó:** centraliza (fitView) no nó.
- **MiniMap:** visão geral do grafo.
- **Controls:** zoom in/out, fit view, lock.
- **Layout automático:** dagre ou algoritmo manual top-down com níveis por depth.
- **Arestas animadas:** tasks RUNNING têm borda pulsante e aresta com bolinha animada. Tasks WAITING mostram arestas tracejadas azuis.

### 6.7 Atualização em Tempo Real

- A store Zstand do kanban é observada pelo `WorkflowView`.
- Quando status das tasks muda, nós e arestas são re-renderizados com novas cores/animações.
- Transições suaves com `transition-all duration-300` nos nós.

---

## 7. Página Projects (`/projects`)

### 7.1 Lista de Projetos

Grid de `<Card>` 2-4 colunas responsivas. Cada card:

```
┌──────────────────────────────────┐
│  📁 Projeto Alpha                │
│  Descrição breve...              │
│  📍 /home/user/project-alpha     │
│  3 tasks · 1 running             │
│         [Editar] [Excluir]       │
└──────────────────────────────────┘
```

### 7.2 CRUD

- **Criar:** `<Button>` "Novo Projeto" → `<Dialog>` com:
  - Nome (`<Input>`, obrigatório)
  - Descrição (`<Textarea>` com preview markdown e syntax highlight)
  - Location (`<Input>`, path)
- **Editar:** Click no card → `<Dialog>` preenchido. URL: `?project=<id>`.
- **Excluir:** `<AlertDialog>` de confirmação.
- **Listar:** Cards com nome, descrição truncada, location, contagem de tasks.
- **Click no card:** navega para `/projects/:id` (tela de detalhe do projeto com kanban filtrado).

---

## 8. Página Settings (`/settings`)

### 8.1 Layout

Menu secundário lateral esquerdo (`w-56`) + conteúdo à direita.

```
┌──────────────┬───────────────────────────────────┐
│              │                                    │
│  Aparência   │   Conteúdo da seção selecionada   │
│  Providers   │                                    │
│  Advanced    │                                    │
│              │                                    │
└──────────────┴───────────────────────────────────┘
```

URL: `?section=appearance|providers|advanced`.

### 8.2 Appearance

| Config | Tipo | Default |
|--------|------|---------|
| Font Size | `<Slider>` 12–20px | 14px |
| Font Family | `<Select>` | Inter |
| Theme | `<Select>` | Dark |
| Density | `<Select>` | Comfortable |

### 8.3 Providers

Tabela/listagem de providers com `<Badge variant="outline">` para status.

| Provider | Status | Default Model |
|----------|--------|---------------|
| OpenRouter | `connected` | deepseek-v4 |
| OpenAI | `not configured` | gpt-4o |
| ... | | |

- Auto-deteção: `process.env` → badge verde se key existe.
- Configuração manual: input password com toggle.
- Custom provider: `<Dialog>` com nome, base URL, API key, modelos.
- Default provider/model/effort: selects globais.

### 8.4 Advanced

Configurações do orquestrador (expansível via `<Collapsible>`):

| Config | Default |
|--------|---------|
| Max Concurrency | 3 |
| Run Timeout (ms) | 600000 |
| Max Task Depth | 4 |
| Max Subtasks | 25 |
| Max Retries | 2 |
| Max Technical Retries | 2 |
| Max Tokens Budget | ∞ |
| Max Cost Budget | ∞ |

---

## 9. Design System (shadcn/ui)

### 9.1 Tema Dark (CSS Variables)

```css
--background: 0 0% 5%;       /* #0d0d0d */
--foreground: 0 0% 96%;      /* #f5f5f5 */
--card: 0 0% 10%;            /* #1a1a1a */
--card-foreground: 0 0% 96%;
--popover: 0 0% 10%;
--popover-foreground: 0 0% 96%;
--primary: 164 82% 35%;      /* #10a37f */
--primary-foreground: 0 0% 100%;
--secondary: 0 0% 14%;       /* #242424 */
--secondary-foreground: 0 0% 96%;
--muted: 0 0% 14%;
--muted-foreground: 0 0% 63%;/* #a0a0a0 */
--accent: 164 82% 35%;
--accent-foreground: 0 0% 100%;
--destructive: 0 84% 60%;
--destructive-foreground: 0 0% 100%;
--border: 0 0% 20%;
--input: 0 0% 16%;
--ring: 164 82% 35%;
--radius: 0.5rem;
```

### 9.2 Tipografia

- Primary: Inter (Google Fonts).
- Mono: JetBrains Mono.
- Escala Tailwind: `text-xs` (12px) a `text-2xl` (24px). Default: `text-sm` (14px/20).

### 9.3 Componentes shadcn/ui utilizados

| Componente | Uso |
|------------|-----|
| `Button` | Ações primárias, secundárias, ghost, destructive |
| `Input` | Campos de texto, password |
| `Select` | Dropdowns (agentes, providers, modelos, effort) |
| `Dialog` | Modais de criação/edição |
| `Sheet` | Task Drawer (lateral direita) |
| `Badge` | Status indicators, contagens |
| `Card` | Task cards, project cards |
| `Tabs` | Abas do drawer (chat/prompt/workflow), navegação de settings |
| `Tooltip` | Hover info em ícones, badges |
| `Avatar` | Avatar genérico do usuário |
| `Separator` | Divisores visuais |
| `ScrollArea` | Chat scroll, kanban columns |
| `DropdownMenu` | Menus de contexto (card da task) |
| `Command` | Command palette (Cmd+K) |
| `AlertDialog` | Confirmação de exclusão |
| `Slider` | Font size, configurações numéricas |
| `Collapsible` | Advanced settings expansíveis |

### 9.4 Custom Components

| Componente | Descrição |
|------------|-----------|
| `StatusDot` | Indicador colorido de status |
| `TaskCard` | Card de task (usa `<Card>`) |
| `AgentColumn` | Coluna kanban com header e cards |
| `ChatMessage` | Mensagem com role styling |
| `TaskChatPanel` | Lista de mensagens com scroll |
| `TaskPromptPanel` | Markdown + syntax highlight |
| `WorkflowView` | DAG com React Flow |
| `TaskNode` | Nó customizado do React Flow |
| `AnimatedEdge` | Aresta animada do React Flow |
| `RuntimeConfigSelector` | Provider/Model/Effort combinados |
| `MarkdownPreview` | Preview com syntax highlight |
| `CodeBlock` | Bloco de código com copy button |
| `EmptyState` | Estado vazio ilustrado |

---

## 10. Estrutura de Diretórios

```
./layout/
├── index.html
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── vite.config.ts
├── components.json               # shadcn/ui config
├── public/
│   └── favicon.svg
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css                  # Tailwind + CSS variables + React Flow styles
    ├── router.tsx                 # react-router-dom + URL params
    ├── lib/
    │   ├── utils.ts               # cn() helper (clsx + tailwind-merge)
    │   └── constants.ts           # Providers, models, efforts, agents
    │
    ├── components/
    │   ├── ui/                    # shadcn/ui components (gerados pelo cli)
    │   │   ├── button.tsx
    │   │   ├── input.tsx
    │   │   ├── select.tsx
    │   │   ├── dialog.tsx
    │   │   ├── sheet.tsx
    │   │   ├── badge.tsx
    │   │   ├── card.tsx
    │   │   ├── tabs.tsx
    │   │   ├── tooltip.tsx
    │   │   ├── avatar.tsx
    │   │   ├── separator.tsx
    │   │   ├── scroll-area.tsx
    │   │   ├── dropdown-menu.tsx
    │   │   ├── command.tsx
    │   │   ├── alert-dialog.tsx
    │   │   ├── slider.tsx
    │   │   ├── collapsible.tsx
    │   │   ├── label.tsx
    │   │   ├── textarea.tsx
    │   │   └── skeleton.tsx
    │   │
    │   ├── layout/
    │   │   ├── Navbar.tsx
    │   │   ├── PageContainer.tsx
    │   │   └── SettingsSidebar.tsx
    │   │
    │   ├── kanban/
    │   │   ├── KanbanBoard.tsx
    │   │   ├── AgentColumn.tsx
    │   │   ├── TaskCard.tsx
    │   │   ├── TaskDrawer.tsx
    │   │   ├── TaskChatPanel.tsx
    │   │   ├── TaskPromptPanel.tsx
    │   │   ├── RuntimeConfigSelector.tsx
    │   │   ├── CreateTaskDialog.tsx
    │   │   └── StatusDot.tsx
    │   │
    │   ├── workflow/
    │   │   ├── WorkflowView.tsx    # React Flow container
    │   │   ├── TaskNode.tsx        # Custom node
    │   │   ├── AnimatedEdge.tsx    # Custom animated edge
    │   │   └── buildDag.ts        # Layout algorithm
    │   │
    │   ├── projects/
    │   │   ├── ProjectsGrid.tsx
    │   │   ├── ProjectCard.tsx
    │   │   ├── ProjectDialog.tsx
    │   │   └── ProjectDetail.tsx
    │   │
    │   ├── settings/
    │   │   ├── SettingsLayout.tsx
    │   │   ├── AppearanceSettings.tsx
    │   │   ├── ProvidersSettings.tsx
    │   │   └── AdvancedSettings.tsx
    │   │
    │   └── shared/
    │       ├── MarkdownPreview.tsx
    │       ├── CodeBlock.tsx
    │       └── EmptyState.tsx
    │
    ├── hooks/
    │   ├── useLocalStorage.ts
    │   ├── useSearchParamsState.ts  # URL state sync
    │   └── useDragAndDrop.ts
    │
    ├── stores/
    │   ├── kanbanStore.ts
    │   ├── projectsStore.ts
    │   └── settingsStore.ts
    │
    ├── types/
    │   ├── task.ts
    │   ├── project.ts
    │   ├── provider.ts
    │   └── settings.ts
    │
    └── mocks/
        ├── mockTasks.ts
        ├── mockAgents.ts
        ├── mockProjects.ts
        └── mockChat.ts
```

---

## 11. Mock Data (Typescript)

### 11.1 Tipos Base

```typescript
// src/types/task.ts
export type TaskStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface TaskMetrics {
  startedAt?: string;
  finishedAt?: string;
  durationMs: number;
  tokens: { input: number; output: number; total: number };
  cost: number;
}

export interface Task {
  id: string;
  title: string;
  assignedTo: string;
  parentId?: string;
  status: TaskStatus;
  depth: number;
  subtaskIds: string[];
  runId?: string;
  runtimeConfig: { model: string; effort: string };
  chat: ChatMessage[];
  artifacts: Artifact[];
  attachments: Attachment[];
  metrics: TaskMetrics;
  retryCount: number;
  runs: TaskRun[];
}

export interface TaskRun {
  runId: string;
  status: 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';
  waitGroups: WaitGroup[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface WaitGroup {
  waitId: string;
  mode: 'WAIT_ALL' | 'ON_DEMAND';
  taskIds: string[];
  status: 'WAITING' | 'READY' | 'PROCESSED' | 'FAILED';
}

export interface Agent {
  id: string;
  name: string;
  icon: string;   // Lucide icon name
  color: string;  // hex
}

export interface ChatMessage {
  ts: string;
  role: 'system' | 'user' | 'assistant' | 'event';
  type: 'text' | 'artifact' | 'event';
  text?: string;
  artifacts?: Artifact[];
}

export interface Artifact {
  description: string;
  file_type: string;
  path: string;
  sizeBytes: number;
}

export interface Attachment {
  id: string;
  originalName: string;
  path: string;
  sizeBytes: number;
}
```

### 11.2 Agentes

```typescript
export const AGENTS: Agent[] = [
  { id: 'manager', name: 'Manager', icon: 'ClipboardList', color: '#f59e0b' },
  { id: 'produto', name: 'Produto', icon: 'Puzzle', color: '#8b5cf6' },
  { id: 'generic', name: 'Generic', icon: 'Bot', color: '#6b7280' },
  { id: 'architecture', name: 'Architecture', icon: 'Building2', color: '#ec4899' },
  { id: 'engineer', name: 'Engineer', icon: 'Code', color: '#3b82f6' },
  { id: 'code-reviewer', name: 'Code Reviewer', icon: 'SearchCode', color: '#14b8a6' },
  { id: 'qa', name: 'QA', icon: 'FlaskConical', color: '#f97316' },
];

export const AGENT_COLORS: Record<string, string> = Object.fromEntries(
  AGENTS.map(a => [a.id, a.color])
);
```

---

## 12. Comportamentos e Interações

| Ação | Comportamento |
|---|---|
| Click no card | `?task=<id>&tab=chat` |
| Click no botão DAG [⛓] | `?task=<id>&tab=workflow` |
| Click na aba do drawer | Atualiza `?tab=` na URL |
| Fechar drawer | Remove `?task=` e `?tab=` da URL |
| Arrastar card | Move task para novo agente (mock state) |
| Click no nó DAG | `?task=<nodeId>&tab=chat` |
| Cmd+K | `<CommandDialog>` — busca global de tasks |
| Esc | Fecha drawer/dialog atual |
| Copiar URL | Link restaurável — drawer abre na aba correta |
| Scroll kanban | Horizontal nas colunas, vertical nos cards |

---

## 13. Responsividade

| Breakpoint | Comportamento |
|---|---|
| `≥1440px` | Layout completo |
| `1024–1439px` | Pares empilham verticalmente |
| `768–1023px` | Kanban scroll horizontal, drawer fullscreen |
| `<768px` | Lista vertical, bottom tabs |
