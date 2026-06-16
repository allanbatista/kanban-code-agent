import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Folder } from 'lucide-react';
import { useProjectsStore } from '@/stores/projectsStore';
import { useKanbanStore } from '@/stores/kanbanStore';
import { EmptyState } from '@/components/shared/EmptyState';
import { AgentColumn } from '@/components/kanban/AgentColumn';
import { AGENTS } from '@/mocks/mockAgents';
import { PageContainer } from '@/components/layout/PageContainer';

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getProjectById } = useProjectsStore();
  const { tasks } = useKanbanStore();
  const project = id ? getProjectById(id) : undefined;

  if (!project) {
    return (
      <PageContainer>
        <EmptyState title="Projeto não encontrado" description="O projeto solicitado não existe." />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col p-6">
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-border/60 bg-card/40 px-4 py-4 shadow-sm backdrop-blur-sm">
          <Button variant="ghost" size="icon" onClick={() => navigate('/projects')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Folder className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">{project.name}</h1>
            <p className="text-sm text-muted-foreground/75">{project.description}</p>
          </div>
          <Badge variant="outline" className="ml-auto border-border/60 bg-background/50">{project.taskCount} tasks</Badge>
        </div>
        <div className="flex flex-1 min-h-0 items-stretch gap-4 overflow-x-auto pb-4">
          {AGENTS.filter(a => a.id !== 'manager').map(agent => (
            <AgentColumn
              key={agent.id}
              id={agent.id}
              name={agent.name}
              icon={agent.icon}
              color={agent.color}
              tasks={tasks.filter(t => t.assignedTo === agent.id)}
            />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
