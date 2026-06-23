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
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const { createProject, updateProject } = useProjectsStore();

  useEffect(() => {
    if (editProject) {
      setName(editProject.name);
      setDescription(editProject.description);
    } else {
      setName('');
      setDescription('');
    }
  }, [editProject, open]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editProject) {
        await updateProject(editProject.id, { name: name.trim(), description: description.trim() });
      } else {
        await createProject({ name: name.trim(), description: description.trim() });
      }
      onClose();
      onOpenChange(false);
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
          <div className="md:col-span-2">
            <Label htmlFor="desc">Descrição</Label>
            <Textarea id="desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="Descrição..." className="mt-1 min-h-24" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); onOpenChange(false); }} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>{saving ? 'Salvando...' : editProject ? 'Salvar' : 'Criar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
