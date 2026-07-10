import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class MissingCredentialError extends Error {
  constructor(name: string) {
    super(`Credencial ${name} nao encontrada`);
    this.name = 'MissingCredentialError';
  }
}

export function loadGitToken(env: NodeJS.ProcessEnv = process.env): string {
  const credentialsDir = env.CREDENTIALS_DIRECTORY;
  if (credentialsDir) {
    const token = readCredentialFile(credentialsDir, 'git-token');
    if (token) return token;
  }

  const fallback = env.SWARM_GIT_TOKEN ?? env.GIT_TOKEN;
  if (fallback?.trim()) return fallback.trim();

  throw new MissingCredentialError('git-token');
}

export function createGitAskPassScript(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, 'git-askpass.sh');
  writeFileSync(
    scriptPath,
    [
      '#!/bin/sh',
      'case "$1" in',
      '  *Username*) printf "%s\\n" "${GIT_USERNAME:-oauth2}" ;;',
      '  *) printf "%s\\n" "$KCA_GIT_TOKEN" ;;',
      'esac',
      '',
    ].join('\n'),
    { mode: 0o700 },
  );
  chmodSync(scriptPath, 0o700);
  return scriptPath;
}

export function gitCredentialEnv(token: string, askPassPath: string, username = 'oauth2'): NodeJS.ProcessEnv {
  return {
    GIT_ASKPASS: askPassPath,
    GIT_TERMINAL_PROMPT: '0',
    GIT_USERNAME: username,
    KCA_GIT_TOKEN: token,
  };
}

export function gitCredentialEnvFromRuntime(dataDir: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv | undefined {
  try {
    const token = loadGitToken(env);
    const askPassPath = createGitAskPassScript(join(dataDir, '.swarm', 'credentials'));
    return gitCredentialEnv(token, askPassPath);
  } catch (error) {
    if (error instanceof MissingCredentialError) return undefined;
    throw error;
  }
}

export function redactSecrets(value: string, env: NodeJS.ProcessEnv = process.env): string {
  let redacted = value.replace(/https?:\/\/([^:@\s]+):([^@\s]+)@/g, 'https://<redacted>@');
  for (const [key, secret] of Object.entries(env)) {
    if (!secret || secret.length < 4) continue;
    if (!/(TOKEN|PASSWORD|SECRET|KEY)$/i.test(key)) continue;
    redacted = redacted.split(secret).join('<redacted>');
  }
  return redacted;
}

function readCredentialFile(credentialsDir: string, name: string): string | undefined {
  try {
    const value = readFileSync(join(credentialsDir, name), 'utf-8').trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}
