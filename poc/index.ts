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

const MODEL_PROVIDER = 'openrouter';
const MODEL_ID = 'openai/gpt-5.4-nano';
const THINKING_LEVEL = 'medium' as const;
const AVAILABLE_TOOLS = ['read', 'grep', 'find', 'ls', 'create_subtask'];
const STATE_FILE = join(process.cwd(), '.swarm-state.json');

interface TaskOptions {
    task_id: string;
    name: string;
    description: string;
    assignedTo: string;
    parentId?: string;
    subtaskMode?: SubtaskMode;
}

interface SerializedTask {
    options: TaskOptions;
    status: TaskStatus;
    subtaskIds: string[];
    result?: string;
    waitingForTaskIds: string[];
    processedEventIds: string[];
    piSessionFile?: string;
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
}

interface AgentDecision {
    status: 'completed' | 'waiting';
    result: string;
    waitMode?: SubtaskMode;
    waitingForTaskIds?: string[];
}

class Task {
    options: TaskOptions;
    status: TaskStatus = 'PENDING';
    subtaskIds: string[] = [];
    result?: string;
    waitingForTaskIds: string[] = [];
    processedEventIds = new Set<string>();
    piSessionFile?: string;

    constructor(options: TaskOptions) {
        this.options = options;
    }

    static fromSerialized(serialized: SerializedTask): Task {
        const task = new Task(serialized.options);
        task.status = serialized.status;
        task.subtaskIds = serialized.subtaskIds;
        task.result = serialized.result;
        task.waitingForTaskIds = serialized.waitingForTaskIds;
        task.processedEventIds = new Set(serialized.processedEventIds);
        task.piSessionFile = serialized.piSessionFile;
        return task;
    }

    serialize(): SerializedTask {
        return {
            options: this.options,
            status: this.status,
            subtaskIds: this.subtaskIds,
            result: this.result,
            waitingForTaskIds: this.waitingForTaskIds,
            processedEventIds: [...this.processedEventIds],
            piSessionFile: this.piSessionFile
        };
    }
}

class Agent {
    name: string;
    system_prompt: string;

    constructor(name: string, system_prompt: string) {
        this.name = name;
        this.system_prompt = system_prompt;
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

class PiAgentClient {
    private cwd = process.cwd();
    private authStorage = AuthStorage.inMemory();
    private modelRegistry = ModelRegistry.inMemory(this.authStorage);
    private settingsManager = SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: true, maxRetries: 1 }
    });
    private model = this.modelRegistry.find(MODEL_PROVIDER, MODEL_ID);

    constructor() {
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) throw new Error('OPENROUTER_API_KEY não configurada');

        this.authStorage.setRuntimeApiKey(MODEL_PROVIDER, apiKey);
        if (!this.model) throw new Error(`Modelo ${MODEL_PROVIDER}/${MODEL_ID} não encontrado no Pi SDK`);
    }

    async run(agent: Agent, task: Task, orquestrator: Orquestrator, triggerEvents: TaskEvent[] = []): Promise<string> {
        const resourceLoader = this.createResourceLoader(agent, task, orquestrator);
        await resourceLoader.reload();

        const sessionManager = task.piSessionFile
            ? SessionManager.open(task.piSessionFile)
            : SessionManager.create(this.cwd);

        const { session } = await createAgentSession({
            cwd: this.cwd,
            model: this.model,
            thinkingLevel: THINKING_LEVEL,
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
Voce decide se resolve diretamente ou se cria subtasks pela tool create_subtask.
Use create_subtask apenas quando a tarefa realmente precisar de delegacao.
Depois de criar subtasks, retorne JSON aguardando as task_ids criadas.
Se ja houver subtasks listadas para o mesmo pedido, nao crie outra; use os resultados existentes.
Para WAIT_ALL, aguarde todas antes de processar. Para ON_DEMAND, processe cada conclusao quando ela chegar.
Responda sempre somente JSON no formato:
{"status":"completed","result":"resultado final"}
ou
{"status":"waiting","waitMode":"WAIT_ALL|ON_DEMAND","waitingForTaskIds":["id"],"result":"motivo curto"}
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
                                description: { type: 'string', description: 'Descricao objetiva da subtask' }
                            },
                            required: ['assignedTo', 'name', 'description'],
                            additionalProperties: false
                        },
                        async execute(_toolCallId, params: { assignedTo: string; name: string; description: string }) {
                            const existingSubtask = orquestrator.getSubtasks(task).find(subtask =>
                                subtask.options.assignedTo === params.assignedTo &&
                                subtask.options.name === params.name &&
                                subtask.options.description === params.description
                            );

                            const subtask = existingSubtask ?? orquestrator.spawnSubtask(
                                task,
                                params.assignedTo,
                                params.name,
                                params.description
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
        if (options.resetState) this.store.reset();
        this.loadState();
    }

    addTask(name: string, description: string, agentName: string): Task {
        const task = new Task({
            task_id: this.createId(),
            name,
            description,
            assignedTo: agentName
        });
        this.tasks.set(task.options.task_id, task);
        this.rootTaskIds.push(task.options.task_id);
        this.persist();
        this.scheduleTask(task.options.task_id);
        return task;
    }

    spawnSubtask(parentTask: Task, agentName: string, name: string, description: string): Task {
        if (!this.agents.has(agentName)) throw new Error(`Agente ${agentName} não encontrado`);

        const subtask = new Task({
            task_id: this.createId(),
            name,
            description,
            assignedTo: agentName,
            parentId: parentTask.options.task_id
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

            if (decision.status === 'waiting') {
                task.options.subtaskMode = decision.waitMode ?? 'WAIT_ALL';
                task.waitingForTaskIds = decision.waitingForTaskIds?.length
                    ? decision.waitingForTaskIds
                    : this.getSubtasks(task).filter(st => st.status !== 'COMPLETED').map(st => st.options.task_id);
                task.result = decision.result;
                task.status = 'WAITING';
                this.markEventsProcessed(task, triggerEvents);
                this.persist();
                console.log(`[${agent.name}] Suspenso em ${task.options.subtaskMode}: ${task.waitingForTaskIds.join(', ')}`);
                return;
            }

            task.result = decision.result;
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

    toMetadata(task: Task): TaskMetadata {
        return {
            task_id: task.options.task_id,
            name: task.options.name,
            description: task.options.description,
            assignedTo: task.options.assignedTo,
            parentId: task.options.parentId,
            status: task.status
        };
    }

    persist() {
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

    private parseDecision(output: string): AgentDecision {
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { status: 'completed', result: output };

        try {
            const parsed = JSON.parse(jsonMatch[0]) as Partial<AgentDecision>;
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
        new Agent('Manager', 'Você é o gerente de projetos focado em orquestração macro.'),
        new Agent('Produto', 'Você é o Product Owner, focado em regras de negócio e requisitos.'),
        new Agent('Engineer', 'Você é o Engenheiro de Software principal, focado em arquitetura e código.'),
        new Agent('Generic', 'Você é um executor de tarefas gerais de apoio.')
    ];
}

async function runNormal(requestedTask: string) {
    const orquestrator = new Orquestrator(createAgents(), { resetState: true });
    const mainTask = orquestrator.addTask(requestedTask, requestedTask, 'Manager');
    await orquestrator.waitUntilSettled(mainTask);
    return mainTask;
}

async function runRestartSimulation(requestedTask: string) {
    console.log('[SIM] Fase 1: executando ate suspender e persistir estado.');
    const firstRun = new Orquestrator(createAgents(), { resetState: true, stopWhenWaiting: true });
    const firstTask = firstRun.addTask(requestedTask, requestedTask, 'Manager');
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

async function main() {
    const args = process.argv.slice(2);
    const simulateRestart = args.includes('--simulate-restart');
    const requestedTask = args.filter(arg => arg !== '--simulate-restart').join(' ') || 'execute em subtasks diferentes no agent genérico. como se fala "oi" em japones, coreano, frances e ingles';

    console.log('================== START SWARM POC =================');
    console.log(`Modelo Pi: ${MODEL_PROVIDER}/${MODEL_ID} (${THINKING_LEVEL})`);
    console.log(`State: ${STATE_FILE}`);

    const mainTask = simulateRestart
        ? await runRestartSimulation(requestedTask)
        : await runNormal(requestedTask);

    console.log('\n================== SWARM FINISHED =================');
    console.log('Status Final da Task Principal:', mainTask.status);
    console.log('Sessao Pi da Task Principal:', mainTask.piSessionFile);
    console.log('Resultado Final:', mainTask.result);
}

main();
