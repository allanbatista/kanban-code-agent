import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { basename, dirname, join, normalize, relative } from 'path';
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
type WaitGroupMode = 'WAIT_ALL' | 'ON_DEMAND';
type WaitGroupStatus = 'WAITING' | 'PROCESSED';
type TaskRunStatus = 'WAITING' | 'COMPLETED';
type TaskEventType = 'TASK_COMPLETED';
type ModelAlias = 'fast' | 'balanced' | 'deep';
type EffortLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type TaskChatRole = 'system' | 'user' | 'assistant' | 'event';
type TaskMessageType = 'text' | 'artifact' | 'event';

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
const STATE_FILE = '.swarm-state.json';
const TASKS_DIR = 'tasks';
const MAX_TASK_DEPTH = 4;
const MAX_TASK_RETRIES = 2;
const PI_HEARTBEAT_MS = 5000;

interface RuntimeConfig {
    model?: ModelAlias;
    effort?: EffortLevel;
}

interface AttachmentRef {
    id: string;
    originalName: string;
    path: string;
}

interface TaskArtifact {
    description: string;
    file_type: string;
    path: string;
}

interface TaskChatMessage {
    ts: string;
    role: TaskChatRole;
    type: TaskMessageType;
    text?: string;
    attachments?: AttachmentRef[];
    artifacts?: TaskArtifact[];
    runtimeConfig?: RuntimeConfig;
}

interface TaskOptions {
    task_id: string;
    title: string;
    assignedTo: string;
    parentId?: string;
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
    completedAt?: string;
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
}

interface TaskEvent {
    event_id: string;
    type: TaskEventType;
    taskId: string;
    parentId?: string;
    runId?: string;
    waitId?: string;
    messages?: TaskChatMessage[];
    processedByTaskIds: string[];
    createdAt: string;
}

interface SwarmState {
    tasks: SerializedTask[];
    events: TaskEvent[];
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
    runtimeConfig: Required<RuntimeConfig>;
    allowedModels: Record<ModelAlias, { provider: string; modelId: string; description: string }>;
    allowedEfforts: EffortLevel[];
    retryCount: number;
    maxRetries: number;
    activeRunId?: string;
    runs: TaskRun[];
    taskChat: TaskChatMessage[];
    artifacts: TaskArtifact[];
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

    constructor(options: TaskOptions, seedInitialMessage = true, attachments: AttachmentRef[] = []) {
        this.options = options;
        if (seedInitialMessage) this.appendChat('user', 'text', options.title, options.runtimeConfig, attachments);
    }

    static fromSerialized(serialized: SerializedTask): Task {
        const task = new Task(serialized.options, false);
        task.status = serialized.status;
        task.subtaskIds = serialized.subtaskIds;
        task.resultMessages = serialized.resultMessages ?? [];
        task.activeRunId = serialized.activeRunId;
        task.runs = serialized.runs ?? [];
        task.piSessionFile = serialized.piSessionFile;
        task.chat = loadTaskChat(serialized.options.task_id, serialized.chat);
        task.artifacts = serialized.artifacts ?? [];
        task.retryCount = serialized.retryCount ?? 0;
        return task;
    }

    appendChat(role: TaskChatRole, type: TaskMessageType, text?: string, runtimeConfig?: RuntimeConfig, attachments?: AttachmentRef[], artifacts?: TaskArtifact[]): TaskChatMessage {
        const message: TaskChatMessage = { ts: new Date().toISOString(), role, type };
        if (text !== undefined) message.text = text;
        if (runtimeConfig !== undefined) message.runtimeConfig = runtimeConfig;
        if (attachments?.length) message.attachments = attachments;
        if (artifacts?.length) message.artifacts = artifacts;
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

function toTaskRelativePath(taskId: string, path: string): string {
    return relative(getTaskDir(taskId), path) || '.';
}

function resolveTaskPath(taskId: string, path: string): string {
    return normalize(join(getTaskDir(taskId), path));
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
    writeFileSync(chatFile, content ? `${content}\n` : '');
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
            `    path: ${quoteYaml(artifact.path)}`
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
            `      completed_at: ${quoteYaml(run.completedAt)}`,
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
        `  depth: ${getTaskDepth(taskId)}`,
        `  max_depth: ${MAX_TASK_DEPTH}`,
        `  can_create_subtasks: ${getTaskDepth(taskId) < MAX_TASK_DEPTH}`,
        `  session_file: ${quoteYaml(task.piSessionFile ?? toTaskRelativePath(taskId, getTaskSessionFile(taskId)))}`,
        `  chat_file: ${quoteYaml(toTaskRelativePath(taskId, getTaskChatFile(taskId)))}`,
        `  attachments_dir: ${quoteYaml(toTaskRelativePath(taskId, getTaskAttachmentsDir(taskId)))}`,
        `  artifacts_dir: ${quoteYaml(toTaskRelativePath(taskId, getTaskArtifactsDir(taskId)))}`,
        `  artifacts_file: ${quoteYaml(toTaskRelativePath(taskId, getTaskArtifactsFile(taskId)))}`,
        'scope:',
        `  title: ${quoteYaml(task.options.title)}`,
        `  assigned_to: ${quoteYaml(task.options.assignedTo)}`,
        'runtime:',
        `  model: ${quoteYaml(task.options.runtimeConfig?.model)}`,
        `  effort: ${quoteYaml(task.options.runtimeConfig?.effort)}`,
        'memory:',
        `  status: ${quoteYaml(task.status)}`,
        `  retry_count: ${task.retryCount}`,
        `  max_retries: ${MAX_TASK_RETRIES}`,
        `  active_run_id: ${quoteYaml(task.activeRunId)}`,
        yamlStringList('subtask_ids', task.subtaskIds),
        serializeTaskRunsYaml(task.runs),
        `  result_messages: ${yamlBlock(task.resultMessages.map(message => `${message.role}/${message.type}: ${message.text ?? ''}`).join('\n'))}`
    ].join('\n') + '\n';
}

function ensureTaskArtifacts(task: Task) {
    const taskDir = getTaskDir(task.options.task_id);
    const sessionFile = getTaskSessionFile(task.options.task_id);
    mkdirSync(taskDir, { recursive: true });
    mkdirSync(getTaskAttachmentsDir(task.options.task_id), { recursive: true });
    mkdirSync(getTaskArtifactsDir(task.options.task_id), { recursive: true });
    if (!existsSync(sessionFile)) writeFileSync(sessionFile, '');
    task.piSessionFile ??= toTaskRelativePath(task.options.task_id, sessionFile);
    writeTaskChat(task);
    writeFileSync(join(taskDir, 'task.yml'), serializeTaskYaml(task));
    writeFileSync(getTaskArtifactsFile(task.options.task_id), serializeArtifactsYaml(task.artifacts));
}

function copyTaskAttachments(taskId: string, attachmentPaths: string[]): AttachmentRef[] {
    if (attachmentPaths.length === 0) return [];
    const attachmentsDir = getTaskAttachmentsDir(taskId);
    mkdirSync(attachmentsDir, { recursive: true });

    return attachmentPaths.map(sourcePath => {
        if (!existsSync(sourcePath)) throw new Error(`Attachment nao encontrado: ${sourcePath}`);
        const originalName = basename(sourcePath);
        const id = randomUUID();
        const path = join(attachmentsDir, `${id}-${originalName}`);
        copyFileSync(sourcePath, path);
        return { id, originalName, path: toTaskRelativePath(taskId, path) };
    });
}

function assertInsideDir(baseDir: string, targetPath: string) {
    const normalizedBase = normalize(baseDir);
    const normalizedTarget = normalize(targetPath);
    const rel = relative(normalizedBase, normalizedTarget);
    if (rel.startsWith('..') || rel === '' || rel.includes(`..${'/'}`) || rel.includes(`..\\`)) {
        throw new Error(`Caminho invalido fora do diretorio permitido: ${targetPath}`);
    }
}

function createTaskArtifact(task: Task, fileName: string, content: string, description: string, fileType: string): TaskArtifact {
    const artifactsDir = getTaskArtifactsDir(task.options.task_id);
    const path = join(artifactsDir, fileName);
    assertInsideDir(artifactsDir, path);
    if (existsSync(path)) throw new Error(`Artefato ja existe: ${path}`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);

    const artifact: TaskArtifact = { description, file_type: fileType, path: toTaskRelativePath(task.options.task_id, path) };
    task.artifacts.push(artifact);
    task.appendChat('assistant', 'artifact', description, undefined, undefined, [artifact]);
    writeFileSync(getTaskArtifactsFile(task.options.task_id), serializeArtifactsYaml(task.artifacts));
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
    return `- ${message.ts} ${message.role}/${message.type}: ${message.text ?? ''}${attachments}${artifacts}`;
}

function formatMessages(messages: TaskChatMessage[]): string {
    return messages.map(message => `${message.role}/${message.type}: ${message.text ?? ''}`).join(' | ');
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function indentText(text: string, spaces = 4): string {
    const indent = ' '.repeat(spaces);
    return text.split('\n').map(line => `${indent}${line}`).join('\n');
}

function formatLogText(text: string): string {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text;
    try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
        return text;
    }
}

function logTaskMessages(label: string, messages: TaskChatMessage[], agentName?: string) {
    console.log(label);
    if (messages.length === 0) {
        console.log('    (sem mensagens)');
        return;
    }
    for (const message of messages) {
        const agent = agentName ? ` agent=${agentName}` : '';
        console.log(`    - ${message.role}/${message.type}${agent} @ ${message.ts}`);
        if (message.text) console.log(indentText(formatLogText(message.text), 8));
        if (message.artifacts?.length) console.log(indentText(`artifacts=${message.artifacts.map(artifact => artifact.path).join(',')}`, 8));
        if (message.attachments?.length) console.log(indentText(`attachments=${message.attachments.map(attachment => attachment.path).join(',')}`, 8));
    }
}

function previewJson(value: unknown): string {
    const text = JSON.stringify(value);
    return text.length > 240 ? `${text.slice(0, 240)}...` : text;
}

function printStreamedOutput(output: string) {
    const formatted = formatLogText(output);
    if (formatted === output) return;
    console.log('\n[PI] resposta JSON formatada:');
    console.log(indentText(formatted, 4));
}

function normalizeAgentMessages(messages: unknown): AgentOutputMessage[] {
    if (!Array.isArray(messages)) return [];
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

function isTaskArtifact(value: unknown): value is TaskArtifact {
    if (!value || typeof value !== 'object') return false;
    const artifact = value as TaskArtifact;
    return typeof artifact.description === 'string' && typeof artifact.file_type === 'string' && typeof artifact.path === 'string';
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
        const startedAt = Date.now();
        const resourceLoader = this.createResourceLoader(agent, task, orquestrator);
        await resourceLoader.reload();
        ensureTaskArtifacts(task);
        console.log(`[PI] start task=${task.options.task_id} agent=${agent.name} model=${ALLOWED_MODELS[runtimeConfig.model].provider}/${ALLOWED_MODELS[runtimeConfig.model].modelId} effort=${runtimeConfig.effort}`);

        const sessionManager = SessionManager.open(resolveTaskPath(
            task.options.task_id,
            task.piSessionFile ?? toTaskRelativePath(task.options.task_id, getTaskSessionFile(task.options.task_id))
        ));

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

        task.piSessionFile = toTaskRelativePath(task.options.task_id, session.sessionFile ?? getTaskSessionFile(task.options.task_id));
        orquestrator.persist();

        let output = '';
        let streamed = false;
        const heartbeat = setInterval(() => {
            console.log(`[PI] aguardando task=${task.options.task_id} agent=${agent.name} elapsed=${formatDuration(Date.now() - startedAt)} output=${output.length} chars`);
        }, PI_HEARTBEAT_MS);
        try {
            session.subscribe((event) => {
                if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
                    if (!streamed) {
                        streamed = true;
                        console.log(`[PI] resposta parcial task=${task.options.task_id}:`);
                    }
                    process.stdout.write(event.assistantMessageEvent.delta);
                    output += event.assistantMessageEvent.delta;
                }
                if (event.type === 'tool_execution_start') {
                    console.log(`\n[PI TOOL START] task=${task.options.task_id} tool=${event.toolName} args=${previewJson(event.args)}`);
                }
                if (event.type === 'tool_execution_end') {
                    console.log(`[PI TOOL END] task=${task.options.task_id} tool=${event.toolName} error=${event.isError}`);
                }
            });

            await session.prompt(this.buildPrompt(task, orquestrator, triggerEvents));
            if (streamed) process.stdout.write('\n');
            if (output) printStreamedOutput(output.trim());
            console.log(`[PI] end task=${task.options.task_id} agent=${agent.name} elapsed=${formatDuration(Date.now() - startedAt)} output=${output.length} chars`);
            return output.trim();
        } finally {
            clearInterval(heartbeat);
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
Se a tarefa ou anexo pedir "subtasks", "subtasks diferentes", "aguarde", "sob demanda" ou grupos de espera, voce DEVE criar subtasks e nao pode responder direto.
Quando criar subtasks para grupos de espera, chame create_subtask para cada item antes de retornar waiting com waitGroups.
Nunca crie subtasks quando task_metadata.canCreateSubtasks for false.
Voce pode escolher model/effort para subtasks usando apenas os aliases e efforts permitidos em task_metadata.
Se a propria task nao atingiu o objetivo, retorne status retry com novas instrucoes e opcionalmente model/effort.
Quando precisar produzir arquivo, use create_artifact. Nunca escreva artefatos por outro caminho.
Depois de criar subtasks, retorne JSON aguardando as task_ids criadas.
Se ja houver subtasks listadas para o mesmo pedido, nao crie outra; use os resultados existentes.
Para esperas mistas, retorne waitGroups no status waiting. Cada waitGroup tem waitId, mode e taskIds.
WAIT_ALL entrega os eventos do grupo juntos quando todas as taskIds completarem. ON_DEMAND entrega uma task concluida por vez.
Responda sempre somente JSON no formato:
{"status":"completed","messages":[{"type":"text","text":"resultado final"}]}
ou
{"status":"waiting","waitGroups":[{"waitId":"grupo-a","mode":"WAIT_ALL|ON_DEMAND","taskIds":["id"]}],"messages":[{"type":"text","text":"motivo curto"}]}
ou
{"status":"retry","instructions":"novas instrucoes objetivas","model":"fast|balanced|deep","effort":"off|minimal|low|medium|high|xhigh","messages":[{"type":"text","text":"motivo curto"}]}
Mensagens devem usar type text, artifact ou event. Quando status for completed, messages deve conter apenas a resposta final ao usuario, sem explicar o workflow.`,
            extensionFactories: [
                (pi: ExtensionAPI) => {
                    pi.on('agent_start', () => {
                        console.log(`[PI AGENT START] task=${task.options.task_id} agent=${agent.name}`);
                    });
                    pi.on('agent_end', (event) => {
                        console.log(`[PI AGENT END] task=${task.options.task_id} agent=${agent.name} messages=${event.messages.length}`);
                    });
                    pi.on('tool_call', (event) => {
                        console.log(`[PI TOOL CALL] task=${task.options.task_id} tool=${event.toolName} input=${previewJson(event.input)}`);
                    });
                    pi.on('tool_result', (event) => {
                        console.log(`[PI TOOL RESULT] task=${task.options.task_id} tool=${event.toolName} error=${event.isError}`);
                    });
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
                        async execute(_toolCallId, params: Record<string, unknown>) {
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
                        async execute(_toolCallId, params: Record<string, unknown>) {
                            const artifact = createTaskArtifact(
                                task,
                                requireStringParam(params, 'fileName'),
                                requireStringParam(params, 'content'),
                                requireStringParam(params, 'description'),
                                requireStringParam(params, 'file_type')
                            );
                            orquestrator.persist();
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

    private buildPrompt(task: Task, orquestrator: Orquestrator, triggerEvents: TaskEvent[]): string {
        for (const event of triggerEvents) {
            task.appendChat('event', 'event', `task ${event.taskId} concluida`, undefined, undefined, event.messages?.flatMap(message => message.artifacts ?? []));
        }

        const subtaskResults = orquestrator.getSubtasks(task)
            .map(subtask => `- ${subtask.options.task_id} ${subtask.options.title} (${subtask.options.assignedTo}) [${subtask.status}]: ${formatMessages(subtask.resultMessages) || 'sem mensagens'}`)
            .join('\n');
        const eventSummary = triggerEvents.length
            ? triggerEvents.map(event => `- ${event.event_id}: run ${event.runId ?? '-'} wait ${event.waitId ?? '-'} task ${event.taskId} concluida com mensagens: ${formatMessages(event.messages ?? [])}`).join('\n')
            : 'inicio ou retomada sem novo evento.';
        const runSummary = task.runs.length
            ? task.runs.map(run => `- ${run.runId} [${run.status}]: ${run.waitGroups.map(group => `${group.waitId}/${group.mode}/${group.status} tasks=${group.taskIds.join(',')} processed=${group.processedEventIds.join(',')}`).join(' ; ')}`).join('\n')
            : 'Sem runs.';

        return [
            `Tarefa: ${task.options.title}`,
            `Eventos recebidos:\n${eventSummary}`,
            subtaskResults ? `Subtasks:\n${subtaskResults}` : 'Sem subtasks.',
            `Runs:\n${runSummary}`,
            `Task chat:\n${task.chat.map(formatChatMessage).join('\n')}`,
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
    private taskStartedAtMs = new Map<string, number>();
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

    addTask(title: string, agentName: string, runtimeConfig?: RuntimeConfig, attachmentPaths: string[] = []): Task {
        const taskId = this.createTaskId();
        const attachments = copyTaskAttachments(taskId, attachmentPaths);
        const task = new Task({
            task_id: taskId,
            title,
            assignedTo: agentName,
            runtimeConfig: normalizeRuntimeConfig(runtimeConfig)
        }, true, attachments);
        this.tasks.set(task.options.task_id, task);
        this.rootTaskIds.push(task.options.task_id);
        this.persist();
        this.scheduleTask(task.options.task_id);
        return task;
    }

    spawnSubtask(parentTask: Task, agentName: string, title: string, message: string, runtimeConfig?: RuntimeConfig): Task {
        if (!this.agents.has(agentName)) throw new Error(`Agente ${agentName} não encontrado`);
        if (getTaskDepth(parentTask.options.task_id) >= MAX_TASK_DEPTH) {
            throw new Error(`Depth maximo ${MAX_TASK_DEPTH} atingido para task ${parentTask.options.task_id}`);
        }

        const subtask = new Task({
            task_id: this.createSubtaskId(parentTask),
            title,
            assignedTo: agentName,
            parentId: parentTask.options.task_id,
            runtimeConfig: normalizeRuntimeConfig(runtimeConfig)
        }, true);
        subtask.chat[0].text = message;

        parentTask.subtaskIds.push(subtask.options.task_id);
        this.tasks.set(subtask.options.task_id, subtask);
        this.persist();
        console.log(`   ↳ [SUBTASK CRIADA] ${subtask.options.task_id} parent=${parentTask.options.task_id} group=pendente mode=pendente agent=${agentName}`);
        console.log(indentText(title, 6));
        this.scheduleTask(subtask.options.task_id);
        return subtask;
    }

    scheduleReadyTasks() {
        if (this.options.stopWhenWaiting) return;

        for (const task of this.tasks.values()) {
            if (task.status !== 'WAITING') continue;
            const triggerEvents = this.getReadyEvents(task);
            if (triggerEvents.length > 0) {
                console.log(`[READY] ${task.options.task_id} recebeu ${triggerEvents.length} evento(s) pronto(s): ${triggerEvents.map(event => `${event.taskId}@${event.waitId ?? '-'}`).join(', ')}`);
                this.scheduleTask(task.options.task_id, triggerEvents);
            }
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
        this.taskStartedAtMs.set(taskId, Date.now());
        task.status = 'RUNNING';
        this.persist();
        console.log(`\n[${agent.name}] Processando: ${task.options.task_id} "${task.options.title}" (Status: RUNNING)`);
        this.logTriggerEvents(task, triggerEvents);

        try {
            const output = await this.pi.run(agent, task, this, triggerEvents);
            const decision = this.parseDecision(output);

            if (decision.status === 'retry') {
                if (task.retryCount >= MAX_TASK_RETRIES) {
                    task.resultMessages = task.appendAgentMessages(decision.messages.length ? decision.messages : [{ type: 'text', text: `Retry maximo atingido: ${decision.instructions ?? ''}` }]);
                    task.status = 'FAILED';
                    this.markEventsProcessed(task, triggerEvents);
                    this.persist();
                    console.log(`[${agent.name}] Falhou apos ${task.retryCount} retries: ${task.options.task_id} (${this.getTaskDuration(taskId)})`);
                    logTaskMessages(`[${agent.name}] Mensagens finais de falha`, task.resultMessages, agent.name);
                    return;
                }

                const runtimeConfig = normalizeRuntimeConfig({ model: decision.model, effort: decision.effort });
                task.retryCount += 1;
                task.status = 'PENDING';
                task.options.runtimeConfig = { ...(task.options.runtimeConfig ?? {}), ...(runtimeConfig ?? {}) };
                task.resultMessages = task.appendAgentMessages(decision.messages);
                task.appendChat('user', 'text', decision.instructions ?? 'Reexecute a task com a configuracao atualizada.', runtimeConfig);
                this.markEventsProcessed(task, triggerEvents);
                this.persist();
                console.log(`[${agent.name}] Retry ${task.retryCount}/${MAX_TASK_RETRIES}: ${task.options.task_id} (${this.getTaskDuration(taskId)})`);
                logTaskMessages(`[${agent.name}] Mensagens do retry`, task.resultMessages, agent.name);
                this.scheduleTask(task.options.task_id);
                return;
            }

            if (decision.status === 'waiting') {
                this.markEventsProcessed(task, triggerEvents);
                task.resultMessages = task.appendAgentMessages(decision.messages);
                const activeRun = this.getActiveRun(task);
                if (activeRun?.waitGroups.some(group => group.status === 'WAITING')) {
                    activeRun.resultMessages = task.resultMessages;
                } else {
                    this.startRun(task, this.normalizeWaitGroups(task, decision), task.resultMessages);
                }
                task.status = 'WAITING';
                this.persist();
                console.log(`[${agent.name}] Suspenso: ${task.options.task_id} (${this.getTaskDuration(taskId)}) waitGroups=${this.getActiveRun(task)?.waitGroups.map(group => `${group.waitId}/${group.mode}`).join(', ')}`);
                logTaskMessages(`[${agent.name}] Mensagens ao suspender`, task.resultMessages, agent.name);
                return;
            }

            task.resultMessages = task.appendAgentMessages(decision.messages);
            task.status = 'COMPLETED';
            this.markEventsProcessed(task, triggerEvents);
            this.completeActiveRun(task);
            this.recordCompletionEvent(task);
            this.persist();
            console.log(`[${agent.name}] Concluiu: ${task.options.task_id} (Status: COMPLETED, duracao=${this.getTaskDuration(taskId)})`);
            logTaskMessages(`[${agent.name}] Mensagens finais`, task.resultMessages, agent.name);
        } finally {
            this.runningTaskIds.delete(taskId);
            this.taskStartedAtMs.delete(taskId);
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
            title: task.options.title,
            assignedTo: task.options.assignedTo,
            parentId: task.options.parentId,
            status: task.status,
            depth: getTaskDepth(task.options.task_id),
            maxDepth: MAX_TASK_DEPTH,
            canCreateSubtasks: getTaskDepth(task.options.task_id) < MAX_TASK_DEPTH,
            sessionFile: task.piSessionFile ?? toTaskRelativePath(task.options.task_id, getTaskSessionFile(task.options.task_id)),
            chatFile: toTaskRelativePath(task.options.task_id, getTaskChatFile(task.options.task_id)),
            runtimeConfig: this.resolveRuntimeConfig(task, agent),
            allowedModels: ALLOWED_MODELS,
            allowedEfforts: ALLOWED_EFFORTS,
            retryCount: task.retryCount,
            maxRetries: MAX_TASK_RETRIES,
            activeRunId: task.activeRunId,
            runs: task.runs,
            taskChat: task.chat,
            artifacts: task.artifacts
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

    private getTaskDuration(taskId: string): string {
        const startedAt = this.taskStartedAtMs.get(taskId);
        return startedAt ? formatDuration(Date.now() - startedAt) : 'duracao indisponivel';
    }

    private logTriggerEvents(task: Task, triggerEvents: TaskEvent[]) {
        if (triggerEvents.length === 0) return;
        console.log(`[EVENTOS RECEBIDOS] ${task.options.task_id}`);
        for (const event of triggerEvents) {
            const run = task.runs.find(candidate => candidate.runId === event.runId);
            const group = run?.waitGroups.find(candidate => candidate.waitId === event.waitId);
            console.log(`    - event=${event.event_id} run=${event.runId ?? '-'} group=${event.waitId ?? '-'} mode=${group?.mode ?? '-'} task=${event.taskId}`);
            logTaskMessages('      mensagens do evento', event.messages ?? [], this.tasks.get(event.taskId)?.options.assignedTo);
        }
    }

    private getActiveRun(task: Task): TaskRun | undefined {
        return task.activeRunId ? task.runs.find(run => run.runId === task.activeRunId) : undefined;
    }

    private startRun(task: Task, waitGroups: AgentWaitGroup[], resultMessages: TaskChatMessage[]) {
        const run: TaskRun = {
            runId: this.createId(),
            status: 'WAITING',
            waitGroups: waitGroups.map(group => ({
                waitId: group.waitId,
                mode: group.mode,
                taskIds: group.taskIds,
                processedEventIds: [],
                status: 'WAITING'
            })),
            resultMessages,
            createdAt: new Date().toISOString()
        };
        task.activeRunId = run.runId;
        task.runs.push(run);
        console.log(`[RUN CRIADO] task=${task.options.task_id} run=${run.runId}`);
        for (const group of run.waitGroups) {
            console.log(`    [GRUPO] wait=${group.waitId} mode=${group.mode} status=${group.status}`);
            for (const taskId of group.taskIds) {
                const subtask = this.tasks.get(taskId);
                console.log(`        - subtask=${taskId} title=${quoteYaml(subtask?.options.title)} agent=${subtask?.options.assignedTo ?? '-'} group=${group.waitId} mode=${group.mode}`);
            }
        }
    }

    private completeActiveRun(task: Task) {
        const run = this.getActiveRun(task);
        if (!run) return;
        run.status = 'COMPLETED';
        run.completedAt = new Date().toISOString();
        for (const group of run.waitGroups) group.status = 'PROCESSED';
        task.activeRunId = undefined;
    }

    private normalizeWaitGroups(task: Task, decision: AgentDecision): AgentWaitGroup[] {
        const waitGroups = decision.waitGroups?.filter(group =>
            group.waitId &&
            (group.mode === 'WAIT_ALL' || group.mode === 'ON_DEMAND') &&
            group.taskIds.length > 0
        );
        if (waitGroups?.length) return waitGroups;

        const taskIds = decision.waitingForTaskIds?.length
            ? decision.waitingForTaskIds
            : this.getSubtasks(task).filter(subtask => subtask.status !== 'COMPLETED').map(subtask => subtask.options.task_id);
        return [{ waitId: 'default', mode: decision.waitMode ?? 'WAIT_ALL', taskIds }];
    }

    private getReadyEvents(task: Task): TaskEvent[] {
        const run = this.getActiveRun(task);
        if (!run || run.status !== 'WAITING') return [];

        for (const group of run.waitGroups) {
            if (group.status === 'PROCESSED') continue;
            const completionEvents = this.events
                .filter(event =>
                    event.type === 'TASK_COMPLETED' &&
                    group.taskIds.includes(event.taskId) &&
                    !event.processedByTaskIds.includes(task.options.task_id) &&
                    !group.processedEventIds.includes(event.event_id)
                )
                .map(event => ({ ...event, runId: run.runId, waitId: group.waitId }));

            if (group.mode === 'ON_DEMAND' && completionEvents.length > 0) return [completionEvents[0]];

            const allCompleted = group.taskIds.every(taskId => this.tasks.get(taskId)?.status === 'COMPLETED');
            if (group.mode === 'WAIT_ALL' && allCompleted) return completionEvents;
        }

        return [];
    }

    private markEventsProcessed(task: Task, triggerEvents: TaskEvent[]) {
        const run = this.getActiveRun(task);
        for (const event of triggerEvents) {
            const group = run?.waitGroups.find(candidate => candidate.waitId === event.waitId);
            if (group && !group.processedEventIds.includes(event.event_id)) {
                group.processedEventIds.push(event.event_id);
                const completedTaskIds = new Set(this.events
                    .filter(candidate => group.taskIds.includes(candidate.taskId) && group.processedEventIds.includes(candidate.event_id))
                    .map(candidate => candidate.taskId));
                if (group.taskIds.every(taskId => completedTaskIds.has(taskId))) group.status = 'PROCESSED';
            }
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
            messages: task.resultMessages,
            processedByTaskIds: [],
            createdAt: new Date().toISOString()
        };
        this.events.push(event);
        if (task.options.parentId) {
            console.log(`[EVENT] task:completed ${task.options.task_id} -> parent ${task.options.parentId}`);
            logTaskMessages(`[EVENT] Mensagens publicadas por ${task.options.task_id}`, task.resultMessages, task.options.assignedTo);
        }
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
        if (!jsonMatch) return { status: 'completed', messages: [{ type: 'text', text: output }] };

        try {
            const parsed = JSON.parse(jsonMatch[0]) as Partial<AgentDecision>;
            if (parsed.status === 'retry') {
                if (parsed.model !== undefined && !isModelAlias(parsed.model)) throw new Error(`Modelo alias invalido: ${parsed.model}`);
                if (parsed.effort !== undefined && !isEffortLevel(parsed.effort)) throw new Error(`Effort invalido: ${parsed.effort}`);
                return {
                    status: 'retry',
                    messages: normalizeAgentMessages(parsed.messages),
                    instructions: parsed.instructions ?? '',
                    model: isModelAlias(parsed.model) ? parsed.model : undefined,
                    effort: isEffortLevel(parsed.effort) ? parsed.effort : undefined
                };
            }
            if (parsed.status === 'waiting') {
                const waitGroups = Array.isArray(parsed.waitGroups)
                    ? parsed.waitGroups
                        .map(group => {
                            if (!group || typeof group !== 'object') return undefined;
                            const candidate = group as Partial<AgentWaitGroup>;
                            if (typeof candidate.waitId !== 'string' || candidate.waitId.trim() === '') return undefined;
                            if (candidate.mode !== 'WAIT_ALL' && candidate.mode !== 'ON_DEMAND') return undefined;
                            if (!Array.isArray(candidate.taskIds) || !candidate.taskIds.every(taskId => typeof taskId === 'string')) return undefined;
                            return { waitId: candidate.waitId, mode: candidate.mode, taskIds: candidate.taskIds };
                        })
                        .filter((group): group is AgentWaitGroup => Boolean(group))
                    : undefined;
                return {
                    status: 'waiting',
                    messages: normalizeAgentMessages(parsed.messages),
                    waitMode: parsed.waitMode === 'ON_DEMAND' ? 'ON_DEMAND' : 'WAIT_ALL',
                    waitingForTaskIds: parsed.waitingForTaskIds ?? [],
                    waitGroups
                };
            }
            return { status: 'completed', messages: normalizeAgentMessages(parsed.messages) };
        } catch {
            return { status: 'completed', messages: [{ type: 'text', text: output }] };
        }
    }

    private createId(): string {
        return Math.random().toString(36).substring(2, 9);
    }
}

function createAgents(): Agent[] {
    return [
        new Agent('Manager', 'Você é o Gerente de projetos Senior focado em orquestração macro. Siga as ins', { model: 'fast', effort: 'minimal' }),
        new Agent('Produto', 'Você é o Product Owner Senior, focado em regras de negócio e requisitos.', { model: 'fast', effort: 'low' }),
        new Agent('Engineer', 'Você é o Principal Engenheiro de Software, focado em arquitetura e código.', { model: 'fast', effort: 'medium' }),
        new Agent('Generic', 'Você é um executor de tarefas gerais de apoio.', { model: 'fast', effort: 'off' })
    ];
}

async function runNormal(requestedTask: string, runtimeConfig?: RuntimeConfig, attachmentPaths: string[] = []) {
    const orquestrator = new Orquestrator(createAgents(), { resetState: true });
    const mainTask = orquestrator.addTask(requestedTask, 'Manager', runtimeConfig, attachmentPaths);
    await orquestrator.waitUntilSettled(mainTask);
    return mainTask;
}

async function runRestartSimulation(requestedTask: string, runtimeConfig?: RuntimeConfig, attachmentPaths: string[] = []) {
    console.log('[SIM] Fase 1: executando ate suspender e persistir estado.');
    const firstRun = new Orquestrator(createAgents(), { resetState: true, stopWhenWaiting: true });
    const firstTask = firstRun.addTask(requestedTask, 'Manager', runtimeConfig, attachmentPaths);
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

async function main() {
    const { requestedTask, simulateRestart, runtimeConfig, attachmentPaths } = parseCliArgs(process.argv.slice(2));
    const effectiveRootConfig = mergeRuntimeConfig(createAgents().find(agent => agent.name === 'Manager')?.runtimeConfig, runtimeConfig);
    const rootModel = ALLOWED_MODELS[effectiveRootConfig.model];

    console.log('================== START SWARM POC =================');
    console.log(`Modelo Pi root: ${rootModel.provider}/${rootModel.modelId} (${effectiveRootConfig.effort})`);
    console.log(`State: ${STATE_FILE}`);

    const mainTask = simulateRestart
        ? await runRestartSimulation(requestedTask, runtimeConfig, attachmentPaths)
        : await runNormal(requestedTask, runtimeConfig, attachmentPaths);

    console.log('\n================== SWARM FINISHED =================');
    console.log('Status Final da Task Principal:', mainTask.status);
    console.log('Sessao Pi da Task Principal:', mainTask.piSessionFile);
    console.log('Mensagens Finais:', formatMessages(mainTask.resultMessages));
}

main();
