import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { redactSecrets } from '../security/credentials.js';

export class GitConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitConflictError';
  }
}

export interface WorktreeResult {
  branch: string;
  baseSha: string;
  created: boolean;
}

export interface GitRepoOptions {
  gitBin?: string;
  env?: NodeJS.ProcessEnv;
}

export class GitRepo {
  private readonly gitBin: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: string | GitRepoOptions = 'git') {
    if (typeof options === 'string') {
      this.gitBin = options;
      this.env = {};
    } else {
      this.gitBin = options.gitBin ?? 'git';
      this.env = options.env ?? {};
    }
  }

  ensureMirror(gitUrl: string, mirrorDir: string): void {
    if (existsSync(mirrorDir)) {
      this.git([`--git-dir=${mirrorDir}`, 'remote', 'set-url', 'origin', gitUrl]);
      this.fetch(mirrorDir);
      return;
    }
    this.git(['clone', '--mirror', gitUrl, mirrorDir]);
  }

  fetch(mirrorDir: string): void {
    this.git([`--git-dir=${mirrorDir}`, 'fetch', '--prune', 'origin']);
  }

  addWorktree(mirrorDir: string, worktreeDir: string, branch: string, startPoint: string): WorktreeResult {
    const baseSha = this.revParse(mirrorDir, startPoint);
    if (existsSync(worktreeDir)) {
      return { branch, baseSha, created: false };
    }
    this.git([`--git-dir=${mirrorDir}`, 'worktree', 'add', '-B', branch, worktreeDir, startPoint]);
    return { branch, baseSha, created: true };
  }

  removeWorktree(mirrorDir: string, worktreeDir: string): void {
    if (!existsSync(worktreeDir)) return;
    this.git([`--git-dir=${mirrorDir}`, 'worktree', 'remove', '--force', worktreeDir]);
  }

  deleteBranch(mirrorDir: string, branch: string): void {
    try {
      this.git([`--git-dir=${mirrorDir}`, 'branch', '-D', branch]);
    } catch {
      // Branch can already be gone after a manual cleanup.
    }
  }

  commitAll(worktreeDir: string, message: string): string {
    this.git(['-C', worktreeDir, 'config', 'user.name', 'Kanban Code Agent']);
    this.git(['-C', worktreeDir, 'config', 'user.email', 'kca@example.invalid']);
    this.git(['-C', worktreeDir, 'add', '-A']);
    if (this.hasChanges(worktreeDir)) {
      this.git(['-C', worktreeDir, 'commit', '-m', message]);
    }
    return this.git(['-C', worktreeDir, 'rev-parse', 'HEAD']).trim();
  }

  hasChanges(worktreeDir: string): boolean {
    return Boolean(this.git(['-C', worktreeDir, 'status', '--porcelain']).trim());
  }

  merge(worktreeDir: string, ref: string): string {
    try {
      this.git(['-C', worktreeDir, 'merge', '--no-edit', ref]);
      return this.git(['-C', worktreeDir, 'rev-parse', 'HEAD']).trim();
    } catch (error) {
      this.git(['-C', worktreeDir, 'merge', '--abort'], { ignoreError: true });
      const message = error instanceof Error ? error.message : 'Git merge failed';
      if (/CONFLICT|Automatic merge failed|Merge conflict/i.test(message)) {
        throw new GitConflictError(message);
      }
      throw error;
    }
  }

  push(worktreeDir: string, remote = 'origin', ref = 'HEAD'): void {
    this.git(['-C', worktreeDir, 'push', remote, ref]);
  }

  head(worktreeDir: string): string {
    return this.git(['-C', worktreeDir, 'rev-parse', 'HEAD']).trim();
  }

  revParse(mirrorDir: string, ref: string): string {
    return this.git([`--git-dir=${mirrorDir}`, 'rev-parse', ref]).trim();
  }

  private git(args: string[], options: { ignoreError?: boolean } = {}): string {
    try {
      return execFileSync(this.gitBin, args, {
        encoding: 'utf-8',
        env: { ...process.env, ...this.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      if (options.ignoreError) return '';
      const message = error instanceof Error ? error.message : String(error);
      const stderr = typeof (error as { stderr?: unknown }).stderr === 'string'
        ? (error as { stderr: string }).stderr
        : Buffer.isBuffer((error as { stderr?: unknown }).stderr)
          ? ((error as { stderr: Buffer }).stderr).toString('utf-8')
          : '';
      throw new Error(redactSecrets([message, stderr.trim()].filter(Boolean).join('\n'), { ...process.env, ...this.env }));
    }
  }
}
