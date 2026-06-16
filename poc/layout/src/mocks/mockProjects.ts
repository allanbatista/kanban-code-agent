import type { Project } from '@/types/project';

export const MOCK_PROJECTS: Project[] = [
  { id: 'proj_001', name: 'Projeto Alpha', description: 'Sistema de gerenciamento de tarefas com autenticação OAuth e dashboard em tempo real.', location: '/home/user/project-alpha', taskCount: 5, runningCount: 2, createdAt: '2026-01-15' },
  { id: 'proj_002', name: 'Projeto Beta', description: 'API RESTful para e-commerce com microsserviços e filas de processamento.', location: '/home/user/project-beta', taskCount: 3, runningCount: 0, createdAt: '2026-02-20' },
  { id: 'proj_003', name: 'Projeto Gamma', description: 'App mobile de delivery com React Native e integração com mapas.', location: '/home/user/project-gamma', taskCount: 8, runningCount: 1, createdAt: '2026-03-10' },
  { id: 'proj_004', name: 'Projeto Delta', description: 'Plataforma de analytics com processamento de dados em tempo real.', location: '/home/user/project-delta', taskCount: 2, runningCount: 0, createdAt: '2026-04-05' },
];
