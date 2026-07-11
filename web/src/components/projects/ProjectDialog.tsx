/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useProjectsStore } from '@/stores/projectsStore';
import type { Project } from '@/types/project';

interface ProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editProject: Project | null;
  onClose: () => void;
}

export function ProjectDialog({ open, onOpenChange, editProject, onClose }: ProjectDialogProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [devcontainerPath, setDevcontainerPath] = useState('');
  const [autoMerge, setAutoMerge] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { createProject, updateProject } = useProjectsStore();

  useEffect(() => {
    if (editProject) {
      setName(editProject.name);
      setSlug(editProject.slug);
      setDescription(editProject.description);
      setGitUrl(editProject.gitUrl ?? '');
      setDefaultBranch(editProject.defaultBranch);
      setDevcontainerPath(editProject.devcontainerPath ?? '');
      setAutoMerge(editProject.autoMerge);
    } else {
      setName('');
      setSlug('');
      setDescription('');
      setGitUrl('');
      setDefaultBranch('main');
      setDevcontainerPath('');
      setAutoMerge(false);
    }
    setError(null);
  }, [editProject, open]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (editProject) {
        await updateProject(editProject.id, {
          name: name.trim(),
          description: description.trim(),
          gitUrl: gitUrl.trim(),
          defaultBranch: defaultBranch.trim() || 'main',
          autoMerge,
          devcontainerPath: devcontainerPath.trim() || null,
        });
      } else {
        await createProject({
          name: name.trim(),
          slug: slug.trim() || undefined,
          description: description.trim(),
          gitUrl: gitUrl.trim() || undefined,
          defaultBranch: defaultBranch.trim() || 'main',
          autoMerge,
          devcontainerPath: devcontainerPath.trim() || undefined,
        });
      }
      onClose();
      onOpenChange(false);
    } catch (err) {
      // Mantem o dialog aberto e mostra a mensagem da API (ex.: gitUrl invalida).
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editProject ? 'Editar Projeto' : 'Novo Projeto'}</DialogTitle>
          <DialogDescription>
            {editProject ? 'Atualize as informações do projeto.' : 'Preencha os detalhes do novo projeto.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label htmlFor="name">Nome</Label>
            <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="Nome do projeto" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="slug">Slug</Label>
            <Input id="slug" value={slug} onChange={e => setSlug(e.target.value)} placeholder="gerado pelo nome" disabled={Boolean(editProject)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="branch">Branch padrão</Label>
            <Input id="branch" value={defaultBranch} onChange={e => setDefaultBranch(e.target.value)} placeholder="main" className="mt-1" />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="git-url">Git URL</Label>
            <Input id="git-url" value={gitUrl} onChange={e => setGitUrl(e.target.value)} placeholder="https://github.com/org/repo.git" className="mt-1" />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="devcontainer">Devcontainer</Label>
            <Input id="devcontainer" value={devcontainerPath} onChange={e => setDevcontainerPath(e.target.value)} placeholder=".devcontainer/devcontainer.json" className="mt-1" />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="desc">Descrição</Label>
            <Textarea id="desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="Descrição..." className="mt-1 min-h-24" />
          </div>
          <label className="md:col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={autoMerge} onChange={e => setAutoMerge(e.target.checked)} />
            Auto-merge depois dos gates
          </label>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); onOpenChange(false); }} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>{saving ? 'Salvando...' : editProject ? 'Salvar' : 'Criar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
