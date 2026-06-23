import { useState, useEffect } from 'react';
import { ProjectCard } from './ProjectCard';
import { ProjectDialog } from './ProjectDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { useProjectsStore } from '@/stores/projectsStore';
import { Button } from '@/components/ui/button';
import { Plus, FolderOpen } from 'lucide-react';

export function ProjectsGrid() {
  const { projects, deleteProject, getProjectById, fetchProjects } = useProjectsStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const editingProject = editingId ? getProjectById(editingId) ?? null : null;

  const handleEdit = (id: string) => {
    setEditingId(id);
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (deleteConfirm === id) {
      await deleteProject(id);
      setDeleteConfirm(null);
    } else {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm(null), 3000);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between rounded-2xl border border-border/60 bg-card/40 px-4 py-4 shadow-sm backdrop-blur-sm">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/75">Workspace</p>
          <h1 className="mt-1 text-xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground/75">Organize projetos e navegue por cada fluxo.</p>
        </div>
        <Button onClick={() => { setEditingId(null); setDialogOpen(true); }} className="gap-1.5 shadow-lg shadow-primary/10">
          <Plus className="h-4 w-4" /> Novo Projeto
        </Button>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="h-12 w-12" />}
          title="Nenhum projeto"
          description="Crie seu primeiro projeto para começar."
          action={
            <Button onClick={() => { setEditingId(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Novo Projeto
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {projects.map(project => (
            <ProjectCard
              key={project.id}
              project={project}
              onEdit={() => handleEdit(project.id)}
              onDelete={() => handleDelete(project.id)}
            />
          ))}
        </div>
      )}

      <ProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editProject={editingProject}
        onClose={() => { setEditingId(null); }}
      />
    </div>
  );
}
