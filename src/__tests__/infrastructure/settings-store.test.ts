import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SettingsStore, DEFAULT_SETTINGS } from '../../infrastructure/persistence/settings-store.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'settings-'));
}

describe('SettingsStore', () => {
  const dirs: string[] = [];
  function makeStore(): SettingsStore {
    return new SettingsStore(makeDir());
  }
  function makeDir(): string {
    const dir = tempDir();
    dirs.push(dir);
    return dir;
  }
  afterEach(() => {
    while (dirs.length) {
      try { rmSync(dirs.pop()!, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });

  it('returns defaults when no file exists', () => {
    const store = makeStore();
    expect(store.load()).toEqual(DEFAULT_SETTINGS);
    expect(store.getAgent()).toBe('pi');
  });

  it('round-trips a saved settings object across instances', () => {
    const dir = makeDir();
    const next = structuredClone(DEFAULT_SETTINGS);
    next.agent = 'codex';
    next.providers[0].apiKey = 'sk-secret-key';
    new SettingsStore(dir).save(next);
    // Nova instância no mesmo dir enxerga o mesmo estado (fonte é o arquivo).
    const reopened = new SettingsStore(dir);
    expect(reopened.load()).toEqual(next);
    expect(reopened.getAgent()).toBe('codex');
  });

  it('writes the file with 0600 permissions', () => {
    const dir = makeDir();
    new SettingsStore(dir).save(DEFAULT_SETTINGS);
    const mode = statSync(join(dir, '.swarm', 'settings.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('getApiKey returns the configured key, undefined when blank', () => {
    const store = makeStore();
    const next = structuredClone(DEFAULT_SETTINGS);
    next.providers = [
      { name: 'fast', provider: 'deepseek', modelId: 'm', apiKey: 'sk-live', enabled: true },
      { name: 'other', provider: 'openai', modelId: 'm', apiKey: '', enabled: true },
    ];
    store.save(next);
    expect(store.getApiKey('deepseek')).toBe('sk-live');
    expect(store.getApiKey('openai')).toBeUndefined();
    expect(store.getApiKey('unknown')).toBeUndefined();
  });

  it('resolver precedence: settings key wins when non-empty, else env fallback', () => {
    const store = makeStore();
    const next = structuredClone(DEFAULT_SETTINGS);
    next.providers[0] = { name: 'fast', provider: 'deepseek', modelId: 'm', apiKey: 'from-settings', enabled: true };
    store.save(next);
    // Réplica exata da expressão do pi-runner: resolver(provider) ?? env.
    const resolve = (provider: string, env?: string) => store.getApiKey(provider) ?? env;
    expect(resolve('deepseek', 'from-env')).toBe('from-settings');
    expect(resolve('openai', 'from-env')).toBe('from-env');
  });
});
