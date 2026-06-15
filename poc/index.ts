import { EventEmitter } from 'events';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import {
    AuthStorage,
    createAgentSession,
    DefaultResourceLoader,
    defineTool,
    getAgentDir,
    ModelRegistry,
    SessionManager,
    SettingsManager,
    type ExtensionAPI
} from '@earendil-works/pi-coding-agent';

type TaskStatus = 'PENDING' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED';
type SubtaskMode = 'WAIT_ALL' | 'ON_DEMAND';
type TaskEventType = 'TASK_COMPLETED';
type ModelAlias = 'fast' | 'balanced' | 'deep';
type EffortLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type TaskChatRole = 'system' | 'user' | 'assistant' | 'event';

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
const AVAILABLE_TOOLS = ['read', 'grep', 'find', 'ls', 'create_subtask'];
const STATE_FILE = join(process.cwd(), '.swarm-state.json');
const TASKS_DIR = join(process.cwd(), 'tasks');
const MAX_TASK_DEPTH = 4;
const MAX_TASK_RETRIES = 2;

interface RuntimeConfig {
    model?: ModelAlias;
    effort?: EffortLevel;
}

interface TaskChatMessage {
    ts: string;
    role: TaskChatRole;
    text: string;
    runtimeConfig?: RuntimeConfig;
}

interface TaskOptions {
    task_id: string;
    name: string;
    description: string;
    assignedTo: string;
    parentId?: string;
    subtaskMode?: SubtaskMode;
    runtimeConfig?: RuntimeConfig;
}

interface SerializedTask {
    options: TaskOptions;
    status: TaskStatus;
    subtaskIds: string[];
    result?: string;
    waitingForTaskIds: string[];
    processedEventIds: string[];
    piSessionFile?: string;
    chat?: TaskChatMessage[];
    retryCount?: number;
}

interface TaskEvent {
    event_id: string;
    type: TaskEventType;
    taskId: string;
    parentId?: string;
    result?: string;
    processedByTaskIds: string[];
    createdAt: string;
}

interface SwarmState {
    tasks: SerializedTask[];
    events: TaskEvent[];
}

interface TaskMetadata {
    task_id: string;
    name: string;
    description: string;
    assignedTo: string;
    parentId?: string;
    status: TaskStatus;
    depth: number;
    maxDepth: number;
    canCreateSubtasks: boolean;
    taskDir: string;
    sessionFile: string;
    runtimeConfig: Required<RuntimeConfig>;
    allowedModels: Record<ModelAlias, { provider: string; modelId: string; description: string }>;
    allowedEfforts: EffortLevel[];
    retryCount: number;
    maxRetries: number;
    taskChat: TaskChatMessage[];
}

interface AgentDecision {
    status: 'completed' | 'waiting' | 'retry';
    result: string;
    waitMode?: SubtaskMode;
    waitingForTaskIds?: string[];
    instructions?: string;
    model?: ModelAlias;
    effort?: EffortLevel;
}

class Task {
    options: TaskOptions;
    status: TaskStatus = 'PENDING';
    subtaskIds: string[] = [];
    result?: string;
    waitingForTaskIds: string[] = [];
    processedEventIds = new Set<string>();
    piSessionFile?: string;
    chat: TaskChatMessage[] = [];
    retryCount = 0;

    constructor(options: TaskOptions) {
        this.options = options;
        this.appendChat('user', `${options.name}\n\n${options.description}`, options.runtimeConfig);
    }

    static fromSerialized(serialized: SerializedTask): Task {
        const task = new Task(serialized.options);
        task.status = serialized.status;
        task.subtaskIds = serialized.subtaskIds;
        task.result = serialized.result;
        task.waitingForTaskIds = serialized.waitingForTaskIds;
        task.processedEventIds = new Set(serialized.processedEventIds);
        task.piSessionFile = serialized.piSessionFile;
        task.chat = serialized.chat ?? [];
        task.retryCount = serialized.retryCount ?? 0;
        return task;
    }

    appendChat(role: TaskChatRole, text: string, runtimeConfig?: RuntimeConfig) {
        this.chat.push({ ts: new Date().toISOString(), role, text, runtimeConfig });
    }

    serialize(): SerializedTask {
        return {
            options: this.options,
            status: this.status,
            subtaskIds: this.subtaskIds,
            result: this.result,
            waitingForTaskIds: this.waitingForTaskIds,
            processedEventIds: [...this.processedEventIds],
            piSessionFile: this.piSessionFile,
            chat: this.chat,
            retryCount: this.retryCount
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
    private filePath: string;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    reset() {
        if (existsSync(this.filePath)) rmSync(this.filePath);
    }

    load(): SwarmState | undefined {
        if (!existsSync(this.filePath)) return undefined;
        return JSON.parse(readFileSync(this.filePath, 'utf8')) as SwarmState;
    }

    save(tasks: Map<string, Task>, events: TaskEvent[]) {
        mkdirSync(dirname(this.filePath), { recursive: true });
        const state: SwarmState = {
            tasks: [...tasks.values()].map(task => task.serialize()),
            events
        };
        writeFileSync(this.filePath, JSON.stringify(state, null, 2));
    }
}

function getTaskDir(taskId: string): string {
    return join(TASKS_DIR, taskId);
}

function getTaskSessionFile(taskId: string): string {
    return join(getTaskDir(taskId), 'session.jsonl');
}

function getTaskDepth(taskId: string): number {
    return Math.max(0, taskId.split('-').length - 2);
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

function quoteYaml(value: string | undefined): string {
    return value === undefined ? 'null' : JSON.stringify(value);
}

function yamlStringList(key: string, values: string[]): string {
    if (values.length === 0) return `  ${key}: []`;
    return [`  ${key}:`, ...values.map(value => `    - ${quoteYaml(value)}`)].join('\n');
}

function yamlBlock(value: string | undefined): string {
    if (!value) return "''";
    return `|-\n${value.split('\n').map(line => `    ${line}`).join('\n')}`;
}

function serializeTaskYaml(task: Task): string {
    return [
        `task_id: ${quoteYaml(task.options.task_id)}`,
        `parent_id: ${quoteYaml(task.options.parentId)}`,
        'metadata:',
        `  depth: ${getTaskDepth(task.options.task_id)}`,
        `  max_depth: ${MAX_TASK_DEPTH}`,
        `  can_create_subtasks: ${getTaskDepth(task.options.task_id) < MAX_TASK_DEPTH}`,
        `  task_dir: ${quoteYaml(getTaskDir(task.options.task_id))}`,
        `  session_file: ${quoteYaml(task.piSessionFile ?? getTaskSessionFile(task.options.task_id))}`,
        'scope:',
        `  name: ${quoteYaml(task.options.name)}`,
        `  description: ${yamlBlock(task.options.description)}`,
        `  assigned_to: ${quoteYaml(task.options.assignedTo)}`,
        'runtime:',
        `  model: ${quoteYaml(task.options.runtimeConfig?.model)}`,
        `  effort: ${quoteYaml(task.options.runtimeConfig?.effort)}`,
        'memory:',
        `  status: ${quoteYaml(task.status)}`,
        `  retry_count: ${task.retryCount}`,
        `  max_retries: ${MAX_TASK_RETRIES}`,
        `  subtask_mode: ${quoteYaml(task.options.subtaskMode)}`,
        yamlStringList('subtask_ids', task.subtaskIds),
        yamlStringList('waiting_for_task_ids', task.waitingForTaskIds),
        yamlStringList('processed_event_ids', [...task.processedEventIds]),
        `  session_file: ${quoteYaml(task.piSessionFile)}`,
        `  result: ${yamlBlock(task.result)}`,
        `  chat: ${yamlBlock(JSON.stringify(task.chat, null, 2))}`
    ].join('\n') + '\n';
}

function ensureTaskArtifacts(task: Task) {
    const taskDir = getTaskDir(task.options.task_id);
    const sessionFile = getTaskSessionFile(task.options.task_id);
    mkdirSync(taskDir, { recursive: true });
    if (!existsSync(sessionFile)) writeFileSync(sessionFile, '');
    task.piSessionFile ??= sessionFile;
    writeFileSync(join(taskDir, 'task.yml'), serializeTaskYaml(task));
}

class PiAgentClient {
    private cwd = process.cwd();
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

    async run(agent: Agent, task: Task, orquestrator: Orquestrator, triggerEvents: TaskEvent[] = []): Promise<string> {
        const runtimeConfig = orquestrator.resolveRuntimeConfig(task, agent);
        const model = this.resolveModel(runtimeConfig);
        const resourceLoader = this.createResourceLoader(agent, task, orquestrator);
        await resourceLoader.reload();
        ensureTaskArtifacts(task);

        const sessionManager = SessionManager.open(task.piSessionFile ?? getTaskSessionFile(task.options.task_id));

        const { session } = await createAgentSession({
            cwd: this.cwd,
            model,
            thinkingLevel: runtimeConfig.effort,
            authStorage: this.authStorage,
            modelRegistry: this.modelRegistry,
            resourceLoader,
            tools: AVAILABLE_TOOLS,
            sessionManager,
            settingsManager: this.settingsManager
        });

        task.piSessionFile = session.sessionFile;
        orquestrator.persist();

        let output = '';
        try {
            session.subscribe((event) => {
                if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
                    output += event.assistantMessageEvent.delta;
                }
            });

            await session.prompt(this.buildPrompt(task, orquestrator, triggerEvents));
            return output.trim();
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

    private createResourceLoader(agent: Agent, task: Task, orquestrator: Orquestrator): DefaultResourceLoader {
        return new DefaultResourceLoader({
            cwd: this.cwd,
            agentDir: getAgentDir(),
            settingsManager: this.settingsManager,
            noExtensions: true,
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true,
            systemPrompt: `${agent.system_prompt}
${orquestrator.buildTaskMetadataBlock(task)}

Voce decide se resolve diretamente ou se cria subtasks pela tool create_subtask.
Use create_subtask apenas quando a tarefa realmente precisar de delegacao.
Nunca crie subtasks quando task_metadata.canCreateSubtasks for false.
Voce pode escolher model/effort para subtasks usando apenas os aliases e efforts permitidos em task_metadata.
Se a propria task nao atingiu o objetivo, retorne status retry com novas instrucoes e opcionalmente model/effort.
Depois de criar subtasks, retorne JSON aguardando as task_ids criadas.
Se ja houver subtasks listadas para o mesmo pedido, nao crie outra; use os resultados existentes.
Para WAIT_ALL, aguarde todas antes de processar. Para ON_DEMAND, processe cada conclusao quando ela chegar.
Responda sempre somente JSON no formato:
{"status":"completed","result":"resultado final"}
ou
{"status":"waiting","waitMode":"WAIT_ALL|ON_DEMAND","waitingForTaskIds":["id"],"result":"motivo curto"}
ou
{"status":"retry","instructions":"novas instrucoes objetivas","model":"fast|balanced|deep","effort":"off|minimal|low|medium|high|xhigh","result":"motivo curto"}
Quando status for completed, result deve conter apenas a resposta final ao usuario, sem explicar o workflow.`,
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
                                name: { type: 'string', description: 'Nome curto da subtask' },
                                description: { type: 'string', description: 'Descricao objetiva da subtask' },
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
                            required: ['assignedTo', 'name', 'description'],
                            additionalProperties: false
                        },
                        async execute(_toolCallId, params: Record<string, unknown>) {
                            const assignedTo = requireStringParam(params, 'assignedTo');
                            const name = requireStringParam(params, 'name');
                            const description = requireStringParam(params, 'description');
                            const runtimeConfig = normalizeRuntimeConfig({
                                model: params.model === undefined ? undefined : parseModelAlias(String(params.model)),
                                effort: params.effort === undefined ? undefined : parseEffortLevel(String(params.effort))
                            });
                            const existingSubtask = orquestrator.getSubtasks(task).find(subtask =>
                                subtask.options.assignedTo === assignedTo &&
                                subtask.options.name === name &&
                                subtask.options.description === description &&
                                JSON.stringify(subtask.options.runtimeConfig ?? {}) === JSON.stringify(runtimeConfig ?? {})
                            );

                            const subtask = existingSubtask ?? orquestrator.spawnSubtask(
                                task,
                                assignedTo,
                                name,
                                description,
                                runtimeConfig
                            );

                            return {
                                content: [{ type: 'text', text: JSON.stringify(orquestrator.toMetadata(subtask)) }],
                                details: orquestrator.toMetadata(subtask)
                            };
                        }
                    }));
                }
            ]
        });
    }

    private buildPrompt(task: Task, orquestrator: Orquestrator, triggerEvents: TaskEvent[]): string {
        for (const event of triggerEvents) {
            task.appendChat('event', `task ${event.taskId} concluida: ${event.result ?? ''}`);
        }

        const subtaskResults = orquestrator.getSubtasks(task)
            .map(subtask => `- ${subtask.options.task_id} ${subtask.options.name} (${subtask.options.assignedTo}) [${subtask.status}]: ${subtask.result ?? 'sem resultado'}`)
            .join('\n');
        const eventSummary = triggerEvents.length
            ? triggerEvents.map(event => `- ${event.event_id}: task ${event.taskId} concluida com resultado: ${event.result ?? ''}`).join('\n')
            : 'inicio ou retomada sem novo evento.';

        return [
            `Tarefa: ${task.options.name}`,
            `Descrição: ${task.options.description}`,
            `Eventos recebidos:\n${eventSummary}`,
            subtaskResults ? `Subtasks:\n${subtaskResults}` : 'Sem subtasks.',
            `Task chat:\n${task.chat.map(message => `- ${message.ts} ${message.role}: ${message.text}`).join('\n')}`,
            task.piSessionFile ? `Sessao Pi persistida: ${task.piSessionFile}` : 'Sem sessao Pi persistida.',
            'Continue a partir do historico anterior da sessao, decida o proximo passo e retorne somente o JSON estruturado.'
        ].join('\n\n');
    }
}

class Orquestrator extends EventEmitter {
    agents: Map<string, Agent> = new Map();
    tasks: Map<string, Task> = new Map();
    events: TaskEvent[] = [];
    rootTaskIds: string[] = [];
    pi = new PiAgentClient();
    private runningTaskIds = new Set<string>();
    private store = new SwarmStateStore(STATE_FILE);
    private options: { resetState?: boolean; stopWhenWaiting?: boolean };

    constructor(agents: Agent[], options: { resetState?: boolean; stopWhenWaiting?: boolean } = {}) {
        super();
        this.options = options;
        for (const agent of agents) this.agents.set(agent.name, agent);
        if (options.resetState) {
            this.store.reset();
            if (existsSync(TASKS_DIR)) rmSync(TASKS_DIR, { recursive: true, force: true });
        }
        this.loadState();
    }

    addTask(name: string, description: string, agentName: string, runtimeConfig?: RuntimeConfig): Task {
        const task = new Task({
            task_id: this.createTaskId(),
            name,
            description,
            assignedTo: agentName,
            runtimeConfig: normalizeRuntimeConfig(runtimeConfig)
        });
        this.tasks.set(task.options.task_id, task);
        this.rootTaskIds.push(task.options.task_id);
        this.persist();
        this.scheduleTask(task.options.task_id);
        return task;
    }

    spawnSubtask(parentTask: Task, agentName: string, name: string, description: string, runtimeConfig?: RuntimeConfig): Task {
        if (!this.agents.has(agentName)) throw new Error(`Agente ${agentName} não encontrado`);
        if (getTaskDepth(parentTask.options.task_id) >= MAX_TASK_DEPTH) {
            throw new Error(`Depth maximo ${MAX_TASK_DEPTH} atingido para task ${parentTask.options.task_id}`);
        }

        const subtask = new Task({
            task_id: this.createSubtaskId(parentTask),
            name,
            description,
            assignedTo: agentName,
            parentId: parentTask.options.task_id,
            runtimeConfig: normalizeRuntimeConfig(runtimeConfig)
        });

        parentTask.subtaskIds.push(subtask.options.task_id);
        this.tasks.set(subtask.options.task_id, subtask);
        this.persist();
        console.log(`   ↳ [SUBTASK CRIADA] "${name}" designada para [${agentName}]`);
        this.scheduleTask(subtask.options.task_id);
        return subtask;
    }

    scheduleReadyTasks() {
        if (this.options.stopWhenWaiting) return;

        for (const task of this.tasks.values()) {
            if (task.status !== 'WAITING') continue;
            const triggerEvents = this.getReadyEvents(task);
            if (triggerEvents.length > 0) this.scheduleTask(task.options.task_id, triggerEvents);
        }
    }

    scheduleTask(taskId: string, triggerEvents: TaskEvent[] = []) {
        setImmediate(() => {
            this.runTask(taskId, triggerEvents).catch(err => {
                const task = this.tasks.get(taskId);
                if (task) task.status = 'FAILED';
                this.persist();
                console.error(`Erro ao executar tarefa ${taskId}:`, err);
                this.emit('state:changed');
            });
        });
    }

    async runTask(taskId: string, triggerEvents: TaskEvent[] = []) {
        const task = this.tasks.get(taskId);
        if (!task || task.status === 'COMPLETED' || task.status === 'FAILED') return;
        if (this.runningTaskIds.has(taskId)) return;

        const agent = this.agents.get(task.options.assignedTo);
        if (!agent) throw new Error(`Agente ${task.options.assignedTo} não encontrado`);

        this.runningTaskIds.add(taskId);
        task.status = 'RUNNING';
        this.persist();
        console.log(`\n🧡 [${agent.name}] Processando: "${task.options.name}" (Status: RUNNING)`);

        try {
            const output = await this.pi.run(agent, task, this, triggerEvents);
            const decision = this.parseDecision(output);

            if (decision.status === 'retry') {
                if (task.retryCount >= MAX_TASK_RETRIES) {
                    task.result = decision.result || `Retry maximo atingido: ${decision.instructions ?? ''}`;
                    task.status = 'FAILED';
                    this.markEventsProcessed(task, triggerEvents);
                    this.persist();
                    console.log(`[${agent.name}] Falhou apos ${task.retryCount} retries: "${task.options.name}"`);
                    return;
                }

                const runtimeConfig = normalizeRuntimeConfig({ model: decision.model, effort: decision.effort });
                task.retryCount += 1;
                task.status = 'PENDING';
                task.result = decision.result;
                task.options.runtimeConfig = { ...(task.options.runtimeConfig ?? {}), ...(runtimeConfig ?? {}) };
                task.appendChat('assistant', decision.result || 'retry solicitado');
                task.appendChat('user', decision.instructions ?? 'Reexecute a task com a configuracao atualizada.', runtimeConfig);
                this.markEventsProcessed(task, triggerEvents);
                this.persist();
                console.log(`[${agent.name}] Retry ${task.retryCount}/${MAX_TASK_RETRIES}: "${task.options.name}"`);
                this.scheduleTask(task.options.task_id);
                return;
            }

            if (decision.status === 'waiting') {
                task.options.subtaskMode = decision.waitMode ?? 'WAIT_ALL';
                task.waitingForTaskIds = decision.waitingForTaskIds?.length
                    ? decision.waitingForTaskIds
                    : this.getSubtasks(task).filter(st => st.status !== 'COMPLETED').map(st => st.options.task_id);
                task.result = decision.result;
                task.appendChat('assistant', decision.result);
                task.status = 'WAITING';
                this.markEventsProcessed(task, triggerEvents);
                this.persist();
                console.log(`[${agent.name}] Suspenso em ${task.options.subtaskMode}: ${task.waitingForTaskIds.join(', ')}`);
                return;
            }

            task.result = decision.result;
            task.appendChat('assistant', decision.result);
            task.status = 'COMPLETED';
            this.markEventsProcessed(task, triggerEvents);
            this.recordCompletionEvent(task);
            this.persist();
            console.log(`✅ [${agent.name}] Concluiu: "${task.options.name}" (Status: COMPLETED)`);
        } finally {
            this.runningTaskIds.delete(taskId);
            this.emit('state:changed');
            this.scheduleReadyTasks();
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

    resolveRuntimeConfig(task: Task, agent?: Agent): Required<RuntimeConfig> {
        return mergeRuntimeConfig(agent?.runtimeConfig, task.options.runtimeConfig);
    }

    toMetadata(task: Task): TaskMetadata {
        const agent = this.agents.get(task.options.assignedTo);
        return {
            task_id: task.options.task_id,
            name: task.options.name,
            description: task.options.description,
            assignedTo: task.options.assignedTo,
            parentId: task.options.parentId,
            status: task.status,
            depth: getTaskDepth(task.options.task_id),
            maxDepth: MAX_TASK_DEPTH,
            canCreateSubtasks: getTaskDepth(task.options.task_id) < MAX_TASK_DEPTH,
            taskDir: getTaskDir(task.options.task_id),
            sessionFile: task.piSessionFile ?? getTaskSessionFile(task.options.task_id),
            runtimeConfig: this.resolveRuntimeConfig(task, agent),
            allowedModels: ALLOWED_MODELS,
            allowedEfforts: ALLOWED_EFFORTS,
            retryCount: task.retryCount,
            maxRetries: MAX_TASK_RETRIES,
            taskChat: task.chat
        };
    }

    buildTaskMetadataBlock(task: Task): string {
        return [
            '<task_metadata>',
            JSON.stringify(this.toMetadata(task), null, 2),
            '</task_metadata>'
        ].join('\n');
    }

    persist() {
        for (const task of this.tasks.values()) ensureTaskArtifacts(task);
        this.store.save(this.tasks, this.events);
    }

    async waitUntilSettled(rootTask: Task) {
        return new Promise<void>((resolve) => {
            const check = () => {
                if (rootTask.status === 'COMPLETED' || rootTask.status === 'FAILED') return resolve();
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

    private loadState() {
        const state = this.store.load();
        if (!state) return;

        for (const serializedTask of state.tasks) {
            const task = Task.fromSerialized(serializedTask);
            if (task.status === 'RUNNING') task.status = 'WAITING';
            this.tasks.set(task.options.task_id, task);
            if (!task.options.parentId) this.rootTaskIds.push(task.options.task_id);
        }
        this.events = state.events;
    }

    private getReadyEvents(task: Task): TaskEvent[] {
        const completionEvents = this.events.filter(event =>
            event.type === 'TASK_COMPLETED' &&
            task.waitingForTaskIds.includes(event.taskId) &&
            !event.processedByTaskIds.includes(task.options.task_id)
        );

        if (task.options.subtaskMode === 'ON_DEMAND') return completionEvents.slice(0, 1);

        const allCompleted = task.waitingForTaskIds.every(taskId => this.tasks.get(taskId)?.status === 'COMPLETED');
        return allCompleted ? completionEvents : [];
    }

    private markEventsProcessed(task: Task, triggerEvents: TaskEvent[]) {
        for (const event of triggerEvents) {
            task.processedEventIds.add(event.event_id);
            if (!event.processedByTaskIds.includes(task.options.task_id)) {
                event.processedByTaskIds.push(task.options.task_id);
            }
        }
    }

    private recordCompletionEvent(task: Task) {
        if (this.events.some(event => event.taskId === task.options.task_id && event.type === 'TASK_COMPLETED')) return;

        const event: TaskEvent = {
            event_id: this.createId(),
            type: 'TASK_COMPLETED',
            taskId: task.options.task_id,
            parentId: task.options.parentId,
            result: task.result,
            processedByTaskIds: [],
            createdAt: new Date().toISOString()
        };
        this.events.push(event);
        if (task.options.parentId) console.log(`[EVENT] task:completed ${task.options.task_id} -> parent ${task.options.parentId}`);
    }

    private isQuiescent(): boolean {
        return this.runningTaskIds.size === 0 && [...this.tasks.values()].every(task => task.status !== 'PENDING' && task.status !== 'RUNNING');
    }

    private createTaskId(): string {
        const timestampNs = (BigInt(Date.now()) * 1_000_000n) + (process.hrtime.bigint() % 1_000_000n);
        return `t-${timestampNs.toString(36)}${this.randomAlphaNumeric(2)}`;
    }

    private createSubtaskId(parentTask: Task): string {
        return `${parentTask.options.task_id}-${this.randomAlphaNumeric(2)}`;
    }

    private randomAlphaNumeric(length: number): string {
        let value = '';
        for (let i = 0; i < length; i++) value += Math.floor(Math.random() * 36).toString(36);
        return value;
    }

    private parseDecision(output: string): AgentDecision {
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { status: 'completed', result: output };

        try {
            const parsed = JSON.parse(jsonMatch[0]) as Partial<AgentDecision>;
            if (parsed.status === 'retry') {
                if (parsed.model !== undefined && !isModelAlias(parsed.model)) throw new Error(`Modelo alias invalido: ${parsed.model}`);
                if (parsed.effort !== undefined && !isEffortLevel(parsed.effort)) throw new Error(`Effort invalido: ${parsed.effort}`);
                return {
                    status: 'retry',
                    result: parsed.result ?? '',
                    instructions: parsed.instructions ?? '',
                    model: isModelAlias(parsed.model) ? parsed.model : undefined,
                    effort: isEffortLevel(parsed.effort) ? parsed.effort : undefined
                };
            }
            if (parsed.status === 'waiting') {
                return {
                    status: 'waiting',
                    result: parsed.result ?? '',
                    waitMode: parsed.waitMode === 'ON_DEMAND' ? 'ON_DEMAND' : 'WAIT_ALL',
                    waitingForTaskIds: parsed.waitingForTaskIds ?? []
                };
            }
            return { status: 'completed', result: parsed.result ?? output };
        } catch {
            return { status: 'completed', result: output };
        }
    }

    private createId(): string {
        return Math.random().toString(36).substring(2, 9);
    }
}

function createAgents(): Agent[] {
    return [
        new Agent('Manager', 'Você é o Gerente de projetos Senior focado em orquestração macro. Siga as ins', { model: 'balanced', effort: 'high' }),
        new Agent('Produto', 'Você é o Product Owner Senior, focado em regras de negócio e requisitos.', { model: 'balanced', effort: 'low' }),
        new Agent('Engineer', 'Você é o Principal Engenheiro de Software, focado em arquitetura e código.', { model: 'deep', effort: 'medium' }),
        new Agent('Generic', 'Você é um executor de tarefas gerais de apoio.', { model: 'fast', effort: 'off' })
    ];
}

async function runNormal(requestedTask: string, runtimeConfig?: RuntimeConfig) {
    const orquestrator = new Orquestrator(createAgents(), { resetState: true });
    const mainTask = orquestrator.addTask(requestedTask, requestedTask, 'Manager', runtimeConfig);
    await orquestrator.waitUntilSettled(mainTask);
    return mainTask;
}

async function runRestartSimulation(requestedTask: string, runtimeConfig?: RuntimeConfig) {
    console.log('[SIM] Fase 1: executando ate suspender e persistir estado.');
    const firstRun = new Orquestrator(createAgents(), { resetState: true, stopWhenWaiting: true });
    const firstTask = firstRun.addTask(requestedTask, requestedTask, 'Manager', runtimeConfig);
    await firstRun.waitUntilSettled(firstTask);
    console.log(`[SIM] Crash simulado. Estado persistido em ${STATE_FILE}`);

    console.log('[SIM] Fase 2: novo orquestrador carregando estado persistido.');
    const secondRun = new Orquestrator(createAgents());
    const resumedTask = secondRun.getRootTask();
    if (!resumedTask) throw new Error('Nenhuma root task persistida para retomar');
    secondRun.scheduleReadyTasks();
    await secondRun.waitUntilSettled(resumedTask);
    return resumedTask;
}

function parseCliArgs(args: string[]): { requestedTask: string; simulateRestart: boolean; runtimeConfig?: RuntimeConfig } {
    const taskParts: string[] = [];
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
        taskParts.push(arg);
    }

    return {
        requestedTask: taskParts.join(' ') || 'execute em subtasks diferentes no agent genérico. como se fala "oi" em japones, coreano, frances e ingles',
        simulateRestart,
        runtimeConfig: normalizeRuntimeConfig(runtimeConfig)
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

async function main() {
    const { requestedTask, simulateRestart, runtimeConfig } = parseCliArgs(process.argv.slice(2));
    const effectiveRootConfig = mergeRuntimeConfig(createAgents().find(agent => agent.name === 'Manager')?.runtimeConfig, runtimeConfig);
    const rootModel = ALLOWED_MODELS[effectiveRootConfig.model];

    console.log('================== START SWARM POC =================');
    console.log(`Modelo Pi root: ${rootModel.provider}/${rootModel.modelId} (${effectiveRootConfig.effort})`);
    console.log(`State: ${STATE_FILE}`);

    const mainTask = simulateRestart
        ? await runRestartSimulation(requestedTask, runtimeConfig)
        : await runNormal(requestedTask, runtimeConfig);

    console.log('\n================== SWARM FINISHED =================');
    console.log('Status Final da Task Principal:', mainTask.status);
    console.log('Sessao Pi da Task Principal:', mainTask.piSessionFile);
    console.log('Resultado Final:', mainTask.result);
}

main();
