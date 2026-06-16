import type { Task, TaskStatus } from '@/types/task';

const now = new Date().toISOString();

function createMockTask(overrides: Partial<Task>): Task {
  return {
    id: '',
    title: '',
    assignedTo: '',
    status: 'PENDING' as TaskStatus,
    depth: 0,
    subtaskIds: [],
    runtimeConfig: { model: 'balanced', effort: 'medium' },
    chat: [],
    artifacts: [],
    attachments: [],
    metrics: { durationMs: 0, tokens: { input: 0, output: 0, total: 0 }, cost: 0 },
    retryCount: 0,
    runs: [],
    ...overrides,
  };
}

export const MOCK_TASKS: Task[] = [
  createMockTask({
    id: 'task_001',
    title: 'Implementar login OAuth com GitHub',
    assignedTo: 'engineer',
    status: 'RUNNING',
    metrics: { startedAt: now, finishedAt: undefined, durationMs: 150000, tokens: { input: 1200, output: 3400, total: 4600 }, cost: 0.0023 },
    runtimeConfig: { model: 'deep', effort: 'high' },
    chat: [
      { ts: new Date(Date.now() - 300000).toISOString(), role: 'user', type: 'text', text: 'Implementar login OAuth com GitHub na aplicação React' },
      { ts: new Date(Date.now() - 250000).toISOString(), role: 'assistant', type: 'text', text: 'Vou criar a integração OAuth. Preciso definir o fluxo de autenticação e os componentes necessários.' },
    ],
    runs: [{ runId: 'run_001', status: 'RUNNING', waitGroups: [], startedAt: now }],
  }),
  createMockTask({
    id: 'task_002',
    title: 'Criar endpoint GET /api/users',
    assignedTo: 'engineer',
    status: 'COMPLETED',
    metrics: { startedAt: new Date(Date.now() - 600000).toISOString(), finishedAt: new Date(Date.now() - 300000).toISOString(), durationMs: 300000, tokens: { input: 800, output: 2100, total: 2900 }, cost: 0.0015 },
    runtimeConfig: { model: 'balanced', effort: 'medium' },
    chat: [
      { ts: new Date(Date.now() - 600000).toISOString(), role: 'user', type: 'text', text: 'Criar endpoint GET /api/users' },
      { ts: new Date(Date.now() - 550000).toISOString(), role: 'assistant', type: 'text', text: 'Endpoint criado com paginação e filtros.' },
    ],
    runs: [{ runId: 'run_002', status: 'COMPLETED', waitGroups: [], startedAt: new Date(Date.now() - 600000).toISOString(), completedAt: new Date(Date.now() - 300000).toISOString() }],
  }),
  createMockTask({
    id: 'task_003',
    title: 'Revisar PR de autenticação',
    assignedTo: 'code-reviewer',
    status: 'PENDING',
    metrics: { durationMs: 0, tokens: { input: 0, output: 0, total: 0 }, cost: 0 },
    runtimeConfig: { model: 'balanced', effort: 'medium' },
    chat: [],
    runs: [],
  }),
  createMockTask({
    id: 'task_004',
    title: 'Testar fluxo de cadastro',
    assignedTo: 'qa',
    status: 'WAITING',
    metrics: { durationMs: 45000, tokens: { input: 300, output: 900, total: 1200 }, cost: 0.0006 },
    runtimeConfig: { model: 'fast', effort: 'low' },
    chat: [
      { ts: new Date(Date.now() - 120000).toISOString(), role: 'user', type: 'text', text: 'Testar fluxo de cadastro' },
      { ts: new Date(Date.now() - 100000).toISOString(), role: 'assistant', type: 'text', text: 'Aguardando implementação do cadastro para testar.' },
    ],
    runs: [{ runId: 'run_003', status: 'WAITING', waitGroups: [{ waitId: 'wg_001', mode: 'WAIT_ALL', taskIds: ['task_001', 'task_002'], processedEventIds: [], status: 'WAITING' }], startedAt: new Date(Date.now() - 120000).toISOString() }],
  }),
  createMockTask({
    id: 'task_005',
    title: 'Definir specs do módulo de pagamentos',
    assignedTo: 'produto',
    status: 'COMPLETED',
    metrics: { startedAt: new Date(Date.now() - 3600000).toISOString(), finishedAt: new Date(Date.now() - 2400000).toISOString(), durationMs: 1200000, tokens: { input: 2500, output: 5800, total: 8300 }, cost: 0.0041 },
    runtimeConfig: { model: 'deep', effort: 'high' },
    chat: [
      { ts: new Date(Date.now() - 3600000).toISOString(), role: 'user', type: 'text', text: 'Definir specs do módulo de pagamentos' },
      { ts: new Date(Date.now() - 3500000).toISOString(), role: 'assistant', type: 'text', text: 'Especificação completa do módulo de pagamentos criada.' },
    ],
    runs: [{ runId: 'run_004', status: 'COMPLETED', waitGroups: [], startedAt: new Date(Date.now() - 3600000).toISOString(), completedAt: new Date(Date.now() - 2400000).toISOString() }],
    artifacts: [{ description: 'Payment Module Spec', file_type: 'markdown', path: '/artifacts/payment-spec.md', sizeBytes: 4500 }],
  }),
  createMockTask({
    id: 'task_006',
    title: 'Arquitetar microsserviço de notificações',
    assignedTo: 'architecture',
    status: 'COMPLETED',
    metrics: { startedAt: new Date(Date.now() - 7200000).toISOString(), finishedAt: new Date(Date.now() - 5400000).toISOString(), durationMs: 1800000, tokens: { input: 3800, output: 9200, total: 13000 }, cost: 0.0065 },
    runtimeConfig: { model: 'deep', effort: 'high' },
    chat: [],
    runs: [{ runId: 'run_005', status: 'COMPLETED', waitGroups: [], startedAt: new Date(Date.now() - 7200000).toISOString(), completedAt: new Date(Date.now() - 5400000).toISOString() }],
  }),
  createMockTask({
    id: 'task_007',
    title: 'Implementar dashboard admin',
    assignedTo: 'engineer',
    status: 'FAILED',
    metrics: { startedAt: new Date(Date.now() - 1800000).toISOString(), finishedAt: new Date(Date.now() - 900000).toISOString(), durationMs: 900000, tokens: { input: 4200, output: 11000, total: 15200 }, cost: 0.0076 },
    runtimeConfig: { model: 'deep', effort: 'xhigh' },
    chat: [
      { ts: new Date(Date.now() - 1800000).toISOString(), role: 'user', type: 'text', text: 'Implementar dashboard admin' },
      { ts: new Date(Date.now() - 1700000).toISOString(), role: 'assistant', type: 'text', text: 'Iniciando implementação do dashboard admin...' },
    ],
    runs: [{ runId: 'run_006', status: 'FAILED', waitGroups: [], startedAt: new Date(Date.now() - 1800000).toISOString(), completedAt: new Date(Date.now() - 900000).toISOString(), error: 'Timeout ao carregar dados do gráfico' }],
  }),
  createMockTask({
    id: 'task_008',
    title: 'Modelar banco de dados de produtos',
    assignedTo: 'generic',
    status: 'QUEUED',
    metrics: { durationMs: 0, tokens: { input: 0, output: 0, total: 0 }, cost: 0 },
    runtimeConfig: { model: 'balanced', effort: 'medium' },
    chat: [],
    runs: [],
  }),
  createMockTask({
    id: 'task_009',
    title: 'Otimizar queries do relatório mensal',
    assignedTo: 'engineer',
    status: 'CANCELLED',
    metrics: { durationMs: 120000, tokens: { input: 500, output: 1500, total: 2000 }, cost: 0.001 },
    runtimeConfig: { model: 'balanced', effort: 'medium' },
    chat: [],
    runs: [{ runId: 'run_007', status: 'RUNNING', waitGroups: [], startedAt: new Date(Date.now() - 120000).toISOString(), completedAt: new Date(Date.now()).toISOString() }],
  }),
];

export function getTasksByAgent(agentId: string): Task[] {
  return MOCK_TASKS.filter(t => t.assignedTo === agentId);
}

export function getTaskById(id: string): Task | undefined {
  return MOCK_TASKS.find(t => t.id === id);
}
