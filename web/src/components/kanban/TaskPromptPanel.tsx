import { ScrollArea } from '@/components/ui/scroll-area';
import { CodeBlock } from '@/components/shared/CodeBlock';
import { MarkdownPreview } from '@/components/shared/MarkdownPreview';
import type { Task } from '@/types/task';

interface TaskPromptPanelProps {
  task: Task;
}

const SYSTEM_PROMPT = `Você é um agente de IA especializado em desenvolvimento de software.
Seu objetivo é completar a tarefa atribuída com a maior qualidade possível.
Utilize as ferramentas disponíveis para ler arquivos, pesquisar, criar subtasks e gerar artefatos.
Responda sempre em JSON puro no formato especificado.`;

export function TaskPromptPanel({ task }: TaskPromptPanelProps) {
  return (
    <ScrollArea className="h-full p-4">
      <div className="space-y-4">
        <section className="rounded-2xl border border-border/60 bg-card/40 p-4 shadow-sm">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/75">System Prompt</h3>
          <CodeBlock code={SYSTEM_PROMPT} language="text" />
        </section>
        <section className="rounded-2xl border border-border/60 bg-card/40 p-4 shadow-sm">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/75">Task Metadata</h3>
          <CodeBlock
            code={JSON.stringify({
              task_id: task.id,
              title: task.title,
              assignedTo: task.assignedTo,
              status: task.status,
              depth: task.depth,
              runtimeConfig: task.runtimeConfig,
              model: task.runtimeConfig.model,
              effort: task.runtimeConfig.effort,
            }, null, 2)}
            language="json"
          />
        </section>
        {task.chat.length > 0 && (
          <section className="rounded-2xl border border-border/60 bg-card/40 p-4 shadow-sm">
            <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/75">Chat History</h3>
            {task.chat.map((msg, i) => (
              <div key={i} className="mb-3 last:mb-0">
                <span className="text-[10px] font-medium tracking-wide text-muted-foreground/75">
                  {msg.role.toUpperCase()} ({new Date(msg.ts).toLocaleTimeString()})
                </span>
                {msg.text && <MarkdownPreview content={msg.text} className="mt-1 text-sm" />}
              </div>
            ))}
          </section>
        )}
      </div>
    </ScrollArea>
  );
}
