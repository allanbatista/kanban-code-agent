export interface Project {
  id: string;
  name: string;
  description: string;
  location: string;
  taskCount: number;
  runningCount: number;
  taskIds?: string[];
  createdAt: string;
}
