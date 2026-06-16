import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
    appendFileSync,
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    rmSync,
    renameSync,
    writeFileSync
} from 'fs';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'path';
import {
    AuthStorage,
    createAgentSession,
    DefaultResourceLoader,
    defineTool,
    getAgentDir,
    ModelRegistry,
    SessionManager,
    SettingsManager,
    type ExtensionAPI,
    type SessionStats
} from '@earendil-works/pi-coding-agent';

type TaskStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
type WaitGroupMode = 'WAIT_ALL' | 'ON_DEMAND';
type WaitGroupStatus = 'WAITING' | 'READY' | 'PROCESSED' | 'FAILED';
type TaskRunStatus = 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';
type ModelAlias = 'fast' | 'balanced' | 'deep';
type EffortLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type TaskChatRole = 'system' | 'user' | 'assistant' | 'event';
type TaskMessageType = 'text' | 'artifact' | 'event';
type SwarmEventType =
    | 'TASK_CREATED'
    | 'TASK_QUEUED'
    | 'TASK_STARTED'
    | 'TASK_WAITING'
    | 'TASK_RESUMED'
    | 'TASK_COMPLETED'
    | 'TASK_FAILED'
    | 'TASK_CANCELLED'
    | 'TASK_RETRY_REQUESTED'
    | 'TASK_RETRIED'
    | 'RUN_STARTED'
    | 'RUN_COMPLETED'
    | 'RUN_FAILED'
    | 'RUN_TIMEOUT'
    | 'WAIT_GROUP_REGISTERED'
    | 'WAIT_GROUP_READY'
    | 'WAIT_GROUP_PROCESSED'
    | 'SUBTASK_CREATED'
    | 'MESSAGE_APPENDED'
    | 'ARTIFACT_CREATED'
    | 'AGENT_OUTPUT_INVALID'
    | 'BUDGET_EXCEEDED';

const MODEL_PROVIDER = 'openrouter';
const DEFAULT_MODEL_ALIAS: ModelAlias = 'fast';
const DEFAULT_EFFORT: EffortLevel = 'off';
const ALLOWED_MODELS: Record<ModelAlias, { provider: string; modelId: string; description: string }> = {
    fast: { provider: MODEL_PROVIDER, modelId: 'openai/gpt-5.4-nano', description: 'tarefas simples e baixo custo' },
    balanced: { provider: MODEL_PROVIDER, modelId: 'deepseek/deepseek-v4-flash', description: 'uso geral equilibrado' },
    deep: { provider: MODEL_PROVIDER, modelId: 'deepseek/deepseek-v4-pro', description: 'tarefas complexas ou criticas' }
};
const ALLOWED_EFFORTS: EffortLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const DEFAULT_RUNTIME_CONFIG: Required<RuntimeConfig> = { model: DEFAULT_MODEL_ALIAS, effort: DEFAULT_EFFORT };
const AVAILABLE_TOOLS = ['read', 'grep', 'find', 'ls', 'create_subtask', 'create_artifact'];

const SWARM_DIR = '.swarm';
const TASKS_DIR_NAME = 'tasks';
const EVENTS_DIR_NAME = 'events';
const LOGS_DIR_NAME = 'logs';
const STATE_FILE = swarmPath('state.snapshot.json');
const STATE_BACKUP_FILE = swarmPath('state.snapshot.json.bak');
const EVENTS_FILE = swarmPath(EVENTS_DIR_NAME, 'current.jsonl');
const ORCHESTRATOR_LOG_FILE = swarmPath(LOGS_DIR_NAME, 'orchestrator.jsonl');
const SWARM_ROOT_FILE = swarmPath('.swarm-root');
const SWARM_CONFIG_FILE = swarmPath('swarm.yml');

const MAX_TASK_DEPTH = readPositiveIntegerEnv('SWARM_MAX_TASK_DEPTH', 4);
const MAX_TASK_RETRIES = readPositiveIntegerEnv('SWARM_MAX_TASK_RETRIES', 2);
const MAX_TECHNICAL_RETRIES = readPositiveIntegerEnv('SWARM_MAX_TECHNICAL_RETRIES', 2);
const MAX_CONCURRENCY = readPositiveIntegerEnv('SWARM_MAX_CONCURRENCY', 3);
const MAX_SUBTASKS_PER_TASK = readPositiveIntegerEnv('SWARM_MAX_SUBTASKS_PER_TASK', 25);
const MAX_PROMPT_CHAT_MESSAGES = readPositiveIntegerEnv('SWARM_MAX_PROMPT_CHAT_MESSAGES', 60);
const MAX_ATTACHMENT_BYTES = readPositiveIntegerEnv('SWARM_MAX_ATTACHMENT_BYTES', 20 * 1024 * 1024);
const MAX_ARTIFACT_BYTES = readPositiveIntegerEnv('SWARM_MAX_ARTIFACT_BYTES', 5 * 1024 * 1024);
const RUN_TIMEOUT_MS = readPositiveIntegerEnv('SWARM_RUN_TIMEOUT_MS', 10 * 60 * 1000);
const RETRY_BASE_DELAY_MS = readPositiveIntegerEnv('SWARM_RETRY_BASE_DELAY_MS', 1000);
const MAX_TOTAL_TOKENS = readPositiveIntegerEnv('SWARM_MAX_TOTAL_TOKENS', Number.MAX_SAFE_INTEGER);
const MAX_TOTAL_COST = readPositiveNumberEnv('SWARM_MAX_TOTAL_COST', Number.POSITIVE_INFINITY);

interface RuntimeConfig {
    model?: ModelAlias;
    effort?: EffortLevel;
}

interface AttachmentRef {
    id: string;
    originalName: string;
    path: string;
    sizeBytes: number;
}

interface TaskArtifact {
    description: string;
    file_type: string;
    path: string;
    sizeBytes?: number;
}

interface TaskChatMessage {
    ts: string;
    role: TaskChatRole;
    type: TaskMessageType;
    text?: string;
    attachments?: AttachmentRef[];
    artifacts?: TaskArtifact[];
    runtimeConfig?: RuntimeConfig;
    eventId?: string;
}

interface TaskOptions {
    task_id: string;
    title: string;
    assignedTo: string;
    parentId?: string;
    depth: number;
    runtimeConfig?: RuntimeConfig;
}

interface WaitGroup {
    waitId: string;
    mode: WaitGroupMode;
    taskIds: string[];
    processedEventIds: string[];
    status: WaitGroupStatus;
}

interface TaskRun {
    runId: string;
    status: TaskRunStatus;
    waitGroups: WaitGroup[];
    resultMessages: TaskChatMessage[];
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
}

interface TaskMetrics {
    startedAt?: string;
    finishedAt?: string;
    durationMs: number;
    tokens: {
        input: number;
        output: number;
        total: number;
    };
    cost: number;
}

interface SerializedTask {
    options: TaskOptions;
    status: TaskStatus;
    subtaskIds: string[];
    resultMessages?: TaskChatMessage[];
    activeRunId?: string;
    runs?: TaskRun[];
    piSessionFile?: string;
    chat?: TaskChatMessage[];
    artifacts?: TaskArtifact[];
    retryCount?: number;
    technicalRetryCount?: number;
    metrics?: TaskMetrics;
}

interface SwarmEvent {
    seq: number;
    eventId: string;
    type: SwarmEventType;
    taskId?: string;
    parentId?: string;
    runId?: string;
    waitId?: string;
    ts: string;
    messages?: TaskChatMessage[];
    processedByTaskIds: string[];
    payload?: Record<string, unknown>;
}

interface SwarmState {
    version: 2;
    savedAt: string;
    nextSeq: number;
    rootTaskIds: string[];
    tasks: SerializedTask[];
    events: SwarmEvent[];
}

interface TaskMetadata {
    task_id: string;
    title: string;
    assignedTo: string;
    parentId?: string;
    status: TaskStatus;
    depth: number;
    maxDepth: number;
    canCreateSubtasks: boolean;
    sessionFile: string;
    chatFile: string;
    attachmentsDir: string;
    artifactsDir: string;
    artifactsFile: string;
    runtimeConfig: Required<RuntimeConfig>;
    allowedModels: Record<ModelAlias, { provider: string; modelId: string; description: string }>;
    allowedEfforts: EffortLevel[];
    retryCount: number;
    technicalRetryCount: number;
    maxRetries: number;
    maxTechnicalRetries: number;
    maxSubtasksPerTask: number;
    runTimeoutMs: number;
    activeRunId?: string;
    runs: TaskRun[];
    taskChat: TaskChatMessage[];
    artifacts: TaskArtifact[];
    metrics: TaskMetrics;
}

interface AgentOutputMessage {
    type: TaskMessageType;
    text?: string;
    artifacts?: TaskArtifact[];
}

interface AgentDecision {
    status: 'completed' | 'waiting' | 'retry';
    messages: AgentOutputMessage[];
    waitGroups?: AgentWaitGroup[];
    waitMode?: WaitGroupMode;
    waitingForTaskIds?: string[];
    instructions?: string;
    model?: ModelAlias;
    effort?: EffortLevel;
}

interface AgentWaitGroup {
    waitId: string;
    mode: WaitGroupMode;
    taskIds: string[];
}

interface PiRunResult {
    output: string;
    stats: SessionStats;
}

interface SwarmRunResult {
    mainTask: Task;
    orquestrator: Orquestrator;
}

class AgentOutputInvalidError extends Error {
    output: string;

    constructor(message: string, output: string) {
        super(message);
        this.name = 'AgentOutputInvalidError';
        this.output = output;
    }
}

class RunTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`Run excedeu timeout de ${timeoutMs}ms`);
        this.name = 'RunTimeoutError';
    }
}

class BudgetExceededError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BudgetExceededError';
    }
}

class Task {
    options: TaskOptions;
    status: TaskStatus = 'PENDING';
    subtaskIds: string[] = [];
    resultMessages: TaskChatMessage[] = [];
    activeRunId?: string;
    runs: TaskRun[] = [];
    piSessionFile?: string;
    chat: TaskChatMessage[] = [];
    artifacts: TaskArtifact[] = [];
    retryCount = 0;
    technicalRetryCount = 0;
    metrics: TaskMetrics = createEmptyTaskMetrics();

    constructor(options: TaskOptions, seedInitialMessage = true, attachments: AttachmentRef[] = []) {
        this.options = {
            ...options,
            depth: options.depth ?? 0,
            runtimeConfig: normalizeRuntimeConfig(options.runtimeConfig)
        };
        if (seedInitialMessage) this.appendChat('user', 'text', options.title, options.runtimeConfig, attachments);
    }

    static fromSerialized(serialized: SerializedTask): Task {
        const task = new Task(normalizeTaskOptions(serialized.options), false);
        task.status = serialized.status;
        task.subtaskIds = uniqueStrings(serialized.subtaskIds ?? []);
        task.resultMessages = serialized.resultMessages ?? [];
        task.activeRunId = serialized.activeRunId;
        task.runs = serialized.runs ?? [];
        task.piSessionFile = sanitizeOptionalTaskRelativePath(serialized.options.task_id, serialized.piSessionFile);
        task.chat = loadTaskChat(task.options.task_id, serialized.chat ?? []);
        task.artifacts = (serialized.artifacts ?? []).filter(isTaskArtifact);
        task.retryCount = serialized.retryCount ?? 0;
        task.technicalRetryCount = serialized.technicalRetryCount ?? 0;
        task.metrics = normalizeTaskMetrics(serialized.metrics);
        return task;
    }

    appendChat(
        role: TaskChatRole,
        type: TaskMessageType,
        text?: string,
        runtimeConfig?: RuntimeConfig,
        attachments?: AttachmentRef[],
        artifacts?: TaskArtifact[],
        eventId?: string
    ): TaskChatMessage {
        const message: TaskChatMessage = { ts: new Date().toISOString(), role, type };
        if (text !== undefined) message.text = text;
        if (runtimeConfig !== undefined) message.runtimeConfig = normalizeRuntimeConfig(runtimeConfig);
        if (attachments?.length) message.attachments = attachments;
        if (artifacts?.length) message.artifacts = artifacts.filter(isTaskArtifact);
        if (eventId) message.eventId = eventId;
        this.chat.push(message);
        return message;
    }

    appendAgentMessages(messages: AgentOutputMessage[]): TaskChatMessage[] {
        return messages.map(message => this.appendChat('assistant', message.type, message.text, undefined, undefined, message.artifacts));
    }

    serialize(): SerializedTask {
        return {
            options: this.options,
            status: this.status,
            subtaskIds: this.subtaskIds,
            resultMessages: this.resultMessages,
            activeRunId: this.activeRunId,
            runs: this.runs,
            piSessionFile: this.piSessionFile,
            artifacts: this.artifacts,
            retryCount: this.retryCount,
            technicalRetryCount: this.technicalRetryCount,
            metrics: this.metrics
        };
    }
}

class Agent {
    name: string;
    system_prompt: string;
    runtimeConfig: Required<RuntimeConfig>;

    constructor(name: string, system_prompt: string, runtimeConfig: Required<RuntimeConfig>) {
        this.name = name;
        this.system_prompt = system_prompt;
        this.runtimeConfig = mergeRuntimeConfig(runtimeConfig);
    }
}

class SwarmStateStore {
    constructor() {
        this.ensureLayout();
    }

    reset() {
        if (existsSync(swarmAbsPath())) rmSync(swarmAbsPath(), { recursive: true, force: true });
        this.ensureLayout();
    }

    ensureLayout() {
        mkdirSync(swarmAbsPath(EVENTS_DIR_NAME), { recursive: true });
        mkdirSync(swarmAbsPath(TASKS_DIR_NAME), { recursive: true });
        mkdirSync(swarmAbsPath(LOGS_DIR_NAME), { recursive: true });
        if (!existsSync(absPath(SWARM_ROOT_FILE))) writeFileAtomic(absPath(SWARM_ROOT_FILE), 'swarm-root: true\n');
        if (!existsSync(absPath(SWARM_CONFIG_FILE))) {
            writeFileAtomic(absPath(SWARM_CONFIG_FILE), [
                'version: 2',
                `max_concurrency: ${MAX_CONCURRENCY}`,
                `run_timeout_ms: ${RUN_TIMEOUT_MS}`,
                `max_task_depth: ${MAX_TASK_DEPTH}`,
                `max_subtasks_per_task: ${MAX_SUBTASKS_PER_TASK}`,
                ''
            ].join('\n'));
        }
        if (!existsSync(absPath(EVENTS_FILE))) writeFileAtomic(absPath(EVENTS_FILE), '');
    }

    loadSnapshot(): SwarmState | undefined {
        for (const file of [STATE_FILE, STATE_BACKUP_FILE]) {
            const filePath = absPath(file);
            if (!existsSync(filePath)) continue;
            try {
                return JSON.parse(readFileSync(filePath, 'utf8')) as SwarmState;
            } catch (error) {
                this.appendLog('SNAPSHOT_LOAD_FAILED', { file, error: errorMessage(error) });
            }
        }
        return undefined;
    }

    loadEvents(): SwarmEvent[] {
        const filePath = absPath(EVENTS_FILE);
        if (!existsSync(filePath)) return [];
        return readFileSync(filePath, 'utf8')
            .split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => JSON.parse(line) as SwarmEvent);
    }

    saveSnapshot(tasks: Map<string, Task>, events: SwarmEvent[], rootTaskIds: string[], nextSeq: number) {
        if (existsSync(absPath(STATE_FILE))) {
            copyFileAtomic(absPath(STATE_FILE), absPath(STATE_BACKUP_FILE));
        }
        const state: SwarmState = {
            version: 2,
            savedAt: new Date().toISOString(),
            nextSeq,
            rootTaskIds,
            tasks: [...tasks.values()].map(task => task.serialize()),
            events
        };
        writeFileAtomic(absPath(STATE_FILE), JSON.stringify(state, null, 2));
    }

    appendEvent(event: SwarmEvent) {
        mkdirSync(dirname(absPath(EVENTS_FILE)), { recursive: true });
        appendFileSync(absPath(EVENTS_FILE), `${JSON.stringify(event)}\n`);
    }

    appendLog(type: string, payload: Record<string, unknown>) {
        const log = { ts: new Date().toISOString(), type, payload };
        mkdirSync(dirname(absPath(ORCHESTRATOR_LOG_FILE)), { recursive: true });
        appendFileSync(absPath(ORCHESTRATOR_LOG_FILE), `${JSON.stringify(log)}\n`);
        console.log(formatOrchestratorLog(log));
    }
}

class PiAgentClient {
    private authStorage = AuthStorage.inMemory();
    private modelRegistry = ModelRegistry.inMemory(this.authStorage);
    private settingsManager = SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: true, maxRetries: 1 }
    });

    constructor() {
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) throw new Error('OPENROUTER_API_KEY não configurada');

        this.authStorage.setRuntimeApiKey(MODEL_PROVIDER, apiKey);
        for (const [alias, config] of Object.entries(ALLOWED_MODELS)) {
            if (!this.modelRegistry.find(config.provider, config.modelId)) {
                throw new Error(`Modelo alias ${alias} (${config.provider}/${config.modelId}) não encontrado no Pi SDK`);
            }
        }
    }

    async run(agent: Agent, task: Task, orquestrator: Orquestrator, triggerEvents: SwarmEvent[] = []): Promise<PiRunResult> {
        const runtimeConfig = orquestrator.resolveRuntimeConfig(task, agent);
        const model = this.resolveModel(runtimeConfig);
        const taskDir = getTaskDir(task.options.task_id);
        const resourceLoader = this.createResourceLoader(agent, task, orquestrator, taskDir);
        await resourceLoader.reload();
        ensureTaskArtifacts(task);

        const sessionPath = resolveTaskPath(
            task.options.task_id,
            task.piSessionFile ?? toTaskRelativePath(task.options.task_id, getTaskSessionFile(task.options.task_id))
        );
        const sessionManager = SessionManager.open(sessionPath);

        const { session } = await createAgentSession({
            cwd: taskDir,
            model,
            thinkingLevel: runtimeConfig.effort,
            authStorage: this.authStorage,
            modelRegistry: this.modelRegistry,
            resourceLoader,
            tools: AVAILABLE_TOOLS,
            sessionManager,
            settingsManager: this.settingsManager
        });

        task.piSessionFile = normalizeSessionFile(task.options.task_id, session.sessionFile ?? getTaskSessionFile(task.options.task_id));
        orquestrator.persistTask(task);

        let output = '';
        try {
            session.subscribe((event: any) => {
                if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
                    output += event.assistantMessageEvent.delta;
                }
            });

            await withTimeout(session.prompt(this.buildPrompt(task, orquestrator, triggerEvents)), RUN_TIMEOUT_MS);
            return { output: output.trim(), stats: session.getSessionStats() };
        } finally {
            session.dispose();
        }
    }

    private resolveModel(config: Required<RuntimeConfig>) {
        const modelConfig = ALLOWED_MODELS[config.model];
        const model = this.modelRegistry.find(modelConfig.provider, modelConfig.modelId);
        if (!model) throw new Error(`Modelo ${modelConfig.provider}/${modelConfig.modelId} não encontrado no Pi SDK`);
        return model;
    }

    private createResourceLoader(agent: Agent, task: Task, orquestrator: Orquestrator, cwd: string): DefaultResourceLoader {
        return new DefaultResourceLoader({
            cwd,
            agentDir: getAgentDir(),
            settingsManager: this.settingsManager,
            noExtensions: true,
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true,
            systemPrompt: `${agent.system_prompt}
${orquestrator.buildTaskMetadataBlock(task)}

Voce esta em um sandbox de filesystem restrito ao diretorio da task atual.
Use read, grep, find e ls apenas para inspecionar arquivos dessa task, attachments e artifacts.
Voce decide se resolve diretamente ou se cria subtasks pela tool create_subtask.
Use create_subtask apenas quando a tarefa realmente precisar de delegacao.
Se a tarefa ou anexo pedir "subtasks", "subtasks diferentes", "aguarde", "sob demanda" ou grupos de espera, voce DEVE criar subtasks e nao pode responder direto.
Quando criar subtasks para grupos de espera, chame create_subtask para cada item antes de retornar waiting com waitGroups.
Nunca crie subtasks quando task_metadata.canCreateSubtasks for false.
Voce pode escolher model/effort para subtasks usando apenas os aliases e efforts permitidos em task_metadata.
Se a propria task nao atingiu o objetivo, retorne status retry com novas instrucoes e opcionalmente model/effort.
Quando precisar produzir arquivo, use create_artifact. Nunca escreva artefatos por outro caminho.
Depois de criar subtasks, retorne JSON aguardando as task_ids criadas.
Se ja houver subtasks listadas para o mesmo pedido, nao crie outra; use os resultados existentes.
Para esperas mistas, retorne waitGroups no status waiting. Cada waitGroup tem waitId, mode e taskIds.
WAIT_ALL entrega eventos do grupo juntos quando todas as taskIds completarem ou quando alguma falhar. ON_DEMAND entrega uma task concluida ou falha por vez.
Responda SEMPRE somente JSON puro, sem markdown, sem texto antes ou depois. JSON invalido falha a task.
Formatos aceitos:
{"status":"completed","messages":[{"type":"text","text":"resultado final"}]}
ou
{"status":"waiting","waitGroups":[{"waitId":"grupo-a","mode":"WAIT_ALL|ON_DEMAND","taskIds":["task_id"]}],"messages":[{"type":"text","text":"motivo curto"}]}
ou
{"status":"retry","instructions":"novas instrucoes objetivas","model":"fast|balanced|deep","effort":"off|minimal|low|medium|high|xhigh","messages":[{"type":"text","text":"motivo curto"}]}
Mensagens devem usar type text, artifact ou event. Quando status for completed, messages deve conter apenas a resposta final ao usuario, sem explicar o workflow.`,
            extensionFactories: [
                (pi: ExtensionAPI) => {
                    pi.registerTool(defineTool({
                        name: 'create_subtask',
                        label: 'Create Subtask',
                        description: 'Cria uma subtask assíncrona para outro agente e retorna os metadados da task criada.',
                        parameters: {
                            type: 'object',
                            properties: {
                                assignedTo: {
                                    type: 'string',
                                    description: `Agente destino. Disponiveis: ${orquestrator.getAgentNames().join(', ')}`
                                },
                                title: { type: 'string', description: 'Titulo curto da subtask' },
                                message: { type: 'string', description: 'Mensagem inicial objetiva da subtask' },
                                model: {
                                    type: 'string',
                                    enum: Object.keys(ALLOWED_MODELS),
                                    description: 'Alias opcional de modelo permitido.'
                                },
                                effort: {
                                    type: 'string',
                                    enum: ALLOWED_EFFORTS,
                                    description: 'Effort opcional para a subtask.'
                                }
                            },
                            required: ['assignedTo', 'title', 'message'],
                            additionalProperties: false
                        },
                        async execute(_toolCallId: string, params: Record<string, unknown>) {
                            const assignedTo = requireStringParam(params, 'assignedTo');
                            const title = requireStringParam(params, 'title');
                            const message = requireStringParam(params, 'message');
                            const runtimeConfig = normalizeRuntimeConfig({
                                model: params.model === undefined ? undefined : parseModelAlias(String(params.model)),
                                effort: params.effort === undefined ? undefined : parseEffortLevel(String(params.effort))
                            });
                            const existingSubtask = orquestrator.getSubtasks(task).find(subtask =>
                                subtask.options.assignedTo === assignedTo &&
                                subtask.options.title === title &&
                                subtask.chat.some(chatMessage => chatMessage.role === 'user' && chatMessage.text === message) &&
                                JSON.stringify(subtask.options.runtimeConfig ?? {}) === JSON.stringify(runtimeConfig ?? {})
                            );

                            const subtask = existingSubtask ?? orquestrator.spawnSubtask(
                                task,
                                assignedTo,
                                title,
                                message,
                                runtimeConfig
                            );

                            return {
                                content: [{ type: 'text', text: JSON.stringify(orquestrator.toMetadata(subtask)) }],
                                details: orquestrator.toMetadata(subtask)
                            };
                        }
                    }));
                    pi.registerTool(defineTool({
                        name: 'create_artifact',
                        label: 'Create Artifact',
                        description: 'Cria um arquivo em artifacts da task atual e registra no artifacts.yaml.',
                        parameters: {
                            type: 'object',
                            properties: {
                                fileName: { type: 'string', description: 'Nome do arquivo relativo ao diretorio artifacts da task.' },
                                content: { type: 'string', description: 'Conteudo textual completo do artefato.' },
                                description: { type: 'string', description: 'Descricao breve do artefato.' },
                                file_type: { type: 'string', description: 'Tipo do arquivo, por exemplo markdown, json, text.' }
                            },
                            required: ['fileName', 'content', 'description', 'file_type'],
                            additionalProperties: false
                        },
                        async execute(_toolCallId: string, params: Record<string, unknown>) {
                            const artifact = createTaskArtifact(
                                task,
                                requireStringParam(params, 'fileName'),
                                requireStringParam(params, 'content'),
                                requireStringParam(params, 'description'),
                                requireStringParam(params, 'file_type')
                            );
                            orquestrator.recordArtifactCreated(task, artifact);
                            orquestrator.persistTask(task);
                            return {
                                content: [{ type: 'text', text: JSON.stringify(artifact) }],
                                details: artifact
                            };
                        }
                    }));
                }
            ]
        });
    }

    private buildPrompt(task: Task, orquestrator: Orquestrator, triggerEvents: SwarmEvent[]): string {
        const subtaskResults = orquestrator.getSubtasks(task)
            .map(subtask => `- ${subtask.options.task_id} ${subtask.options.title} (${subtask.options.assignedTo}) [${subtask.status}]: ${formatMessages(subtask.resultMessages) || 'sem mensagens'}`)
            .join('\n');
        const eventSummary = triggerEvents.length
            ? triggerEvents.map(event => {
                const status = event.type === 'TASK_FAILED' ? 'falhou' : event.type === 'TASK_CANCELLED' ? 'cancelada' : 'concluida';
                return `- ${event.eventId}: run ${event.runId ?? '-'} wait ${event.waitId ?? '-'} task ${event.taskId ?? '-'} ${status}. mensagens: ${formatMessages(event.messages ?? [])}. payload=${JSON.stringify(event.payload ?? {})}`;
            }).join('\n')
            : 'inicio ou retomada sem novo evento.';
        const runSummary = task.runs.length
            ? task.runs.map(run => `- ${run.runId} [${run.status}]: ${run.waitGroups.map(group => `${group.waitId}/${group.mode}/${group.status} tasks=${group.taskIds.join(',')} processed=${group.processedEventIds.join(',')}`).join(' ; ')}`).join('\n')
            : 'Sem runs.';
        const chatTail = task.chat.slice(-MAX_PROMPT_CHAT_MESSAGES);

        return [
            `Tarefa: ${task.options.title}`,
            `Eventos recebidos:\n${eventSummary}`,
            subtaskResults ? `Subtasks:\n${subtaskResults}` : 'Sem subtasks.',
            `Runs:\n${runSummary}`,
            `Task chat:\n${chatTail.map(formatChatMessage).join('\n')}`,
            task.piSessionFile ? `Sessao Pi persistida: ${task.piSessionFile}` : 'Sem sessao Pi persistida.',
            'Continue a partir do historico anterior da sessao, decida o proximo passo e retorne somente o JSON estruturado.'
        ].join('\n\n');
    }
}

class Orquestrator extends EventEmitter {
    agents: Map<string, Agent> = new Map();
    tasks: Map<string, Task> = new Map();
    events: SwarmEvent[] = [];
    rootTaskIds: string[] = [];
    pi = new PiAgentClient();

    private nextSeq = 1;
    private runningTaskIds = new Set<string>();
    private queuedTaskIds = new Set<string>();
    private taskQueue: string[] = [];
    private pendingTriggerEvents = new Map<string, Map<string, SwarmEvent>>();
    private dirtyTaskIds = new Set<string>();
    private waitingByDependency = new Map<string, Set<string>>();
    private store = new SwarmStateStore();
    private shuttingDown = false;
    private options: { resetState?: boolean; stopWhenWaiting?: boolean };

    constructor(agents: Agent[], options: { resetState?: boolean; stopWhenWaiting?: boolean } = {}) {
        super();
        this.options = options;
        for (const agent of agents) this.agents.set(agent.name, agent);
        if (options.resetState) this.store.reset();
        this.loadState();
        this.rebuildWaitIndex();
        if (!options.resetState && !options.stopWhenWaiting) this.scheduleReadyTasks();
    }

    addTask(title: string, agentName: string, runtimeConfig?: RuntimeConfig, attachmentPaths: string[] = []): Task {
        this.assertAgentExists(agentName);
        const taskId = this.createTaskId();
        const attachments = copyTaskAttachments(taskId, attachmentPaths);
        const task = new Task({
            task_id: taskId,
            title,
            assignedTo: agentName,
            depth: 0,
            runtimeConfig: normalizeRuntimeConfig(runtimeConfig)
        }, true, attachments);
        this.tasks.set(task.options.task_id, task);
        this.rootTaskIds.push(task.options.task_id);
        this.markTaskDirty(task);
        this.recordEvent('TASK_CREATED', { task, payload: { task: task.serialize() } });
        this.persist();
        this.scheduleTask(task.options.task_id);
        return task;
    }

    spawnSubtask(parentTask: Task, agentName: string, title: string, message: string, runtimeConfig?: RuntimeConfig): Task {
        this.assertAgentExists(agentName);
        if (parentTask.status === 'COMPLETED' || parentTask.status === 'FAILED' || parentTask.status === 'CANCELLED') {
            throw new Error(`Task ${parentTask.options.task_id} ja esta terminal e nao pode criar subtasks`);
        }
        if (parentTask.options.depth >= MAX_TASK_DEPTH) {
            throw new Error(`Depth maximo ${MAX_TASK_DEPTH} atingido para task ${parentTask.options.task_id}`);
        }
        if (parentTask.subtaskIds.length >= MAX_SUBTASKS_PER_TASK) {
            throw new Error(`Limite de ${MAX_SUBTASKS_PER_TASK} subtasks atingido para task ${parentTask.options.task_id}`);
        }

        const subtask = new Task({
            task_id: this.createTaskId(),
            title,
            assignedTo: agentName,
            parentId: parentTask.options.task_id,
            depth: parentTask.options.depth + 1,
            runtimeConfig: normalizeRuntimeConfig(runtimeConfig)
        }, true);
        subtask.chat[0].text = message;

        parentTask.subtaskIds.push(subtask.options.task_id);
        this.tasks.set(subtask.options.task_id, subtask);
        this.markTaskDirty(parentTask);
        this.markTaskDirty(subtask);
        this.recordEvent('SUBTASK_CREATED', {
            task: subtask,
            parentId: parentTask.options.task_id,
            payload: { parentTaskId: parentTask.options.task_id, task: subtask.serialize() }
        });
        this.persist();
        this.scheduleTask(subtask.options.task_id);
        return subtask;
    }

    scheduleReadyTasks() {
        if (this.shuttingDown) return;

        for (const task of this.tasks.values()) {
            if (task.status === 'PENDING' || task.status === 'QUEUED') this.scheduleTask(task.options.task_id);
        }

        if (this.options.stopWhenWaiting) return;
        const candidateTaskIds = new Set<string>();
        for (const waiters of this.waitingByDependency.values()) {
            for (const taskId of waiters) candidateTaskIds.add(taskId);
        }
        for (const taskId of candidateTaskIds) {
            const task = this.tasks.get(taskId);
            if (!task || task.status !== 'WAITING') continue;
            const triggerEvents = this.getReadyEvents(task);
            if (triggerEvents.length > 0) this.scheduleTask(task.options.task_id, triggerEvents);
        }
    }

    scheduleTask(taskId: string, triggerEvents: SwarmEvent[] = [], delayMs = 0) {
        if (this.shuttingDown) return;
        const task = this.tasks.get(taskId);
        if (!task || isTerminalTaskStatus(task.status)) return;

        this.mergePendingTriggerEvents(taskId, triggerEvents);
        if (!this.queuedTaskIds.has(taskId) && !this.runningTaskIds.has(taskId)) {
            this.queuedTaskIds.add(taskId);
            this.taskQueue.push(taskId);
            if (task.status !== 'QUEUED') {
                task.status = 'QUEUED';
                this.markTaskDirty(task);
                this.recordEvent('TASK_QUEUED', { task });
                this.persist();
            }
        }

        if (delayMs > 0) setTimeout(() => this.pumpQueue(), delayMs);
        else setTimeout(() => this.pumpQueue(), 0);
    }

    async runTask(taskId: string, triggerEvents: SwarmEvent[] = []) {
        const task = this.tasks.get(taskId);
        if (!task || isTerminalTaskStatus(task.status)) return;
        if (this.runningTaskIds.has(taskId)) return;

        const agent = this.agents.get(task.options.assignedTo);
        if (!agent) throw new Error(`Agente ${task.options.assignedTo} não encontrado`);

        const startedAt = new Date().toISOString();
        const run = this.getOrCreateExecutionRun(task, startedAt);
        this.runningTaskIds.add(taskId);
        task.status = 'RUNNING';
        task.metrics.startedAt ??= startedAt;
        run.status = 'RUNNING';
        run.startedAt = startedAt;
        this.markTaskDirty(task);
        this.recordEvent('TASK_STARTED', { task, runId: run.runId });
        this.recordEvent('RUN_STARTED', { task, runId: run.runId });
        this.persist();

        try {
            const result = await this.pi.run(agent, task, this, triggerEvents);
            const finishedAt = new Date().toISOString();
            task.metrics = addSessionStats(task.metrics, result.stats, startedAt, finishedAt);
            this.assertWithinBudget();
            const decision = this.parseDecision(result.output);
            task.technicalRetryCount = 0;
            this.applyDecision(task, run, decision, triggerEvents);
        } catch (error) {
            this.handleRunFailure(task, run, error, triggerEvents, startedAt);
        } finally {
            this.runningTaskIds.delete(taskId);
            this.emit('state:changed');
            setTimeout(() => this.pumpQueue(), 0);
        }
    }

    getSubtasks(task: Task): Task[] {
        return task.subtaskIds
            .map(taskId => this.tasks.get(taskId))
            .filter((subtask): subtask is Task => Boolean(subtask));
    }

    getAgentNames(): string[] {
        return [...this.agents.keys()];
    }

    printExecutionReport() {
        console.log('\n================== EXECUTION SUMMARY =================');
        console.log(this.formatSummaryTable());
        console.log('\n================== EXECUTION GRAPH =================');
        console.log(this.formatExecutionGraph());
    }

    resolveRuntimeConfig(task: Task, agent?: Agent): Required<RuntimeConfig> {
        return mergeRuntimeConfig(agent?.runtimeConfig, task.options.runtimeConfig);
    }

    toMetadata(task: Task): TaskMetadata {
        const agent = this.agents.get(task.options.assignedTo);
        return {
            task_id: task.options.task_id,
            title: task.options.title,
            assignedTo: task.options.assignedTo,
            parentId: task.options.parentId,
            status: task.status,
            depth: task.options.depth,
            maxDepth: MAX_TASK_DEPTH,
            canCreateSubtasks: task.options.depth < MAX_TASK_DEPTH && task.subtaskIds.length < MAX_SUBTASKS_PER_TASK,
            sessionFile: task.piSessionFile ?? toTaskRelativePath(task.options.task_id, getTaskSessionFile(task.options.task_id)),
            chatFile: toTaskRelativePath(task.options.task_id, getTaskChatFile(task.options.task_id)),
            attachmentsDir: toTaskRelativePath(task.options.task_id, getTaskAttachmentsDir(task.options.task_id)),
            artifactsDir: toTaskRelativePath(task.options.task_id, getTaskArtifactsDir(task.options.task_id)),
            artifactsFile: toTaskRelativePath(task.options.task_id, getTaskArtifactsFile(task.options.task_id)),
            runtimeConfig: this.resolveRuntimeConfig(task, agent),
            allowedModels: ALLOWED_MODELS,
            allowedEfforts: ALLOWED_EFFORTS,
            retryCount: task.retryCount,
            technicalRetryCount: task.technicalRetryCount,
            maxRetries: MAX_TASK_RETRIES,
            maxTechnicalRetries: MAX_TECHNICAL_RETRIES,
            maxSubtasksPerTask: MAX_SUBTASKS_PER_TASK,
            runTimeoutMs: RUN_TIMEOUT_MS,
            activeRunId: task.activeRunId,
            runs: task.runs,
            taskChat: task.chat,
            artifacts: task.artifacts,
            metrics: task.metrics
        };
    }

    buildTaskMetadataBlock(task: Task): string {
        return [
            '<task_metadata>',
            JSON.stringify(this.toMetadata(task), null, 2),
            '</task_metadata>'
        ].join('\n');
    }

    persistTask(task: Task) {
        this.markTaskDirty(task);
        this.persist();
    }

    persist() {
        this.flushDirtyTasks();
        this.store.saveSnapshot(this.tasks, this.events, this.rootTaskIds, this.nextSeq);
    }

    recordArtifactCreated(task: Task, artifact: TaskArtifact) {
        this.markTaskDirty(task);
        this.recordEvent('ARTIFACT_CREATED', { task, payload: { artifact } });
    }

    async waitUntilSettled(rootTask: Task) {
        return new Promise<void>((resolve) => {
            const check = () => {
                if (rootTask.status === 'COMPLETED' || rootTask.status === 'FAILED' || rootTask.status === 'CANCELLED') return resolve();
                if (this.options.stopWhenWaiting && rootTask.status === 'WAITING' && this.isQuiescent()) return resolve();
                this.once('state:changed', check);
            };
            check();
        });
    }

    getRootTask(): Task | undefined {
        const rootTaskId = this.rootTaskIds[0];
        return rootTaskId ? this.tasks.get(rootTaskId) : undefined;
    }

    shutdown() {
        this.shuttingDown = true;
        this.taskQueue = [];
        this.queuedTaskIds.clear();
        for (const taskId of this.runningTaskIds) {
            const task = this.tasks.get(taskId);
            if (!task || isTerminalTaskStatus(task.status)) continue;
            task.status = 'PENDING';
            this.markTaskDirty(task);
        }
        this.persist();
        this.emit('state:changed');
    }

    private pumpQueue() {
        if (this.shuttingDown) return;
        while (this.runningTaskIds.size < MAX_CONCURRENCY && this.taskQueue.length > 0) {
            const taskId = this.taskQueue.shift();
            if (!taskId) continue;
            this.queuedTaskIds.delete(taskId);
            const task = this.tasks.get(taskId);
            if (!task || isTerminalTaskStatus(task.status) || this.runningTaskIds.has(taskId)) continue;
            const triggerEvents = this.takePendingTriggerEvents(taskId);
            this.runTask(taskId, triggerEvents).catch(error => {
                const failedTask = this.tasks.get(taskId);
                if (failedTask && !isTerminalTaskStatus(failedTask.status)) {
                    const run = this.getOrCreateExecutionRun(failedTask, new Date().toISOString());
                    this.handleRunFailure(failedTask, run, error, triggerEvents, new Date().toISOString());
                }
            });
        }
    }

    private applyDecision(task: Task, run: TaskRun, decision: AgentDecision, triggerEvents: SwarmEvent[]) {
        if (decision.status === 'retry') {
            this.markEventsProcessed(task, triggerEvents);
            task.resultMessages = task.appendAgentMessages(decision.messages);
            if (task.retryCount >= MAX_TASK_RETRIES) {
                task.resultMessages = task.appendAgentMessages([{ type: 'text', text: `Retry maximo atingido: ${decision.instructions ?? ''}` }]);
                this.failTask(task, run, 'Retry maximo atingido');
                this.persist();
                return;
            }

            const runtimeConfig = normalizeRuntimeConfig({ model: decision.model, effort: decision.effort });
            task.retryCount += 1;
            task.status = 'PENDING';
            task.options.runtimeConfig = { ...(task.options.runtimeConfig ?? {}), ...(runtimeConfig ?? {}) };
            task.appendChat('user', 'text', decision.instructions ?? 'Reexecute a task com a configuracao atualizada.', runtimeConfig);
            this.markTaskDirty(task);
            this.recordEvent('TASK_RETRY_REQUESTED', { task, runId: run.runId, payload: { reason: decision.instructions ?? '' } });
            this.recordEvent('TASK_RETRIED', { task, runId: run.runId, payload: { retryCount: task.retryCount } });
            this.persist();
            this.scheduleTask(task.options.task_id);
            return;
        }

        if (decision.status === 'waiting') {
            const waitGroups = this.normalizeWaitGroups(task, decision);
            this.markEventsProcessed(task, triggerEvents);
            task.resultMessages = task.appendAgentMessages(decision.messages);
            this.startOrUpdateWaitRun(task, run, waitGroups, task.resultMessages);
            task.status = 'WAITING';
            this.markTaskDirty(task);
            this.recordEvent('TASK_WAITING', { task, runId: run.runId, payload: { waitGroups } });
            this.persist();
            return;
        }

        this.markEventsProcessed(task, triggerEvents);
        task.resultMessages = task.appendAgentMessages(decision.messages);
        task.status = 'COMPLETED';
        this.completeActiveRun(task, run);
        this.markTaskDirty(task);
        this.recordEvent('RUN_COMPLETED', { task, runId: run.runId, messages: task.resultMessages });
        this.recordEvent('TASK_COMPLETED', { task, runId: run.runId, messages: task.resultMessages });
        this.persist();
    }

    private handleRunFailure(task: Task, run: TaskRun, error: unknown, triggerEvents: SwarmEvent[], startedAt: string) {
        const finishedAt = new Date().toISOString();
        task.metrics.finishedAt = finishedAt;
        task.metrics.durationMs += Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
        const message = errorMessage(error);
        const isTimeout = error instanceof RunTimeoutError;
        const isBudget = error instanceof BudgetExceededError;
        const isInvalidOutput = error instanceof AgentOutputInvalidError;

        run.error = message;
        run.status = isTimeout ? 'TIMEOUT' : 'FAILED';
        run.completedAt = finishedAt;

        if (isTimeout) this.recordEvent('RUN_TIMEOUT', { task, runId: run.runId, payload: { error: message } });
        else this.recordEvent('RUN_FAILED', { task, runId: run.runId, payload: { error: message } });
        if (isInvalidOutput) {
            this.recordEvent('AGENT_OUTPUT_INVALID', {
                task,
                runId: run.runId,
                payload: { error: message, output: (error as AgentOutputInvalidError).output.slice(0, 4000) }
            });
        }
        if (isBudget) this.recordEvent('BUDGET_EXCEEDED', { task, runId: run.runId, payload: { error: message } });

        if (!isBudget && task.technicalRetryCount < MAX_TECHNICAL_RETRIES) {
            task.technicalRetryCount += 1;
            task.status = 'PENDING';
            task.appendChat(
                'user',
                'text',
                `A execucao anterior falhou tecnicamente: ${message}. Reexecute mantendo o objetivo original. Retorne somente JSON puro valido no contrato especificado.`
            );
            this.markTaskDirty(task);
            this.recordEvent('TASK_RETRY_REQUESTED', { task, runId: run.runId, payload: { reason: message, technical: true } });
            this.recordEvent('TASK_RETRIED', { task, runId: run.runId, payload: { technicalRetryCount: task.technicalRetryCount } });
            this.persist();
            this.scheduleTask(task.options.task_id, triggerEvents, RETRY_BASE_DELAY_MS * task.technicalRetryCount);
            return;
        }

        task.resultMessages = task.appendAgentMessages([{ type: 'text', text: `Falha ao executar task: ${message}` }]);
        this.failTask(task, run, message);
        this.persist();
    }

    private failTask(task: Task, run: TaskRun, reason: string) {
        task.status = 'FAILED';
        task.metrics.finishedAt = new Date().toISOString();
        run.status = 'FAILED';
        run.completedAt = run.completedAt ?? new Date().toISOString();
        run.error = reason;
        task.activeRunId = undefined;
        this.markTaskDirty(task);
        this.recordEvent('TASK_FAILED', { task, runId: run.runId, messages: task.resultMessages, payload: { error: reason } });
        this.rebuildWaitIndex();
    }

    private loadState() {
        const snapshot = this.store.loadSnapshot();
        if (snapshot) {
            this.events = snapshot.events ?? this.store.loadEvents();
            this.nextSeq = snapshot.nextSeq ?? (this.events.reduce((max, event) => Math.max(max, event.seq), 0) + 1);
            this.rootTaskIds = uniqueStrings(snapshot.rootTaskIds ?? []);
            for (const serializedTask of snapshot.tasks ?? []) {
                const task = Task.fromSerialized(serializedTask);
                this.tasks.set(task.options.task_id, task);
                if (!task.options.parentId && !this.rootTaskIds.includes(task.options.task_id)) this.rootTaskIds.push(task.options.task_id);
            }
        } else {
            this.events = this.store.loadEvents();
            this.nextSeq = this.events.reduce((max, event) => Math.max(max, event.seq), 0) + 1;
            this.replayEventsMinimal();
        }

        this.repairDepths();
        this.recoverStatusesAfterCrash();
    }

    private replayEventsMinimal() {
        for (const event of this.events) {
            const maybeTask = event.payload?.task;
            if ((event.type === 'TASK_CREATED' || event.type === 'SUBTASK_CREATED') && isSerializedTask(maybeTask)) {
                const task = Task.fromSerialized(maybeTask);
                this.tasks.set(task.options.task_id, task);
                if (!task.options.parentId && !this.rootTaskIds.includes(task.options.task_id)) this.rootTaskIds.push(task.options.task_id);
            }
            if (event.taskId) {
                const task = this.tasks.get(event.taskId);
                if (!task) continue;
                if (event.type === 'TASK_QUEUED') task.status = 'QUEUED';
                if (event.type === 'TASK_STARTED') task.status = 'RUNNING';
                if (event.type === 'TASK_WAITING') task.status = 'WAITING';
                if (event.type === 'TASK_COMPLETED') task.status = 'COMPLETED';
                if (event.type === 'TASK_FAILED') task.status = 'FAILED';
                if (event.type === 'TASK_CANCELLED') task.status = 'CANCELLED';
            }
        }
    }

    private repairDepths() {
        const visit = (task: Task, depth: number) => {
            task.options.depth = depth;
            for (const subtask of this.getSubtasks(task)) visit(subtask, depth + 1);
        };
        for (const rootTaskId of this.rootTaskIds) {
            const rootTask = this.tasks.get(rootTaskId);
            if (rootTask) visit(rootTask, 0);
        }
        for (const task of this.tasks.values()) {
            if (task.options.parentId && !this.tasks.has(task.options.parentId)) {
                task.options.parentId = undefined;
                task.options.depth = 0;
                if (!this.rootTaskIds.includes(task.options.task_id)) this.rootTaskIds.push(task.options.task_id);
            }
        }
    }

    private recoverStatusesAfterCrash() {
        for (const task of this.tasks.values()) {
            if (task.status === 'RUNNING' || task.status === 'QUEUED') {
                task.status = 'PENDING';
                this.markTaskDirty(task);
            }
            if (task.status === 'WAITING' && !this.hasValidActiveWait(task)) {
                task.status = 'PENDING';
                task.activeRunId = undefined;
                this.markTaskDirty(task);
            }
        }
        this.flushDirtyTasks();
    }

    private hasValidActiveWait(task: Task): boolean {
        const run = this.getActiveRun(task);
        if (!run || run.status !== 'WAITING') return false;
        return run.waitGroups.some(group =>
            group.status === 'WAITING' &&
            group.taskIds.length > 0 &&
            group.taskIds.every(taskId => {
                const dependency = this.tasks.get(taskId);
                return Boolean(dependency && dependency.options.parentId === task.options.task_id);
            })
        );
    }

    private formatSummaryTable(): string {
        const tasks = [...this.tasks.values()];
        const rows = tasks.map(task => [
            task.options.task_id,
            task.options.assignedTo,
            task.status,
            this.formatTaskDependencies(task),
            formatDuration(task.metrics.durationMs),
            String(task.metrics.tokens.total),
            String(task.metrics.tokens.input),
            String(task.metrics.tokens.output),
            formatCost(task.metrics.cost),
            `${task.retryCount}/${task.technicalRetryCount}`
        ]);
        const totals = tasks.reduce((acc, task) => ({
            durationMs: acc.durationMs + task.metrics.durationMs,
            input: acc.input + task.metrics.tokens.input,
            output: acc.output + task.metrics.tokens.output,
            total: acc.total + task.metrics.tokens.total,
            cost: acc.cost + task.metrics.cost
        }), { durationMs: 0, input: 0, output: 0, total: 0, cost: 0 });
        rows.push([
            'TOTAL',
            '-',
            '-',
            '-',
            formatDuration(totals.durationMs),
            String(totals.total),
            String(totals.input),
            String(totals.output),
            formatCost(totals.cost),
            '-'
        ]);
        return formatMarkdownTable(
            ['task', 'agent', 'status', 'depends_on', 'duration', 'tokens', 'input', 'output', 'price', 'retry/tech'],
            rows
        );
    }

    private formatTaskDependencies(task: Task): string {
        const dependencies = new Set<string>();
        for (const run of task.runs) {
            for (const group of run.waitGroups) {
                for (const taskId of group.taskIds) dependencies.add(`${group.waitId}:${taskId}`);
            }
        }
        if (task.options.parentId) dependencies.add(`parent:${task.options.parentId}`);
        return dependencies.size ? [...dependencies].join(', ') : '-';
    }

    private formatExecutionGraph(): string {
        const lines: string[] = [];
        for (const rootTaskId of this.rootTaskIds) {
            const rootTask = this.tasks.get(rootTaskId);
            if (rootTask) this.appendTaskGraph(lines, rootTask, '');
        }
        if (this.events.length) {
            lines.push('', 'Events:');
            for (const event of this.events) {
                lines.push(`  #${event.seq} ${event.type} ${event.taskId ?? '-'} -> parent=${event.parentId ?? '-'} run=${event.runId ?? '-'} wait=${event.waitId ?? '-'}`);
            }
        }
        return lines.join('\n') || '(sem tasks)';
    }

    private appendTaskGraph(lines: string[], task: Task, indent: string) {
        lines.push(`${indent}${task.options.task_id} [${task.options.assignedTo}/${task.status}] ${task.options.title}`);
        for (const run of task.runs) {
            lines.push(`${indent}  run ${run.runId} [${run.status}]`);
            for (const group of run.waitGroups) {
                lines.push(`${indent}    wait ${group.waitId} (${group.mode}/${group.status})`);
                for (const taskId of group.taskIds) {
                    const subtask = this.tasks.get(taskId);
                    lines.push(`${indent}      depends_on -> ${taskId}${subtask ? ` [${subtask.options.assignedTo}/${subtask.status}]` : ''}`);
                }
            }
        }
        for (const subtask of this.getSubtasks(task)) {
            this.appendTaskGraph(lines, subtask, `${indent}  `);
        }
    }

    private getActiveRun(task: Task): TaskRun | undefined {
        return task.activeRunId ? task.runs.find(run => run.runId === task.activeRunId) : undefined;
    }

    private getOrCreateExecutionRun(task: Task, startedAt: string): TaskRun {
        const active = this.getActiveRun(task);
        if (active) return active;
        const run: TaskRun = {
            runId: this.createId('run'),
            status: 'RUNNING',
            waitGroups: [],
            resultMessages: [],
            createdAt: startedAt,
            startedAt
        };
        task.activeRunId = run.runId;
        task.runs.push(run);
        return run;
    }

    private startOrUpdateWaitRun(task: Task, run: TaskRun, waitGroups: AgentWaitGroup[], resultMessages: TaskChatMessage[]) {
        run.status = 'WAITING';
        run.resultMessages = resultMessages;
        run.waitGroups = mergeWaitGroups(run.waitGroups, waitGroups.map(group => ({
            waitId: group.waitId,
            mode: group.mode,
            taskIds: group.taskIds,
            processedEventIds: [],
            status: 'WAITING'
        })));
        task.activeRunId = run.runId;
        this.rebuildWaitIndex();
        for (const group of waitGroups) {
            this.recordEvent('WAIT_GROUP_REGISTERED', { task, runId: run.runId, waitId: group.waitId, payload: { group } });
        }
    }

    private completeActiveRun(task: Task, run: TaskRun) {
        run.status = 'COMPLETED';
        run.completedAt = new Date().toISOString();
        for (const group of run.waitGroups) group.status = 'PROCESSED';
        task.activeRunId = undefined;
        this.rebuildWaitIndex();
    }

    private normalizeWaitGroups(task: Task, decision: AgentDecision): AgentWaitGroup[] {
        const candidateGroups = decision.waitGroups?.length
            ? decision.waitGroups
            : [{
                waitId: 'default',
                mode: decision.waitMode ?? 'WAIT_ALL',
                taskIds: decision.waitingForTaskIds?.length
                    ? decision.waitingForTaskIds
                    : this.getSubtasks(task).filter(subtask => !isTerminalTaskStatus(subtask.status)).map(subtask => subtask.options.task_id)
            }];

        const normalizedGroups = candidateGroups.map(group => this.normalizeSingleWaitGroup(task, group));
        if (normalizedGroups.length === 0 || normalizedGroups.every(group => group.taskIds.length === 0)) {
            throw new AgentOutputInvalidError('Status waiting sem wait group valido ou taskIds vazios', JSON.stringify(decision));
        }
        return normalizedGroups;
    }

    private normalizeSingleWaitGroup(task: Task, group: AgentWaitGroup): AgentWaitGroup {
        if (!group.waitId || typeof group.waitId !== 'string') {
            throw new AgentOutputInvalidError('Wait group sem waitId valido', JSON.stringify(group));
        }
        const waitId = sanitizeWaitId(group.waitId);
        if (group.mode !== 'WAIT_ALL' && group.mode !== 'ON_DEMAND') {
            throw new AgentOutputInvalidError(`Wait group ${waitId} com mode invalido`, JSON.stringify(group));
        }
        const taskIds = uniqueStrings(group.taskIds ?? []);
        if (taskIds.length === 0) {
            throw new AgentOutputInvalidError(`Wait group ${waitId} vazio`, JSON.stringify(group));
        }

        for (const dependencyTaskId of taskIds) {
            if (dependencyTaskId === task.options.task_id) {
                throw new AgentOutputInvalidError(`Self-wait detectado em ${task.options.task_id}`, JSON.stringify(group));
            }
            const dependency = this.tasks.get(dependencyTaskId);
            if (!dependency) {
                throw new AgentOutputInvalidError(`Wait group ${waitId} referencia task inexistente: ${dependencyTaskId}`, JSON.stringify(group));
            }
            if (dependency.options.parentId !== task.options.task_id) {
                throw new AgentOutputInvalidError(`Wait group ${waitId} referencia task que nao e subtask direta: ${dependencyTaskId}`, JSON.stringify(group));
            }
            if (this.waitGraphReachable(dependencyTaskId, task.options.task_id)) {
                throw new AgentOutputInvalidError(`Ciclo de dependencia detectado entre ${task.options.task_id} e ${dependencyTaskId}`, JSON.stringify(group));
            }
        }

        return { waitId, mode: group.mode, taskIds };
    }

    private waitGraphReachable(fromTaskId: string, targetTaskId: string, visited = new Set<string>()): boolean {
        if (fromTaskId === targetTaskId) return true;
        if (visited.has(fromTaskId)) return false;
        visited.add(fromTaskId);
        const task = this.tasks.get(fromTaskId);
        if (!task) return false;
        const run = this.getActiveRun(task);
        if (!run) return false;
        for (const group of run.waitGroups) {
            for (const dependencyTaskId of group.taskIds) {
                if (this.waitGraphReachable(dependencyTaskId, targetTaskId, visited)) return true;
            }
        }
        return false;
    }

    private getReadyEvents(task: Task): SwarmEvent[] {
        const run = this.getActiveRun(task);
        if (!run || run.status !== 'WAITING') return [];

        for (const group of run.waitGroups) {
            if (group.status === 'PROCESSED') continue;
            const terminalEvents = this.events
                .filter(event =>
                    isTerminalTaskEvent(event.type) &&
                    Boolean(event.taskId) &&
                    group.taskIds.includes(event.taskId as string) &&
                    !event.processedByTaskIds.includes(task.options.task_id) &&
                    !group.processedEventIds.includes(event.eventId)
                )
                .map(event => ({ ...event, runId: run.runId, waitId: group.waitId }));

            const failedEvent = terminalEvents.find(event => event.type === 'TASK_FAILED' || event.type === 'TASK_CANCELLED');
            if (failedEvent) {
                if (group.status !== 'READY') {
                    group.status = 'READY';
                    this.recordEvent('WAIT_GROUP_READY', { task, runId: run.runId, waitId: group.waitId, payload: { reason: failedEvent.type } });
                }
                return [failedEvent];
            }

            if (group.mode === 'ON_DEMAND' && terminalEvents.length > 0) {
                if (group.status !== 'READY') {
                    group.status = 'READY';
                    this.recordEvent('WAIT_GROUP_READY', { task, runId: run.runId, waitId: group.waitId, payload: { reason: 'ON_DEMAND' } });
                }
                return [terminalEvents[0]];
            }

            const allCompleted = group.taskIds.every(taskId => this.tasks.get(taskId)?.status === 'COMPLETED');
            if (group.mode === 'WAIT_ALL' && allCompleted) {
                if (group.status !== 'READY') {
                    group.status = 'READY';
                    this.recordEvent('WAIT_GROUP_READY', { task, runId: run.runId, waitId: group.waitId, payload: { reason: 'WAIT_ALL' } });
                }
                return terminalEvents;
            }
        }

        return [];
    }

    private markEventsProcessed(task: Task, triggerEvents: SwarmEvent[]) {
        const run = this.getActiveRun(task);
        for (const event of triggerEvents) {
            const originalEvent = this.events.find(candidate => candidate.eventId === event.eventId) ?? event;
            const group = run?.waitGroups.find(candidate => candidate.waitId === event.waitId);
            if (group && !group.processedEventIds.includes(originalEvent.eventId)) {
                group.processedEventIds.push(originalEvent.eventId);
                const processedTaskIds = new Set(this.events
                    .filter(candidate =>
                        isTerminalTaskEvent(candidate.type) &&
                        Boolean(candidate.taskId) &&
                        group.taskIds.includes(candidate.taskId as string) &&
                        group.processedEventIds.includes(candidate.eventId)
                    )
                    .map(candidate => candidate.taskId as string));
                if (group.taskIds.every(taskId => processedTaskIds.has(taskId))) {
                    group.status = 'PROCESSED';
                    this.recordEvent('WAIT_GROUP_PROCESSED', { task, runId: run?.runId, waitId: group.waitId });
                }
            }
            if (!originalEvent.processedByTaskIds.includes(task.options.task_id)) {
                originalEvent.processedByTaskIds.push(task.options.task_id);
            }
            if (!task.chat.some(message => message.eventId === originalEvent.eventId)) {
                task.appendChat(
                    'event',
                    'event',
                    `task ${originalEvent.taskId ?? '-'} ${terminalEventVerb(originalEvent.type)}`,
                    undefined,
                    undefined,
                    originalEvent.messages?.flatMap(message => message.artifacts ?? []),
                    originalEvent.eventId
                );
            }
        }
        if (triggerEvents.length > 0) this.markTaskDirty(task);
    }

    private scheduleWaitersForEvent(event: SwarmEvent) {
        if (this.options.stopWhenWaiting || !event.taskId) return;
        const waiterTaskIds = this.waitingByDependency.get(event.taskId);
        if (!waiterTaskIds?.size) return;
        for (const waiterTaskId of waiterTaskIds) {
            const waiter = this.tasks.get(waiterTaskId);
            if (!waiter || waiter.status !== 'WAITING') continue;
            const triggerEvents = this.getReadyEvents(waiter);
            if (triggerEvents.length > 0) this.scheduleTask(waiter.options.task_id, triggerEvents);
        }
    }

    private rebuildWaitIndex() {
        this.waitingByDependency.clear();
        for (const task of this.tasks.values()) {
            if (task.status !== 'WAITING') continue;
            const run = this.getActiveRun(task);
            if (!run || run.status !== 'WAITING') continue;
            for (const group of run.waitGroups) {
                if (group.status === 'PROCESSED') continue;
                for (const dependencyTaskId of group.taskIds) {
                    const waiters = this.waitingByDependency.get(dependencyTaskId) ?? new Set<string>();
                    waiters.add(task.options.task_id);
                    this.waitingByDependency.set(dependencyTaskId, waiters);
                }
            }
        }
    }

    private recordEvent(
        type: SwarmEventType,
        args: { task?: Task; parentId?: string; runId?: string; waitId?: string; messages?: TaskChatMessage[]; payload?: Record<string, unknown> } = {}
    ): SwarmEvent {
        if ((type === 'TASK_COMPLETED' || type === 'TASK_FAILED' || type === 'TASK_CANCELLED') && args.task) {
            const alreadyRecorded = this.events.some(event => event.type === type && event.taskId === args.task?.options.task_id);
            if (alreadyRecorded) return this.events.find(event => event.type === type && event.taskId === args.task?.options.task_id) as SwarmEvent;
        }

        const event: SwarmEvent = {
            seq: this.nextSeq++,
            eventId: this.createId('evt'),
            type,
            taskId: args.task?.options.task_id,
            parentId: args.parentId ?? args.task?.options.parentId,
            runId: args.runId,
            waitId: args.waitId,
            ts: new Date().toISOString(),
            messages: args.messages,
            processedByTaskIds: [],
            payload: args.payload
        };
        this.events.push(event);
        this.store.appendEvent(event);
        console.log(formatSwarmEvent(event));
        if (isTerminalTaskEvent(type)) this.scheduleWaitersForEvent(event);
        return event;
    }

    private parseDecision(output: string): AgentDecision {
        const trimmed = output.trim();
        if (!trimmed) throw new AgentOutputInvalidError('Agent retornou saida vazia', output);

        let parsed: unknown;
        try {
            parsed = JSON.parse(stripJsonFence(trimmed));
        } catch (error) {
            throw new AgentOutputInvalidError(`Agent retornou JSON invalido: ${errorMessage(error)}`, output);
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new AgentOutputInvalidError('Agent decision precisa ser um objeto JSON', output);
        }

        const candidate = parsed as Partial<AgentDecision>;
        if (candidate.status !== 'completed' && candidate.status !== 'waiting' && candidate.status !== 'retry') {
            throw new AgentOutputInvalidError(`Status invalido no agent output: ${String(candidate.status)}`, output);
        }

        const messages = normalizeAgentMessages(candidate.messages);
        if (candidate.status === 'completed') return { status: 'completed', messages };

        if (candidate.status === 'retry') {
            if (candidate.model !== undefined && !isModelAlias(candidate.model)) {
                throw new AgentOutputInvalidError(`Modelo alias invalido: ${String(candidate.model)}`, output);
            }
            if (candidate.effort !== undefined && !isEffortLevel(candidate.effort)) {
                throw new AgentOutputInvalidError(`Effort invalido: ${String(candidate.effort)}`, output);
            }
            return {
                status: 'retry',
                messages,
                instructions: typeof candidate.instructions === 'string' ? candidate.instructions : '',
                model: isModelAlias(candidate.model) ? candidate.model : undefined,
                effort: isEffortLevel(candidate.effort) ? candidate.effort : undefined
            };
        }

        return {
            status: 'waiting',
            messages,
            waitMode: candidate.waitMode === 'ON_DEMAND' ? 'ON_DEMAND' : 'WAIT_ALL',
            waitingForTaskIds: Array.isArray(candidate.waitingForTaskIds)
                ? candidate.waitingForTaskIds.filter((taskId): taskId is string => typeof taskId === 'string')
                : [],
            waitGroups: parseAgentWaitGroups(candidate.waitGroups, output)
        };
    }

    private assertWithinBudget() {
        const totals = [...this.tasks.values()].reduce((acc, task) => ({
            totalTokens: acc.totalTokens + task.metrics.tokens.total,
            totalCost: acc.totalCost + task.metrics.cost
        }), { totalTokens: 0, totalCost: 0 });
        if (totals.totalTokens > MAX_TOTAL_TOKENS) {
            this.recordEvent('BUDGET_EXCEEDED', { payload: { totalTokens: totals.totalTokens, maxTotalTokens: MAX_TOTAL_TOKENS } });
            throw new BudgetExceededError(`Budget de tokens excedido: ${totals.totalTokens}/${MAX_TOTAL_TOKENS}`);
        }
        if (totals.totalCost > MAX_TOTAL_COST) {
            this.recordEvent('BUDGET_EXCEEDED', { payload: { totalCost: totals.totalCost, maxTotalCost: MAX_TOTAL_COST } });
            throw new BudgetExceededError(`Budget de custo excedido: ${totals.totalCost}/${MAX_TOTAL_COST}`);
        }
    }

    private isQuiescent(): boolean {
        return this.runningTaskIds.size === 0 &&
            this.queuedTaskIds.size === 0 &&
            this.taskQueue.length === 0 &&
            [...this.tasks.values()].every(task => task.status !== 'PENDING' && task.status !== 'QUEUED' && task.status !== 'RUNNING');
    }

    private mergePendingTriggerEvents(taskId: string, triggerEvents: SwarmEvent[]) {
        if (triggerEvents.length === 0) return;
        const existing = this.pendingTriggerEvents.get(taskId) ?? new Map<string, SwarmEvent>();
        for (const event of triggerEvents) existing.set(event.eventId, event);
        this.pendingTriggerEvents.set(taskId, existing);
    }

    private takePendingTriggerEvents(taskId: string): SwarmEvent[] {
        const events = [...(this.pendingTriggerEvents.get(taskId)?.values() ?? [])];
        this.pendingTriggerEvents.delete(taskId);
        return events;
    }

    private markTaskDirty(task: Task) {
        this.dirtyTaskIds.add(task.options.task_id);
    }

    private flushDirtyTasks() {
        for (const taskId of this.dirtyTaskIds) {
            const task = this.tasks.get(taskId);
            if (task) ensureTaskArtifacts(task);
        }
        this.dirtyTaskIds.clear();
    }

    private assertAgentExists(agentName: string) {
        if (!this.agents.has(agentName)) throw new Error(`Agente ${agentName} não encontrado`);
    }

    private createTaskId(): string {
        return this.createId('task');
    }

    private createId(prefix: string): string {
        return `${prefix}_${randomUUID()}`;
    }
}

function createAgents(): Agent[] {
    return [
        new Agent('Manager', 'Você é o Gerente de projetos Senior focado em orquestração macro. Siga as instruções e entregue a task de forma objetiva.', { model: 'fast', effort: 'minimal' }),
        new Agent('Produto', 'Você é o Product Owner Senior, focado em regras de negócio e requisitos.', { model: 'fast', effort: 'low' }),
        new Agent('Engineer', 'Você é o Principal Engenheiro de Software, focado em arquitetura e código.', { model: 'fast', effort: 'medium' }),
        new Agent('Generic', 'Você é um executor de tarefas gerais de apoio.', { model: 'fast', effort: 'off' })
    ];
}

async function runNormal(requestedTask: string, runtimeConfig?: RuntimeConfig, attachmentPaths: string[] = []): Promise<SwarmRunResult> {
    const orquestrator = new Orquestrator(createAgents(), { resetState: true });
    const mainTask = orquestrator.addTask(requestedTask, 'Manager', runtimeConfig, attachmentPaths);
    await orquestrator.waitUntilSettled(mainTask);
    return { mainTask, orquestrator };
}

async function runRestartSimulation(requestedTask: string, runtimeConfig?: RuntimeConfig, attachmentPaths: string[] = []): Promise<SwarmRunResult> {
    console.log('[SIM] Fase 1: executando ate suspender e persistir estado.');
    const firstRun = new Orquestrator(createAgents(), { resetState: true, stopWhenWaiting: true });
    const firstTask = firstRun.addTask(requestedTask, 'Manager', runtimeConfig, attachmentPaths);
    await firstRun.waitUntilSettled(firstTask);
    firstRun.shutdown();
    console.log(`[SIM] Crash simulado. Estado persistido em ${STATE_FILE}`);

    console.log('[SIM] Fase 2: novo orquestrador carregando estado persistido.');
    const secondRun = new Orquestrator(createAgents());
    const resumedTask = secondRun.getRootTask();
    if (!resumedTask) throw new Error('Nenhuma root task persistida para retomar');
    secondRun.scheduleReadyTasks();
    await secondRun.waitUntilSettled(resumedTask);
    return { mainTask: resumedTask, orquestrator: secondRun };
}

function parseCliArgs(args: string[]): { requestedTask: string; simulateRestart: boolean; runtimeConfig?: RuntimeConfig; attachmentPaths: string[] } {
    const taskParts: string[] = [];
    const attachmentPaths: string[] = [];
    const runtimeConfig: RuntimeConfig = {};
    let simulateRestart = false;

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--simulate-restart') {
            simulateRestart = true;
            continue;
        }
        if (arg === '--model') {
            runtimeConfig.model = parseModelAlias(args[++index]);
            continue;
        }
        if (arg.startsWith('--model=')) {
            runtimeConfig.model = parseModelAlias(arg.slice('--model='.length));
            continue;
        }
        if (arg === '--effort') {
            runtimeConfig.effort = parseEffortLevel(args[++index]);
            continue;
        }
        if (arg.startsWith('--effort=')) {
            runtimeConfig.effort = parseEffortLevel(arg.slice('--effort='.length));
            continue;
        }
        if (arg === '--attach') {
            const attachmentPath = args[++index];
            if (!attachmentPath) throw new Error('--attach exige um caminho');
            attachmentPaths.push(attachmentPath);
            continue;
        }
        if (arg.startsWith('--attach=')) {
            attachmentPaths.push(arg.slice('--attach='.length));
            continue;
        }
        taskParts.push(arg);
    }

    return {
        requestedTask: taskParts.join(' ') || 'execute em subtasks diferentes no agent genérico. como se fala "oi" em japones, coreano, frances e ingles',
        simulateRestart,
        runtimeConfig: normalizeRuntimeConfig(runtimeConfig),
        attachmentPaths
    };
}

function parseModelAlias(value: string | undefined): ModelAlias {
    if (!isModelAlias(value)) throw new Error(`Modelo alias invalido: ${value}. Permitidos: ${Object.keys(ALLOWED_MODELS).join(', ')}`);
    return value;
}

function parseEffortLevel(value: string | undefined): EffortLevel {
    if (!isEffortLevel(value)) throw new Error(`Effort invalido: ${value}. Permitidos: ${ALLOWED_EFFORTS.join(', ')}`);
    return value;
}

function requireStringParam(params: Record<string, unknown>, key: string): string {
    const value = params[key];
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`Parametro obrigatorio invalido: ${key}`);
    return value;
}

function swarmPath(...parts: string[]): string {
    return join(SWARM_DIR, ...parts);
}

function absPath(path: string): string {
    return resolve(process.cwd(), path);
}

function swarmAbsPath(...parts: string[]): string {
    return absPath(swarmPath(...parts));
}

function getTaskDir(taskId: string): string {
    assertValidTaskId(taskId);
    return swarmAbsPath(TASKS_DIR_NAME, taskId);
}

function getTaskSessionFile(taskId: string): string {
    return join(getTaskDir(taskId), 'session.jsonl');
}

function getTaskChatFile(taskId: string): string {
    return join(getTaskDir(taskId), 'chat.jsonl');
}

function getTaskAttachmentsDir(taskId: string): string {
    return join(getTaskDir(taskId), 'attachments');
}

function getTaskArtifactsDir(taskId: string): string {
    return join(getTaskDir(taskId), 'artifacts');
}

function getTaskArtifactsFile(taskId: string): string {
    return join(getTaskDir(taskId), 'artifacts.yaml');
}

function getTaskRunsLogFile(taskId: string): string {
    return join(getTaskDir(taskId), 'logs', 'runs.jsonl');
}

function getTaskErrorsLogFile(taskId: string): string {
    return join(getTaskDir(taskId), 'logs', 'errors.jsonl');
}

function toTaskRelativePath(taskId: string, targetPath: string): string {
    const taskDir = getTaskDir(taskId);
    const absoluteTarget = isAbsolute(targetPath) ? normalize(targetPath) : resolve(taskDir, targetPath);
    assertInsideDir(taskDir, absoluteTarget, false);
    return relative(taskDir, absoluteTarget) || '.';
}

function resolveTaskPath(taskId: string, path: string): string {
    assertSafeRelativePath(path, 'task path');
    const taskDir = getTaskDir(taskId);
    const target = resolve(taskDir, path);
    assertInsideDir(taskDir, target, false);
    assertNoSymlinkPath(taskDir, target);
    return target;
}

function resolveInsideDir(baseDir: string, relativePath: string, label: string): string {
    assertSafeRelativePath(relativePath, label);
    const target = resolve(baseDir, relativePath);
    assertInsideDir(baseDir, target, false);
    assertNoSymlinkPath(baseDir, target);
    return target;
}

function assertValidTaskId(taskId: string) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(taskId)) throw new Error(`task_id invalido: ${taskId}`);
}

function assertSafeRelativePath(path: string, label: string) {
    if (!path || path.trim() === '') throw new Error(`${label} vazio`);
    if (path.includes('\0')) throw new Error(`${label} contem NUL byte`);
    if (isAbsolute(path)) throw new Error(`${label} nao pode ser absoluto: ${path}`);
    const normalized = normalize(path);
    if (normalized === '.' || normalized === '..' || normalized.startsWith(`..${separatorForPath(normalized)}`)) {
        throw new Error(`${label} com path traversal: ${path}`);
    }
}

function separatorForPath(path: string): string {
    return path.includes('\\') ? '\\' : '/';
}

function assertInsideDir(baseDir: string, targetPath: string, allowSame: boolean) {
    const normalizedBase = resolve(baseDir);
    const normalizedTarget = resolve(targetPath);
    const rel = relative(normalizedBase, normalizedTarget);
    if (rel === '') {
        if (!allowSame) throw new Error(`Caminho aponta para o diretorio base: ${targetPath}`);
        return;
    }
    if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`Caminho invalido fora do diretorio permitido: ${targetPath}`);
    }
}

function assertNoSymlinkPath(baseDir: string, targetPath: string) {
    const base = resolve(baseDir);
    const target = resolve(targetPath);
    assertInsideDir(base, target, false);
    const relativeParts = relative(base, target).split(/[\\/]+/).filter(Boolean);
    let current = base;
    for (const part of relativeParts) {
        current = join(current, part);
        if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
            throw new Error(`Symlink nao permitido no caminho: ${current}`);
        }
    }
}

function sanitizeOptionalTaskRelativePath(taskId: string, path: string | undefined): string | undefined {
    if (!path) return undefined;
    try {
        resolveTaskPath(taskId, path);
        return path;
    } catch {
        return undefined;
    }
}

function normalizeSessionFile(taskId: string, sessionFile: string): string {
    const relativeSessionFile = isAbsolute(sessionFile) ? toTaskRelativePath(taskId, sessionFile) : sessionFile;
    resolveTaskPath(taskId, relativeSessionFile);
    return relativeSessionFile;
}

function isModelAlias(value: unknown): value is ModelAlias {
    return typeof value === 'string' && value in ALLOWED_MODELS;
}

function isEffortLevel(value: unknown): value is EffortLevel {
    return typeof value === 'string' && ALLOWED_EFFORTS.includes(value as EffortLevel);
}

function normalizeRuntimeConfig(config?: RuntimeConfig): RuntimeConfig | undefined {
    if (!config) return undefined;
    const normalized: RuntimeConfig = {};
    if (config.model !== undefined) {
        if (!isModelAlias(config.model)) throw new Error(`Modelo alias invalido: ${config.model}`);
        normalized.model = config.model;
    }
    if (config.effort !== undefined) {
        if (!isEffortLevel(config.effort)) throw new Error(`Effort invalido: ${config.effort}`);
        normalized.effort = config.effort;
    }
    return Object.keys(normalized).length ? normalized : undefined;
}

function mergeRuntimeConfig(...configs: (RuntimeConfig | undefined)[]): Required<RuntimeConfig> {
    return configs.reduce<Required<RuntimeConfig>>(
        (merged, config) => ({ ...merged, ...normalizeRuntimeConfig(config) }),
        { ...DEFAULT_RUNTIME_CONFIG }
    );
}

function normalizeTaskOptions(options: TaskOptions): TaskOptions {
    return {
        task_id: options.task_id,
        title: options.title,
        assignedTo: options.assignedTo,
        parentId: options.parentId,
        depth: Number.isFinite(options.depth) ? options.depth : 0,
        runtimeConfig: normalizeRuntimeConfig(options.runtimeConfig)
    };
}

function normalizeTaskMetrics(metrics?: TaskMetrics): TaskMetrics {
    if (!metrics) return createEmptyTaskMetrics();
    return {
        startedAt: metrics.startedAt,
        finishedAt: metrics.finishedAt,
        durationMs: finiteNumber(metrics.durationMs, 0),
        tokens: {
            input: finiteNumber(metrics.tokens?.input, 0),
            output: finiteNumber(metrics.tokens?.output, 0),
            total: finiteNumber(metrics.tokens?.total, 0)
        },
        cost: finiteNumber(metrics.cost, 0)
    };
}

function finiteNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function loadTaskChat(taskId: string, fallback: TaskChatMessage[] = []): TaskChatMessage[] {
    const chatFile = getTaskChatFile(taskId);
    if (!existsSync(chatFile)) return fallback;

    return readFileSync(chatFile, 'utf8')
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line) as TaskChatMessage);
}

function writeTaskChat(task: Task) {
    const chatFile = getTaskChatFile(task.options.task_id);
    const content = task.chat.map(message => JSON.stringify(message)).join('\n');
    writeFileAtomic(chatFile, content ? `${content}\n` : '');
}

function quoteYaml(value: string | undefined): string {
    return value === undefined ? 'null' : JSON.stringify(value);
}

function yamlStringList(key: string, values: string[], indent = 2): string {
    const base = ' '.repeat(indent);
    const item = ' '.repeat(indent + 2);
    if (values.length === 0) return `${base}${key}: []`;
    return [`${base}${key}:`, ...values.map(value => `${item}- ${quoteYaml(value)}`)].join('\n');
}

function yamlBlock(value: string | undefined, indent = 4): string {
    if (!value) return "''";
    const spaces = ' '.repeat(indent);
    return `|-\n${value.split('\n').map(line => `${spaces}${line}`).join('\n')}`;
}

function serializeArtifactsYaml(artifacts: TaskArtifact[]): string {
    if (artifacts.length === 0) return 'artifacts: []\n';
    return [
        'artifacts:',
        ...artifacts.flatMap(artifact => [
            `  - description: ${quoteYaml(artifact.description)}`,
            `    file_type: ${quoteYaml(artifact.file_type)}`,
            `    path: ${quoteYaml(artifact.path)}`,
            `    size_bytes: ${artifact.sizeBytes ?? 0}`
        ])
    ].join('\n') + '\n';
}

function serializeTaskRunsYaml(runs: TaskRun[]): string {
    if (runs.length === 0) return '  runs: []';
    return [
        '  runs:',
        ...runs.flatMap(run => [
            `    - run_id: ${quoteYaml(run.runId)}`,
            `      status: ${quoteYaml(run.status)}`,
            `      created_at: ${quoteYaml(run.createdAt)}`,
            `      started_at: ${quoteYaml(run.startedAt)}`,
            `      completed_at: ${quoteYaml(run.completedAt)}`,
            `      error: ${quoteYaml(run.error)}`,
            '      wait_groups:',
            ...(run.waitGroups.length
                ? run.waitGroups.flatMap(group => [
                    `        - wait_id: ${quoteYaml(group.waitId)}`,
                    `          mode: ${quoteYaml(group.mode)}`,
                    `          status: ${quoteYaml(group.status)}`,
                    yamlStringList('task_ids', group.taskIds, 10),
                    yamlStringList('processed_event_ids', group.processedEventIds, 10)
                ])
                : ['        []']),
            `      result_messages: ${yamlBlock(run.resultMessages.map(message => `${message.role}/${message.type}: ${message.text ?? ''}`).join('\n'), 8)}`
        ])
    ].join('\n');
}

function serializeTaskYaml(task: Task): string {
    const taskId = task.options.task_id;
    return [
        `task_id: ${quoteYaml(taskId)}`,
        `parent_id: ${quoteYaml(task.options.parentId)}`,
        'metadata:',
        `  depth: ${task.options.depth}`,
        `  max_depth: ${MAX_TASK_DEPTH}`,
        `  can_create_subtasks: ${task.options.depth < MAX_TASK_DEPTH && task.subtaskIds.length < MAX_SUBTASKS_PER_TASK}`,
        `  session_file: ${quoteYaml(task.piSessionFile ?? toTaskRelativePath(taskId, getTaskSessionFile(taskId)))}`,
        `  chat_file: ${quoteYaml(toTaskRelativePath(taskId, getTaskChatFile(taskId)))}`,
        `  attachments_dir: ${quoteYaml(toTaskRelativePath(taskId, getTaskAttachmentsDir(taskId)))}`,
        `  artifacts_dir: ${quoteYaml(toTaskRelativePath(taskId, getTaskArtifactsDir(taskId)))}`,
        `  artifacts_file: ${quoteYaml(toTaskRelativePath(taskId, getTaskArtifactsFile(taskId)))}`,
        `  runs_log_file: ${quoteYaml(toTaskRelativePath(taskId, getTaskRunsLogFile(taskId)))}`,
        `  errors_log_file: ${quoteYaml(toTaskRelativePath(taskId, getTaskErrorsLogFile(taskId)))}`,
        'scope:',
        `  title: ${quoteYaml(task.options.title)}`,
        `  assigned_to: ${quoteYaml(task.options.assignedTo)}`,
        'runtime:',
        `  model: ${quoteYaml(task.options.runtimeConfig?.model)}`,
        `  effort: ${quoteYaml(task.options.runtimeConfig?.effort)}`,
        'memory:',
        `  status: ${quoteYaml(task.status)}`,
        `  retry_count: ${task.retryCount}`,
        `  technical_retry_count: ${task.technicalRetryCount}`,
        `  max_retries: ${MAX_TASK_RETRIES}`,
        `  max_technical_retries: ${MAX_TECHNICAL_RETRIES}`,
        '  metrics:',
        `    started_at: ${quoteYaml(task.metrics.startedAt)}`,
        `    finished_at: ${quoteYaml(task.metrics.finishedAt)}`,
        `    duration_ms: ${task.metrics.durationMs}`,
        `    tokens_total: ${task.metrics.tokens.total}`,
        `    tokens_input: ${task.metrics.tokens.input}`,
        `    tokens_output: ${task.metrics.tokens.output}`,
        `    cost: ${task.metrics.cost}`,
        `  active_run_id: ${quoteYaml(task.activeRunId)}`,
        yamlStringList('subtask_ids', task.subtaskIds),
        serializeTaskRunsYaml(task.runs),
        `  result_messages: ${yamlBlock(task.resultMessages.map(message => `${message.role}/${message.type}: ${message.text ?? ''}`).join('\n'))}`
    ].join('\n') + '\n';
}

function ensureTaskArtifacts(task: Task) {
    const taskDir = getTaskDir(task.options.task_id);
    mkdirSync(taskDir, { recursive: true });
    mkdirSync(getTaskAttachmentsDir(task.options.task_id), { recursive: true });
    mkdirSync(getTaskArtifactsDir(task.options.task_id), { recursive: true });
    mkdirSync(dirname(getTaskRunsLogFile(task.options.task_id)), { recursive: true });
    const sessionFile = getTaskSessionFile(task.options.task_id);
    if (!existsSync(sessionFile)) writeFileAtomic(sessionFile, '');
    task.piSessionFile ??= toTaskRelativePath(task.options.task_id, sessionFile);
    writeTaskChat(task);
    writeFileAtomic(join(taskDir, 'task.yml'), serializeTaskYaml(task));
    writeFileAtomic(getTaskArtifactsFile(task.options.task_id), serializeArtifactsYaml(task.artifacts));
}

function copyTaskAttachments(taskId: string, attachmentPaths: string[]): AttachmentRef[] {
    if (attachmentPaths.length === 0) return [];
    const attachmentsDir = getTaskAttachmentsDir(taskId);
    mkdirSync(attachmentsDir, { recursive: true });

    return attachmentPaths.map(sourcePath => {
        if (!existsSync(sourcePath)) throw new Error(`Attachment nao encontrado: ${sourcePath}`);
        const sourceStat = lstatSync(sourcePath);
        if (sourceStat.isSymbolicLink()) throw new Error(`Attachment symlink nao permitido: ${sourcePath}`);
        if (!sourceStat.isFile()) throw new Error(`Attachment precisa ser arquivo: ${sourcePath}`);
        if (sourceStat.size > MAX_ATTACHMENT_BYTES) {
            throw new Error(`Attachment excede limite de ${MAX_ATTACHMENT_BYTES} bytes: ${sourcePath}`);
        }
        const originalName = basename(sourcePath);
        const id = randomUUID();
        const targetPath = resolveInsideDir(attachmentsDir, `${id}-${originalName}`, 'attachment');
        copyFileSync(sourcePath, targetPath);
        return { id, originalName, path: toTaskRelativePath(taskId, targetPath), sizeBytes: sourceStat.size };
    });
}

function createTaskArtifact(task: Task, fileName: string, content: string, description: string, fileType: string): TaskArtifact {
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    if (sizeBytes > MAX_ARTIFACT_BYTES) {
        throw new Error(`Artefato excede limite de ${MAX_ARTIFACT_BYTES} bytes: ${fileName}`);
    }
    const artifactsDir = getTaskArtifactsDir(task.options.task_id);
    const targetPath = resolveInsideDir(artifactsDir, fileName, 'artifact fileName');
    if (existsSync(targetPath)) throw new Error(`Artefato ja existe: ${targetPath}`);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileAtomic(targetPath, content);

    const artifact: TaskArtifact = {
        description,
        file_type: fileType,
        path: toTaskRelativePath(task.options.task_id, targetPath),
        sizeBytes
    };
    task.artifacts.push(artifact);
    task.appendChat('assistant', 'artifact', description, undefined, undefined, [artifact]);
    writeFileAtomic(getTaskArtifactsFile(task.options.task_id), serializeArtifactsYaml(task.artifacts));
    writeTaskChat(task);
    return artifact;
}

function formatChatMessage(message: TaskChatMessage): string {
    const attachments = message.attachments?.length
        ? ` attachments=${message.attachments.map(attachment => attachment.path).join(',')}`
        : '';
    const artifacts = message.artifacts?.length
        ? ` artifacts=${message.artifacts.map(artifact => artifact.path).join(',')}`
        : '';
    const eventId = message.eventId ? ` eventId=${message.eventId}` : '';
    return `- ${message.ts} ${message.role}/${message.type}: ${message.text ?? ''}${attachments}${artifacts}${eventId}`;
}

function formatMessages(messages: TaskChatMessage[]): string {
    return messages.map(message => `${message.role}/${message.type}: ${message.text ?? ''}`).join(' | ');
}

function formatSwarmEvent(event: SwarmEvent): string {
    const parts = [
        `[${event.ts}]`,
        `#${event.seq}`,
        event.type,
        `event=${event.eventId}`
    ];
    if (event.taskId) parts.push(`task=${event.taskId}`);
    if (event.parentId) parts.push(`parent=${event.parentId}`);
    if (event.runId) parts.push(`run=${event.runId}`);
    if (event.waitId) parts.push(`wait=${event.waitId}`);
    if (event.messages?.length) parts.push(`messages="${truncateLogValue(formatMessages(event.messages), 240)}"`);
    if (event.payload && Object.keys(event.payload).length) parts.push(`payload=${truncateLogValue(JSON.stringify(event.payload), 600)}`);
    return parts.join(' ');
}

function formatOrchestratorLog(log: { ts: string; type: string; payload: Record<string, unknown> }): string {
    const payload = Object.keys(log.payload).length ? ` payload=${truncateLogValue(JSON.stringify(log.payload), 600)}` : '';
    return `[${log.ts}] ${log.type}${payload}`;
}

function truncateLogValue(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function createEmptyTaskMetrics(): TaskMetrics {
    return {
        durationMs: 0,
        tokens: { input: 0, output: 0, total: 0 },
        cost: 0
    };
}

function addSessionStats(metrics: TaskMetrics, stats: SessionStats, startedAt: string, finishedAt: string): TaskMetrics {
    return {
        startedAt: metrics.startedAt ?? startedAt,
        finishedAt,
        durationMs: metrics.durationMs + new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
        tokens: {
            input: metrics.tokens.input + finiteNumber(stats.tokens?.input, 0),
            output: metrics.tokens.output + finiteNumber(stats.tokens?.output, 0),
            total: metrics.tokens.total + finiteNumber(stats.tokens?.total, 0)
        },
        cost: metrics.cost + finiteNumber(stats.cost, 0)
    };
}

function formatCost(cost: number): string {
    return `$${cost.toFixed(6)}`;
}

function formatMarkdownTable(headers: string[], rows: string[][]): string {
    return [
        `| ${headers.join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...rows.map(row => `| ${row.join(' | ')} |`)
    ].join('\n');
}

function normalizeAgentMessages(messages: unknown): AgentOutputMessage[] {
    if (!Array.isArray(messages)) return [{ type: 'text', text: '' }];
    const normalized = messages
        .map(message => {
            if (!message || typeof message !== 'object') return undefined;
            const candidate = message as Partial<AgentOutputMessage>;
            if (candidate.type !== 'text' && candidate.type !== 'artifact' && candidate.type !== 'event') return undefined;
            const output: AgentOutputMessage = { type: candidate.type };
            if (typeof candidate.text === 'string') output.text = candidate.text;
            if (Array.isArray(candidate.artifacts)) output.artifacts = candidate.artifacts.filter(isTaskArtifact);
            return output;
        })
        .filter((message): message is AgentOutputMessage => Boolean(message));
    return normalized.length ? normalized : [{ type: 'text', text: '' }];
}

function parseAgentWaitGroups(value: unknown, originalOutput: string): AgentWaitGroup[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new AgentOutputInvalidError('waitGroups precisa ser array', originalOutput);
    return value.map(group => {
        if (!group || typeof group !== 'object') throw new AgentOutputInvalidError('waitGroup invalido', originalOutput);
        const candidate = group as Partial<AgentWaitGroup>;
        if (typeof candidate.waitId !== 'string') throw new AgentOutputInvalidError('waitGroup.waitId invalido', originalOutput);
        if (candidate.mode !== 'WAIT_ALL' && candidate.mode !== 'ON_DEMAND') throw new AgentOutputInvalidError('waitGroup.mode invalido', originalOutput);
        if (!Array.isArray(candidate.taskIds) || !candidate.taskIds.every(taskId => typeof taskId === 'string')) {
            throw new AgentOutputInvalidError('waitGroup.taskIds invalido', originalOutput);
        }
        return { waitId: candidate.waitId, mode: candidate.mode, taskIds: candidate.taskIds };
    });
}

function isTaskArtifact(value: unknown): value is TaskArtifact {
    if (!value || typeof value !== 'object') return false;
    const artifact = value as TaskArtifact;
    return typeof artifact.description === 'string' && typeof artifact.file_type === 'string' && typeof artifact.path === 'string';
}

function isSerializedTask(value: unknown): value is SerializedTask {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as SerializedTask;
    return Boolean(candidate.options && typeof candidate.options.task_id === 'string' && typeof candidate.options.title === 'string');
}

function isTerminalTaskStatus(status: TaskStatus): boolean {
    return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

function isTerminalTaskEvent(type: SwarmEventType): boolean {
    return type === 'TASK_COMPLETED' || type === 'TASK_FAILED' || type === 'TASK_CANCELLED';
}

function terminalEventVerb(type: SwarmEventType): string {
    if (type === 'TASK_COMPLETED') return 'concluida';
    if (type === 'TASK_FAILED') return 'falhou';
    if (type === 'TASK_CANCELLED') return 'cancelada';
    return type.toLowerCase();
}

function stripJsonFence(value: string): string {
    const trimmed = value.trim();
    const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function sanitizeWaitId(waitId: string): string {
    const sanitized = waitId.trim();
    if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(sanitized)) {
        throw new AgentOutputInvalidError(`waitId invalido: ${waitId}`, waitId);
    }
    return sanitized;
}

function mergeWaitGroups(existing: WaitGroup[], next: WaitGroup[]): WaitGroup[] {
    const byWaitId = new Map<string, WaitGroup>();
    for (const group of existing) byWaitId.set(group.waitId, group);
    for (const group of next) {
        const current = byWaitId.get(group.waitId);
        if (!current) {
            byWaitId.set(group.waitId, group);
            continue;
        }
        current.mode = group.mode;
        current.taskIds = uniqueStrings([...current.taskIds, ...group.taskIds]);
        current.status = 'WAITING';
    }
    return [...byWaitId.values()];
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values.filter(value => typeof value === 'string' && value.trim().length > 0))];
}

function writeFileAtomic(filePath: string, content: string | Buffer) {
    mkdirSync(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(tempPath, content);
    renameSync(tempPath, filePath);
}

function copyFileAtomic(sourcePath: string, targetPath: string) {
    mkdirSync(dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
    copyFileSync(sourcePath, tempPath);
    renameSync(tempPath, targetPath);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new RunTimeoutError(timeoutMs)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeout) clearTimeout(timeout);
    });
}

function readPositiveIntegerEnv(key: string, fallback: number): number {
    const value = process.env[key];
    if (!value) return fallback;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readPositiveNumberEnv(key: string, fallback: number): number {
    const value = process.env[key];
    if (!value) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function main() {
    let activeOrquestrator: Orquestrator | undefined;
    const shutdown = () => {
        activeOrquestrator?.shutdown();
        process.exitCode = 130;
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    const { requestedTask, simulateRestart, runtimeConfig, attachmentPaths } = parseCliArgs(process.argv.slice(2));
    const effectiveRootConfig = mergeRuntimeConfig(createAgents().find(agent => agent.name === 'Manager')?.runtimeConfig, runtimeConfig);
    const rootModel = ALLOWED_MODELS[effectiveRootConfig.model];

    console.log('================== START SWARM POC =================');
    console.log(`Modelo Pi root: ${rootModel.provider}/${rootModel.modelId} (${effectiveRootConfig.effort})`);
    console.log(`State: ${STATE_FILE}`);
    console.log(`Events: ${EVENTS_FILE}`);

    const result = simulateRestart
        ? await runRestartSimulation(requestedTask, runtimeConfig, attachmentPaths)
        : await runNormal(requestedTask, runtimeConfig, attachmentPaths);
    const { mainTask, orquestrator } = result;
    activeOrquestrator = orquestrator;

    console.log('\n================== SWARM FINISHED =================');
    console.log('Status Final da Task Principal:', mainTask.status);
    console.log('Sessao Pi da Task Principal:', mainTask.piSessionFile);
    console.log('Mensagens Finais:', formatMessages(mainTask.resultMessages));
    orquestrator.printExecutionReport();
}

main().catch(error => {
    console.error('Erro fatal no Swarm POC:', error);
    process.exitCode = 1;
});
