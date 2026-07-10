import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { GitRepo } from '../../infrastructure/git/git-repo.js';
import { gitCredentialEnv } from '../../infrastructure/security/credentials.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

describe('GitRepo', () => {
  let dir = '';

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('covers mirror, worktree, commit, merge and cleanup', () => {
    dir = mkdtempSync(join(tmpdir(), 'kca-git-'));
    const origin = join(dir, 'origin');
    git(dir, ['init', '--initial-branch=main', origin]);
    git(origin, ['config', 'user.name', 'Test']);
    git(origin, ['config', 'user.email', 'test@example.invalid']);
    writeFileSync(join(origin, 'README.md'), 'base\n');
    git(origin, ['add', 'README.md']);
    git(origin, ['commit', '-m', 'base']);

    const repo = new GitRepo();
    const mirror = join(dir, 'repo.git');
    repo.ensureMirror(origin, mirror);
    repo.ensureMirror(origin, mirror);

    const feature = join(dir, 'feature');
    const featureResult = repo.addWorktree(mirror, feature, 'kca/task/sub', 'main');
    writeFileSync(join(feature, 'feature.txt'), 'feature\n');
    const featureSha = repo.commitAll(feature, 'feature');

    const integration = join(dir, 'integration');
    repo.addWorktree(mirror, integration, 'kca/task/integration', 'main');
    writeFileSync(join(integration, 'integration.txt'), 'integration\n');
    repo.commitAll(integration, 'integration');
    const mergedSha = repo.merge(integration, 'kca/task/sub');

    expect(featureResult.created).toBe(true);
    expect(featureResult.baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(featureSha).toMatch(/^[0-9a-f]{40}$/);
    expect(mergedSha).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join(integration, 'feature.txt'))).toBe(true);
    expect(existsSync(join(integration, 'integration.txt'))).toBe(true);

    repo.removeWorktree(mirror, feature);
    repo.removeWorktree(mirror, integration);
    repo.deleteBranch(mirror, 'kca/task/sub');
    repo.deleteBranch(mirror, 'kca/task/integration');
    expect(existsSync(feature)).toBe(false);
    expect(existsSync(integration)).toBe(false);
  });

  it('push usa GIT_ASKPASS sem gravar token em git config', () => {
    dir = mkdtempSync(join(tmpdir(), 'kca-git-askpass-'));
    const gitBin = join(dir, 'git');
    const logPath = join(dir, 'git-env.json');
    writeFileSync(
      gitBin,
      [
        '#!/bin/sh',
        `printf '{"args":"%s","askpass":"%s","token":"%s"}\\n' "$*" "$GIT_ASKPASS" "$KCA_GIT_TOKEN" > "${logPath}"`,
        'exit 0',
        '',
      ].join('\n'),
    );
    chmodSync(gitBin, 0o700);

    const repo = new GitRepo({
      gitBin,
      env: gitCredentialEnv('secret-token', join(dir, 'askpass.sh')),
    });
    repo.push('/tmp/worktree');

    const log = readFileSync(logPath, 'utf-8');
    expect(log).toContain('"askpass"');
    expect(log).toContain('secret-token');
    expect(log).not.toContain('config');
  });
});
