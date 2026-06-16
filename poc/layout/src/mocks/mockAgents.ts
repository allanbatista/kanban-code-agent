import type { Agent } from '@/types/task';

export const AGENTS: Agent[] = [
  { id: 'manager', name: 'Manager', icon: 'ClipboardList', color: '#f59e0b' },
  { id: 'produto', name: 'Produto', icon: 'Puzzle', color: '#a78bfa' },
  { id: 'generic', name: 'Generic', icon: 'Bot', color: '#94a3b8' },
  { id: 'architecture', name: 'Architecture', icon: 'Building2', color: '#f472b6' },
  { id: 'engineer', name: 'Engineer', icon: 'Code', color: '#60a5fa' },
  { id: 'code-reviewer', name: 'Code Reviewer', icon: 'SearchCode', color: '#2dd4bf' },
  { id: 'qa', name: 'QA', icon: 'FlaskConical', color: '#fb923c' },
];

export const AGENT_COLORS: Record<string, string> = Object.fromEntries(
  AGENTS.map(a => [a.id, a.color])
);
