import { cn } from '@/lib/utils';
import type { SettingsSection } from '@/types/settings';

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'appearance', label: 'Aparência' },
  { id: 'providers', label: 'Providers' },
  { id: 'advanced', label: 'Advanced' },
];

interface SettingsSidebarProps {
  active: SettingsSection;
  onChange: (section: SettingsSection) => void;
}

export function SettingsSidebar({ active, onChange }: SettingsSidebarProps) {
  return (
    <aside className="w-56 shrink-0 border-r border-border/50 bg-card/30 backdrop-blur-sm">
      <nav className="p-4 space-y-1">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            onClick={() => onChange(section.id)}
            className={cn(
              'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
              active === section.id
                ? 'bg-secondary text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            )}
          >
            {section.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
