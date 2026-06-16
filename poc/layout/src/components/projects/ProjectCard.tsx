import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Folder } from 'lucide-react';
import type { Project } from '@/types/project';

interface ProjectCardProps {
  project: Project;
  onEdit: () => void;
  onDelete: () => void;
}

export function ProjectCard({ project, onEdit, onDelete }: ProjectCardProps) {
  const navigate = useNavigate();

  return (
    <Card
      className="group cursor-pointer overflow-hidden border-border/60 bg-card/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-xl hover:shadow-black/20"
      onClick={() => navigate(`/projects/${project.id}`)}
    >
      <CardHeader>
        <div className="flex items-center gap-2">
          <Folder className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">{project.name}</CardTitle>
        </div>
        <CardDescription className="text-xs leading-relaxed text-muted-foreground/75 line-clamp-2">
          {project.description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-1 text-xs text-muted-foreground/80">
          <span>📍</span>
          <span className="truncate">{project.location}</span>
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground/75">
          <span>{project.taskCount} tasks</span>
          {project.runningCount > 0 && (
            <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/10 text-emerald-300 text-[10px]">
              {project.runningCount} running
            </Badge>
          )}
        </div>
        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onEdit}>Editar</Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={onDelete}>Excluir</Button>
        </div>
      </CardFooter>
    </Card>
  );
}
