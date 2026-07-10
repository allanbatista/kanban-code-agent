import { describe, expect, it } from 'vitest';
import type { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveDevcontainerImage } from '../../infrastructure/containers/devcontainer.js';

function withProject(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'kca-devc-test-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// execFile fake: registra chamadas; `inspectExists` decide se `docker image
// inspect` acha a tag (cache hit) ou lança (força build).
function fakeExecFile(calls: string[][], inspectExists: boolean): typeof execFileSync {
  return ((bin: string, args: readonly string[]) => {
    calls.push([bin, ...args]);
    if (args[0] === 'image' && args[1] === 'inspect' && !inspectExists) {
      throw new Error('No such image');
    }
    return Buffer.from('');
  }) as unknown as typeof execFileSync;
}

function isBuild(call: string[]): boolean {
  return call.includes('build') && call.includes('--image-name');
}

describe('resolveDevcontainerImage', () => {
  it('constrói quando a imagem não existe no cache e devolve tag kca-devc-<slug>-<hash>', () => {
    withProject((dir) => {
      const configPath = join(dir, 'devcontainer.json');
      writeFileSync(configPath, '{ "image": "debian:bookworm-slim" }');
      const calls: string[][] = [];
      const image = resolveDevcontainerImage({
        workspaceFolder: dir,
        configPath,
        slug: 'proj',
        execFile: fakeExecFile(calls, false),
      });
      expect(image).toMatch(/^kca-devc-proj-[0-9a-f]{12}$/);
      const build = calls.find(isBuild);
      expect(build).toBeDefined();
      expect(build).toContain('--image-name');
      expect(build).toContain(image);
      expect(build).toContain(dir);
    });
  });

  it('pula o build no cache hit (docker image inspect acha a tag)', () => {
    withProject((dir) => {
      const configPath = join(dir, 'devcontainer.json');
      writeFileSync(configPath, '{ "image": "debian:bookworm-slim" }');
      const calls: string[][] = [];
      resolveDevcontainerImage({
        workspaceFolder: dir,
        configPath,
        slug: 'proj',
        execFile: fakeExecFile(calls, true),
      });
      expect(calls.some(isBuild)).toBe(false);
      expect(calls.some((c) => c[0] === 'docker' && c[1] === 'image' && c[2] === 'inspect')).toBe(true);
    });
  });

  it('rejeita dockerComposeFile com erro claro citando o slug', () => {
    withProject((dir) => {
      const configPath = join(dir, 'devcontainer.json');
      writeFileSync(configPath, '{ "dockerComposeFile": "docker-compose.yml", "service": "app" }');
      expect(() =>
        resolveDevcontainerImage({ workspaceFolder: dir, configPath, slug: 'proj', execFile: fakeExecFile([], false) }),
      ).toThrow(/proj.*compose|compose.*proj/i);
    });
  });

  it('derivação da tag é estável para o mesmo devcontainer.json', () => {
    withProject((dir) => {
      const configPath = join(dir, 'devcontainer.json');
      writeFileSync(configPath, '{\n  // comentário JSONC\n  "image": "debian:bookworm-slim",\n}');
      const a = resolveDevcontainerImage({ workspaceFolder: dir, configPath, slug: 'proj', execFile: fakeExecFile([], true) });
      const b = resolveDevcontainerImage({ workspaceFolder: dir, configPath, slug: 'proj', execFile: fakeExecFile([], true) });
      expect(a).toBe(b);
    });
  });

  it('mudança no Dockerfile referenciado muda o hash da tag', () => {
    withProject((dir) => {
      const configPath = join(dir, 'devcontainer.json');
      const dockerfilePath = join(dir, 'Dockerfile');
      writeFileSync(configPath, '{ "build": { "dockerfile": "Dockerfile" } }');
      writeFileSync(dockerfilePath, 'FROM debian:bookworm-slim\n');
      const first = resolveDevcontainerImage({ workspaceFolder: dir, configPath, slug: 'proj', execFile: fakeExecFile([], true) });
      writeFileSync(dockerfilePath, 'FROM debian:bookworm-slim\nRUN apt-get update\n');
      const second = resolveDevcontainerImage({ workspaceFolder: dir, configPath, slug: 'proj', execFile: fakeExecFile([], true) });
      expect(first).not.toBe(second);
    });
  });
});
