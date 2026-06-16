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
  const [location, setLocation] = useState('');
  const { addProject, updateProject, projects } = useProjectsStore();

  useEffect(() => {
    if (editProject) {
      setName(editProject.name);
      setDescription(editProject.description);
      setLocation(editProject.location);
    } else {
      setName('');
      setDescription('');
      setLocation('');
    }
  }, [editProject, open]);

  const handleSave = () => {
    if (!name.trim()) return;
    if (editProject) {
      updateProject(editProject.id, { name: name.trim(), description: description.trim(), location: location.trim() });
    } else {
      addProject({
        id: `proj_${String(projects.length + 1).padStart(3, '0')}`,
        name: name.trim(),
        description: description.trim(),
        location: location.trim(),
        taskCount: 0,
        runningCount: 0,
        createdAt: new Date().toISOString().split('T')[0],
      });
    }
    onClose();
    onOpenChange(false);
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
          <div className="md:col-span-2">
            <Label htmlFor="loc">Location</Label>
            <Input id="loc" value={location} onChange={e => setLocation(e.target.value)} placeholder="/home/user/project" className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); onOpenChange(false); }}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!name.trim()}>{editProject ? 'Salvar' : 'Criar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
