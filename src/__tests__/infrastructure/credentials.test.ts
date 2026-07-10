import { describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createGitAskPassScript,
  gitCredentialEnv,
  loadGitToken,
  MissingCredentialError,
} from '../../infrastructure/security/credentials.js';
import { GitRepo } from '../../infrastructure/git/git-repo.js';

describe('credentials', () => {
  it('carrega git-token de CREDENTIALS_DIRECTORY antes do fallback env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kca-creds-'));
    try {
      writeFileSync(join(dir, 'git-token'), 'from-file\n');
      expect(loadGitToken({ CREDENTIALS_DIRECTORY: dir, SWARM_GIT_TOKEN: 'from-env' })).toBe('from-file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('usa fallback env e falha com erro claro quando ausente', () => {
    expect(loadGitToken({ SWARM_GIT_TOKEN: 'from-env' })).toBe('from-env');
    expect(() => loadGitToken({})).toThrow(MissingCredentialError);
  });

  it('gera askpass sem gravar token no script', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kca-askpass-'));
    try {
      const script = createGitAskPassScript(dir);
      const env = gitCredentialEnv('secret-token', script);

      expect(readFileSync(script, 'utf-8')).not.toContain('secret-token');
      expect(env.KCA_GIT_TOKEN).toBe('secret-token');
      expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('redige token vindo do ambiente em erros git', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kca-git-redact-'));
    try {
      const gitBin = join(dir, 'git');
      writeFileSync(gitBin, '#!/bin/sh\necho "$KCA_GIT_TOKEN" >&2\nexit 1\n');
      chmodSync(gitBin, 0o700);
      const repo = new GitRepo({ gitBin, env: { KCA_GIT_TOKEN: 'secret-token' } });

      expect(() => repo.fetch('/tmp/mirror.git')).toThrow('<redacted>');
      expect(() => repo.fetch('/tmp/mirror.git')).not.toThrow('secret-token');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
