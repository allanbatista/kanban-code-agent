import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/60 px-6 py-12 text-center',
        className
      )}
    >
      <div className="text-muted-foreground/40">
        {icon ?? <Inbox className="h-12 w-12" />}
      </div>
      <div>
        <h3 className="text-sm font-medium text-foreground/80">{title}</h3>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground/60">{description}</p>
        )}
      </div>
      {action && (
        <Button variant="outline" size="sm" onClick={action.onClick} className="mt-1">
          {action.label}
        </Button>
      )}
    </div>
  );
}
