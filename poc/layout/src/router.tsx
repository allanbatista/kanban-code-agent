import { createBrowserRouter, Navigate } from 'react-router-dom';
import { App } from './App';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { ProjectsGrid } from '@/components/projects/ProjectsGrid';
import { ProjectDetail } from '@/components/projects/ProjectDetail';
import { SettingsLayout } from '@/components/settings/SettingsLayout';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <KanbanBoard /> },
      { path: 'projects', element: <ProjectsGrid /> },
      { path: 'projects/:id', element: <ProjectDetail /> },
      { path: 'settings', element: <SettingsLayout /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
