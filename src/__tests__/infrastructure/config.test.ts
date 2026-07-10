import { describe, it, expect, afterEach } from 'vitest';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig } from '../../infrastructure/config.js';

describe('Config data-root convention', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('defaults dataDir to ~/.kca', () => {
    const config = loadConfig();
    expect(config.dataDir).toBe(resolve(homedir(), '.kca'));
  });

  it('SWARM_DATA_DIR env overrides default', () => {
    process.env.SWARM_DATA_DIR = '/tmp/custom-kca';
    const config = loadConfig();
    expect(config.dataDir).toBe('/tmp/custom-kca');
  });

  it('swarm data lives under .swarm subdir of dataDir', () => {
    const config = loadConfig();
    const eventLog = join(config.dataDir, '.swarm', 'events', 'current.jsonl');
    const snapshot = join(config.dataDir, '.swarm', 'state.snapshot.json');
    const tasksDir = join(config.dataDir, '.swarm', 'tasks');

    expect(eventLog).toContain('.swarm/events/current.jsonl');
    expect(snapshot).toContain('.swarm/state.snapshot.json');
    expect(tasksDir).toContain('.swarm/tasks');
  });

  it('models default to deepseek provider', () => {
    const config = loadConfig();
    expect(config.models.fast.provider).toBe('deepseek');
    expect(config.models.fast.modelId).toBe('deepseek-v4-flash');
    expect(config.models.balanced.provider).toBe('deepseek');
    expect(config.models.deep.provider).toBe('deepseek');
    expect(config.models.deep.modelId).toBe('deepseek-v4-pro');
  });

  it('defaults isolation to inproc and reads execution env overrides', () => {
    process.env.SWARM_ISOLATION = 'systemd';
    process.env.SWARM_MAX_CONCURRENT_RUNS = '2';
    const config = loadConfig();

    expect(config.isolation).toBe('systemd');
    expect(config.maxConcurrentRuns).toBe(2);
  });
});
