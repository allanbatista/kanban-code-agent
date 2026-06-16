import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/35 px-6 py-16 text-center shadow-sm backdrop-blur-sm', className)}>
      <div className="mb-6 text-muted-foreground/30">
        {icon ?? <Inbox className="h-16 w-16" />}
      </div>
      <h3 className="mb-2 text-lg font-semibold text-foreground/90">{title}</h3>
      {description && <p className="max-w-md text-sm leading-relaxed text-muted-foreground/70">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
