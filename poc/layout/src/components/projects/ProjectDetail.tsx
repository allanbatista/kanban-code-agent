import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ArrowLeft, Folder, ExternalLink } from 'lucide-react';
import { useProjectsStore } from '@/stores/projectsStore';
import { useKanbanStore } from '@/stores/kanbanStore';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageContainer } from '@/components/layout/PageContainer';
import { StatusBadge } from '@/components/kanban/StatusBadge';
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

  const projectTasks = tasks.filter(t => t.title.toLowerCase().includes(project.name.toLowerCase()));

  return (
    <PageContainer>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-border/60 bg-card/40 px-4 py-4 shadow-sm backdrop-blur-sm">
          <Button variant="ghost" size="icon" onClick={() => navigate('/projects')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Folder className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <h1 className="text-xl font-semibold">{project.name}</h1>
            <p className="text-sm text-muted-foreground/75">{project.description}</p>
          </div>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => navigate(`/?project=${project.id}`)}>
            <ExternalLink className="h-3.5 w-3.5" /> Abrir Kanban
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <Card className="border-border/60 bg-card/40">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Local</CardTitle></CardHeader>
            <CardContent><p className="text-sm font-mono">{project.location}</p></CardContent>
          </Card>
          <Card className="border-border/60 bg-card/40">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total de Tasks</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{project.taskCount}</p></CardContent>
          </Card>
          <Card className="border-border/60 bg-card/40">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Em Execução</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-emerald-400">{project.runningCount}</p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground/75 uppercase tracking-wider">Tasks Recentes</h2>
          {projectTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground/50">Nenhuma task associada ainda.</p>
          ) : (
            projectTasks.slice(0, 10).map(task => (
              <div
                key={task.id}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-4 py-2.5 cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => navigate(`/?task=${task.id}&tab=chat`)}
              >
                <span className="flex-1 text-sm truncate">{task.title}</span>
                <StatusBadge status={task.status} />
                <span className="text-xs text-muted-foreground/70">#{task.id.slice(0, 8)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </PageContainer>
  );
}
