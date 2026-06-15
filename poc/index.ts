import { EventEmitter } from 'events';
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

// --- Tipos e Interfaces ---
type TaskStatus = 'PENDING' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED';
type SubtaskMode = 'WAIT_ALL' | 'ON_DEMAND';

const MODEL_PROVIDER = 'openrouter';
const MODEL_ID = 'openai/gpt-5.4-nano';
const THINKING_LEVEL = 'off' as const;
const AVAILABLE_TOOLS = ['read', 'grep', 'find', 'ls', 'create_subtask'];

interface TaskOptions {
    task_id: string;
    name: string;
    description: string;
    assignedTo: string; // Nome do agente responsável
    parentId?: string;
    subtaskMode?: SubtaskMode;
}

// --- Classes Principais ---

class Task {
    options: TaskOptions;
    status: TaskStatus = 'PENDING';
    subtasks: Task[] = [];
    result?: string;
    waitingForTaskIds: string[] = [];
    processedSubtaskIds = new Set<string>();

    constructor(options: TaskOptions) {
        this.options = options;
    }
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

class Agent {
    name: string;
    system_prompt: string;
    tools: string[];

    constructor(name: string, system_prompt: string, tools: string[] = []) {
        this.name = name;
        this.system_prompt = system_prompt;
        this.tools = tools;
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
        if (!apiKey) {
            throw new Error('OPENROUTER_API_KEY não configurada');
        }

        this.authStorage.setRuntimeApiKey(MODEL_PROVIDER, apiKey);

        if (!this.model) {
            throw new Error(`Modelo ${MODEL_PROVIDER}/${MODEL_ID} não encontrado no Pi SDK`);
        }
    }

    async run(agent: Agent, task: Task, orquestrator: Orquestrator, eventTask?: Task): Promise<string> {
        const resourceLoader = this.createResourceLoader(agent, task, orquestrator);
        await resourceLoader.reload();

        const { session } = await createAgentSession({
            cwd: this.cwd,
            model: this.model,
            thinkingLevel: THINKING_LEVEL,
            authStorage: this.authStorage,
            modelRegistry: this.modelRegistry,
            resourceLoader,
            tools: AVAILABLE_TOOLS,
            sessionManager: SessionManager.inMemory(this.cwd),
            settingsManager: this.settingsManager
        });

        let output = '';
        try {
            session.subscribe((event) => {
                if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
                    output += event.assistantMessageEvent.delta;
                }
            });

            await session.prompt(this.buildPrompt(task, eventTask));
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
                            const existingSubtask = task.subtasks.find(subtask =>
                                subtask.options.assignedTo === params.assignedTo &&
                                subtask.options.name === params.name &&
                                subtask.options.description === params.description
                            );
                            if (existingSubtask) {
                                return {
                                    content: [{ type: 'text', text: JSON.stringify(orquestrator.toMetadata(existingSubtask)) }],
                                    details: orquestrator.toMetadata(existingSubtask)
                                };
                            }

                            const subtask = orquestrator.spawnSubtask(task, params.assignedTo, params.name, params.description);
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

    private buildPrompt(task: Task, eventTask?: Task): string {
        const subtaskResults = task.subtasks
            .map(subtask => `- ${subtask.options.task_id} ${subtask.options.name} (${subtask.options.assignedTo}) [${subtask.status}]: ${subtask.result ?? 'sem resultado'}`)
            .join('\n');

        return [
            `Tarefa: ${task.options.name}`,
            `Descrição: ${task.options.description}`,
            eventTask ? `Evento recebido: subtask ${eventTask.options.task_id} finalizada com resultado: ${eventTask.result ?? ''}` : 'Evento recebido: inicio da task.',
            subtaskResults ? `Subtasks:\n${subtaskResults}` : 'Sem subtasks.',
            'Decida o proximo passo e retorne somente o JSON estruturado.'
        ].join('\n\n');
    }
}

class AgentExecution {
    orquestrator: Orquestrator;
    agent: Agent;
    task: Task;
    private running = false;

    constructor(orquestrator: Orquestrator, agent: Agent, task: Task) {
        this.agent = agent;
        this.task = task;
        this.orquestrator = orquestrator;
    }

    async execute(eventTask?: Task) {
        if (this.running) return;
        this.running = true;
        this.task.status = 'RUNNING';
        console.log(`\n🧡 [${this.agent.name}] Processando: "${this.task.options.name}" (Status: RUNNING)`);

        try {
            const output = await this.orquestrator.pi.run(this.agent, this.task, this.orquestrator, eventTask);
            const decision = this.parseDecision(output);

            if (decision.status === 'waiting') {
                this.task.options.subtaskMode = decision.waitMode ?? 'WAIT_ALL';
                this.task.waitingForTaskIds = decision.waitingForTaskIds?.length
                    ? decision.waitingForTaskIds
                    : this.task.subtasks.filter(st => st.status !== 'COMPLETED').map(st => st.options.task_id);
                this.task.result = decision.result;
                this.task.status = 'WAITING';
                console.log(`[${this.agent.name}] Aguardando ${this.task.options.subtaskMode}: ${this.task.waitingForTaskIds.join(', ')}`);
                this.orquestrator.emit('task:waiting', this.task);
                return;
            }

            this.task.result = decision.result;
            this.task.status = 'COMPLETED';
            console.log(`✅ [${this.agent.name}] Concluiu: "${this.task.options.name}" (Status: COMPLETED)`);
            this.orquestrator.emit('task:completed', this.task);
        } finally {
            this.running = false;
            this.tryResumeFromCompletedSubtasks();
        }
    }

    notifySubtaskCompleted(completedTask: Task) {
        console.log(`[${this.agent.name}] 🟢 Evento: subtask "${completedTask.options.name}" concluída`);
        this.tryResumeFromCompletedSubtasks();
    }

    private tryResumeFromCompletedSubtasks() {
        if (this.running || this.task.status !== 'WAITING') return;

        const waitingTasks = this.task.waitingForTaskIds
            .map(taskId => this.orquestrator.getTask(taskId))
            .filter((task): task is Task => Boolean(task));

        if (this.task.options.subtaskMode === 'WAIT_ALL') {
            if (waitingTasks.some(task => task.status !== 'COMPLETED')) return;
            void this.execute();
            return;
        }

        const nextCompletedTask = waitingTasks.find(task =>
            task.status === 'COMPLETED' && !this.task.processedSubtaskIds.has(task.options.task_id)
        );

        if (!nextCompletedTask) return;
        this.task.processedSubtaskIds.add(nextCompletedTask.options.task_id);
        void this.execute(nextCompletedTask);
    }

    private parseDecision(output: string): AgentDecision {
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return { status: 'completed', result: output };
        }

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
}

class Orquestrator extends EventEmitter {
    agents: Map<string, Agent> = new Map();
    tasks: Map<string, Task> = new Map();
    executions: Record<string, Record<string, AgentExecution>> = {};
    rootTasks: Task[] = [];
    pi = new PiAgentClient();

    constructor(agents: Agent[]) {
        super();
        for (const agent of agents) {
            this.agents.set(agent.name, agent);
            this.executions[agent.name] = {};
        }

        // Configura o loop de eventos básico
        this.on('task:created', (task: Task) => {
            this.dispatch(task);
        });
        this.on('task:completed', (task: Task) => {
            this.notifyParent(task);
        });
    }

    // Método para criar e disparar uma nova task na fila do enxame
    addTask(name: string, description: string, agentName: string): Task {
        const task = new Task({
            task_id: Math.random().toString(36).substring(2, 9),
            name,
            description,
            assignedTo: agentName
        });
        this.rootTasks.push(task);
        this.tasks.set(task.options.task_id, task);
        
        // Evento assíncrono de criação
        setImmediate(() => this.emit('task:created', task));
        return task;
    }

    // Permite que agents criem subtasks dinamicamente durante a execução
    spawnSubtask(parentTask: Task, agentName: string, name: string, description: string): Task {
        if (!this.agents.has(agentName)) {
            throw new Error(`Agente ${agentName} não encontrado`);
        }

        const subtask = new Task({
            task_id: Math.random().toString(36).substring(2, 9),
            name,
            description,
            assignedTo: agentName,
            parentId: parentTask.options.task_id
        });
        
        parentTask.subtasks.push(subtask);
        this.tasks.set(subtask.options.task_id, subtask);
        console.log(`   ↳ [SUBTASK CRIADA] "${name}" designada para [${agentName}]`);
        
        setImmediate(() => this.emit('task:created', subtask));
        return subtask;
    }

    getAgentNames(): string[] {
        return [...this.agents.keys()];
    }

    getTask(taskId: string): Task | undefined {
        return this.tasks.get(taskId);
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

    // Encontra o agente correto e inicia a execução
    private dispatch(task: Task) {
        const agent = this.agents.get(task.options.assignedTo);
        if (!agent) {
            console.error(`Agente ${task.options.assignedTo} não encontrado para a tarefa ${task.options.name}`);
            return;
        }

        const execution = new AgentExecution(this, agent, task);
        this.executions[agent.name][task.options.task_id] = execution;
        
        // Executa sem travar o loop principal (Assíncrono)
        execution.execute().catch(err => {
            task.status = 'FAILED';
            console.error(`Erro ao executar tarefa ${task.options.task_id}:`, err);
        });
    }

    private notifyParent(task: Task) {
        if (!task.options.parentId) return;

        const parentTask = this.tasks.get(task.options.parentId);
        if (!parentTask) return;

        const execution = this.executions[parentTask.options.assignedTo]?.[parentTask.options.task_id];
        execution?.notifySubtaskCompleted(task);
    }

    // Helper para sabermos quando o enxame inteiro terminou tudo
    async waitUntilEmpty(rootTask: Task) {
        return new Promise<void>((resolve) => {
            const check = () => {
                if (rootTask.status === 'COMPLETED' || rootTask.status === 'FAILED') {
                    resolve();
                } else {
                    this.once('task:completed', check);
                }
            };
            check();
        });
    }
}

// --- Fluxo de Execução Principal ---

async function main() {
    console.log('================== START SWARM POC =================');
    console.log(`Modelo Pi: ${MODEL_PROVIDER}/${MODEL_ID} (${THINKING_LEVEL})`);

    // Inicialização dos Agentes solicitados
    const agents = [
        new Agent('Manager', 'Você é o gerente de projetos focado em orquestração macro.'),
        new Agent('Produto', 'Você é o Product Owner, focado em regras de negócio e requisitos.'),
        new Agent('Engineer', 'Você é o Engenheiro de Software principal, focado em arquitetura e código.'),
        new Agent('Generic', 'Você é um executor de tarefas gerais de apoio.')
    ];

    const orquestrator = new Orquestrator(agents);

    // Dispara a primeira task do ecossistema para o Manager iniciar o fluxo
    const requestedTask = process.argv.slice(2).join(' ') || 'me responda oi em japones';
    const mainTask = orquestrator.addTask(requestedTask, requestedTask, 'Manager');

    // Aguarda o término de toda a árvore de eventos gerada por essa task
    await orquestrator.waitUntilEmpty(mainTask);

    console.log('\n================== SWARM FINISHED =================');
    console.log('Status Final da Task Principal:', mainTask.status);
    console.log('Resultado Final:', mainTask.result);
}

main();
