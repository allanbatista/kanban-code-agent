export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string;
  gitUrl?: string;
  defaultBranch: string;
  autoMerge: boolean;
  devcontainerPath?: string;
  location: string;
  taskCount: number;
  runningCount: number;
  createdAt: string;
}
