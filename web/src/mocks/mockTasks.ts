import type { Task, TaskStatus } from '@/types/task';

const now = new Date().toISOString();

function createMockTask(overrides: Partial<Task>): Task {
  return {
    id: '',
    title: '',
    assignedTo: '',
    status: 'PENDING' as TaskStatus,
    depth: 0,
    projectIds: [],
    subtaskIds: [],
    runtimeConfig: { model: 'balanced', effort: 'medium' },
    chat: [],
    artifacts: [],
    attachments: [],
    metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 },
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
    metrics: { startedAt: now, finishedAt: undefined, durationMs: 150000, waitingMs: 0, tokens: { input: 1200, output: 3400, total: 4600, cache: 800 }, cost: 0.0023 },
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
    metrics: { startedAt: new Date(Date.now() - 600000).toISOString(), finishedAt: new Date(Date.now() - 300000).toISOString(), durationMs: 300000, waitingMs: 0, tokens: { input: 800, output: 2100, total: 2900, cache: 400 }, cost: 0.0015 },
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
    metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 },
    runtimeConfig: { model: 'balanced', effort: 'medium' },
    chat: [],
    runs: [],
  }),
  createMockTask({
    id: 'task_004',
    title: 'Testar fluxo de cadastro',
    assignedTo: 'qa',
    status: 'WAITING',
    metrics: { durationMs: 45000, waitingMs: 30000, tokens: { input: 300, output: 900, total: 1200, cache: 200 }, cost: 0.0006 },
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
    metrics: { startedAt: new Date(Date.now() - 3600000).toISOString(), finishedAt: new Date(Date.now() - 2400000).toISOString(), durationMs: 1200000, waitingMs: 0, tokens: { input: 2500, output: 5800, total: 8300, cache: 1200 }, cost: 0.0041 },
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
    metrics: { startedAt: new Date(Date.now() - 7200000).toISOString(), finishedAt: new Date(Date.now() - 5400000).toISOString(), durationMs: 1800000, waitingMs: 0, tokens: { input: 3800, output: 9200, total: 13000, cache: 2000 }, cost: 0.0065 },
    runtimeConfig: { model: 'deep', effort: 'high' },
    chat: [],
    runs: [{ runId: 'run_005', status: 'COMPLETED', waitGroups: [], startedAt: new Date(Date.now() - 7200000).toISOString(), completedAt: new Date(Date.now() - 5400000).toISOString() }],
    subtaskIds: ['task_002', 'task_003'],
  }),
  createMockTask({
    id: 'task_007',
    title: 'Implementar dashboard admin',
    assignedTo: 'engineer',
    status: 'FAILED',
    metrics: { startedAt: new Date(Date.now() - 1800000).toISOString(), finishedAt: new Date(Date.now() - 900000).toISOString(), durationMs: 900000, waitingMs: 120000, tokens: { input: 4200, output: 11000, total: 15200, cache: 2500 }, cost: 0.0076 },
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
    metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 },
    runtimeConfig: { model: 'balanced', effort: 'medium' },
    chat: [],
    runs: [],
  }),
  createMockTask({
    id: 'task_009',
    title: 'Otimizar queries do relatório mensal',
    assignedTo: 'engineer',
    status: 'CANCELLED',
    metrics: { durationMs: 120000, waitingMs: 0, tokens: { input: 500, output: 1500, total: 2000, cache: 0 }, cost: 0.001 },
    runtimeConfig: { model: 'balanced', effort: 'medium' },
    chat: [],
    runs: [{ runId: 'run_007', status: 'RUNNING', waitGroups: [], startedAt: new Date(Date.now() - 120000).toISOString(), completedAt: new Date(Date.now()).toISOString() }],
  }),

  // === TASK ANINHADA LONGA PARA VALIDACAO VISUAL ===
  createMockTask({
    id: 'task_010',
    title: 'Migrar plataforma para microsserviços',
    assignedTo: 'architecture',
    status: 'RUNNING',
    depth: 0,
    subtaskIds: ['task_011', 'task_017', 'task_028', 'task_035'],
    metrics: { startedAt: new Date(Date.now() - 86400000).toISOString(), durationMs: 5400000, waitingMs: 0, tokens: { input: 12000, output: 28000, total: 40000, cache: 5000 }, cost: 0.02 },
    chat: [],
  }),
  createMockTask({ id: 'task_011', title: 'Fase 1: Análise e Design', assignedTo: 'architecture', status: 'COMPLETED', depth: 1, subtaskIds: ['task_012', 'task_013', 'task_016'], metrics: { durationMs: 1800000, waitingMs: 0, tokens: { input: 4000, output: 9000, total: 13000, cache: 1800 }, cost: 0.0065 } }),
  createMockTask({ id: 'task_012', title: 'Levantar requisitos de domínio', assignedTo: 'produto', status: 'COMPLETED', depth: 2, subtaskIds: [], metrics: { durationMs: 600000, waitingMs: 0, tokens: { input: 1500, output: 3200, total: 4700, cache: 600 }, cost: 0.0023 } }),
  createMockTask({ id: 'task_013', title: 'Desenhar contratos de API', assignedTo: 'architecture', status: 'COMPLETED', depth: 2, subtaskIds: ['task_014', 'task_015'], metrics: { durationMs: 900000, waitingMs: 0, tokens: { input: 2000, output: 4500, total: 6500, cache: 900 }, cost: 0.0032 } }),
  createMockTask({ id: 'task_014', title: 'Definir schema GraphQL', assignedTo: 'engineer', status: 'COMPLETED', depth: 3, subtaskIds: [], metrics: { durationMs: 300000, waitingMs: 0, tokens: { input: 800, output: 1800, total: 2600, cache: 350 }, cost: 0.0013 } }),
  createMockTask({ id: 'task_015', title: 'Definir schema REST', assignedTo: 'engineer', status: 'COMPLETED', depth: 3, subtaskIds: [], metrics: { durationMs: 240000, waitingMs: 0, tokens: { input: 600, output: 1400, total: 2000, cache: 280 }, cost: 0.001 } }),
  createMockTask({ id: 'task_016', title: 'Modelar eventos de domínio', assignedTo: 'architecture', status: 'COMPLETED', depth: 2, subtaskIds: [], metrics: { durationMs: 420000, waitingMs: 0, tokens: { input: 1200, output: 2600, total: 3800, cache: 500 }, cost: 0.0019 } }),
  createMockTask({ id: 'task_017', title: 'Fase 2: Infraestrutura', assignedTo: 'engineer', status: 'RUNNING', depth: 1, subtaskIds: ['task_018', 'task_019', 'task_024'], metrics: { durationMs: 2400000, waitingMs: 0, tokens: { input: 5000, output: 12000, total: 17000, cache: 2200 }, cost: 0.0085 } }),
  createMockTask({ id: 'task_018', title: 'Configurar cluster Kubernetes', assignedTo: 'engineer', status: 'COMPLETED', depth: 2, subtaskIds: [], metrics: { durationMs: 600000, waitingMs: 0, tokens: { input: 1800, output: 4200, total: 6000, cache: 800 }, cost: 0.003 } }),
  createMockTask({ id: 'task_019', title: 'Configurar CI/CD pipelines', assignedTo: 'engineer', status: 'RUNNING', depth: 2, subtaskIds: ['task_020', 'task_021'], metrics: { durationMs: 900000, waitingMs: 0, tokens: { input: 2200, output: 5100, total: 7300, cache: 1000 }, cost: 0.0036 } }),
  createMockTask({ id: 'task_020', title: 'Pipeline de build', assignedTo: 'engineer', status: 'COMPLETED', depth: 3, subtaskIds: [], metrics: { durationMs: 300000, waitingMs: 0, tokens: { input: 900, output: 2000, total: 2900, cache: 400 }, cost: 0.0014 } }),
  createMockTask({ id: 'task_021', title: 'Pipeline de deploy', assignedTo: 'engineer', status: 'RUNNING', depth: 3, subtaskIds: ['task_022', 'task_023'], metrics: { durationMs: 480000, waitingMs: 0, tokens: { input: 1100, output: 2600, total: 3700, cache: 500 }, cost: 0.0018 } }),
  createMockTask({ id: 'task_022', title: 'Deploy staging', assignedTo: 'engineer', status: 'COMPLETED', depth: 4, subtaskIds: [], metrics: { durationMs: 180000, waitingMs: 0, tokens: { input: 500, output: 1200, total: 1700, cache: 220 }, cost: 0.0008 } }),
  createMockTask({ id: 'task_023', title: 'Deploy produção', assignedTo: 'engineer', status: 'PENDING', depth: 4, subtaskIds: [], metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 } }),
  createMockTask({ id: 'task_024', title: 'Configurar observabilidade', assignedTo: 'engineer', status: 'RUNNING', depth: 2, subtaskIds: ['task_025', 'task_026', 'task_027'], metrics: { durationMs: 600000, waitingMs: 120000, tokens: { input: 1600, output: 3800, total: 5400, cache: 700 }, cost: 0.0027 } }),
  createMockTask({ id: 'task_025', title: 'Métricas com Prometheus', assignedTo: 'engineer', status: 'RUNNING', depth: 3, subtaskIds: [], metrics: { durationMs: 300000, waitingMs: 0, tokens: { input: 800, output: 1900, total: 2700, cache: 350 }, cost: 0.0013 } }),
  createMockTask({ id: 'task_026', title: 'Logs com Loki', assignedTo: 'engineer', status: 'PENDING', depth: 3, subtaskIds: [], metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 } }),
  createMockTask({ id: 'task_027', title: 'Tracing com Tempo', assignedTo: 'engineer', status: 'PENDING', depth: 3, subtaskIds: [], metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 } }),
  createMockTask({ id: 'task_028', title: 'Fase 3: Migração de serviços', assignedTo: 'engineer', status: 'PENDING', depth: 1, subtaskIds: ['task_029', 'task_030', 'task_033', 'task_034'], metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 } }),
  createMockTask({ id: 'task_029', title: 'Serviço de autenticação', assignedTo: 'engineer', status: 'PENDING', depth: 2, subtaskIds: [], metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 } }),
  createMockTask({ id: 'task_030', title: 'Serviço de pagamentos', assignedTo: 'engineer', status: 'PENDING', depth: 2, subtaskIds: ['task_031', 'task_032'], metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 } }),
  createMockTask({ id: 'task_031', title: 'Gateway de pagamento', assignedTo: 'engineer', status: 'PENDING', depth: 3, subtaskIds: [], metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 } }),
  createMockTask({ id: 'task_032', title: 'Faturamento recorrente', assignedTo: 'engineer', status: 'PENDING', depth: 3, subtaskIds: [], metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 } }),
  createMockTask({ id: 'task_033', title: 'Serviço de notificações', assignedTo: 'engineer', status: 'PENDING', depth: 2, subtaskIds: [], metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 } }),
  createMockTask({ id: 'task_034', title: 'Serviço de relatórios', assignedTo: 'engineer', status: 'PENDING', depth: 2, subtaskIds: [], metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 } }),
  createMockTask({ id: 'task_035', title: 'Fase 4: Testes e Cutover', assignedTo: 'qa', status: 'PENDING', depth: 1, subtaskIds: ['task_036', 'task_037', 'task_038', 'task_039'], metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 } }),
  createMockTask({ id: 'task_036', title: 'Testes de integração', assignedTo: 'qa', status: 'PENDING', depth: 2, subtaskIds: [], metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 } }),
  createMockTask({ id: 'task_037', title: 'Testes de carga', assignedTo: 'qa', status: 'PENDING', depth: 2, subtaskIds: [], metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 } }),
  createMockTask({ id: 'task_038', title: 'Plano de rollback', assignedTo: 'architecture', status: 'PENDING', depth: 2, subtaskIds: [], metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 } }),
  createMockTask({ id: 'task_039', title: 'Cutover produção', assignedTo: 'engineer', status: 'PENDING', depth: 2, subtaskIds: [], metrics: { durationMs: 0, waitingMs: 0, tokens: { input: 0, output: 0, total: 0, cache: 0 }, cost: 0 } }),
];

export function getTasksByAgent(agentId: string): Task[] {
  return MOCK_TASKS.filter(t => t.assignedTo === agentId);
}

export function getTaskById(id: string): Task | undefined {
  return MOCK_TASKS.find(t => t.id === id);
}
