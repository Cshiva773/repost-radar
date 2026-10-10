import { describe, expect, it } from 'vitest';
import { buildHealthReport } from './health.js';
import { loadApiConfig } from './config.js';

describe('buildHealthReport', () => {
  it('is ok when every dependency is up', () => {
    expect(buildHealthReport({ postgres: 'up', redis: 'up' }).status).toBe('ok');
  });

  it('is degraded when any dependency is down', () => {
    const healthReport = buildHealthReport({ postgres: 'up', redis: 'down' });
    expect(healthReport.status).toBe('degraded');
    expect(healthReport.dependencies.redis).toBe('down');
  });
});

describe('loadApiConfig', () => {
  const BASE_ENV = { DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x' };

  it('defaults the port to 8080', () => {
    expect(loadApiConfig(BASE_ENV).port).toBe(8080);
  });

  it('falls back to the default on a non-numeric port', () => {
    expect(loadApiConfig({ ...BASE_ENV, PORT: 'abc' }).port).toBe(8080);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadApiConfig({ REDIS_URL: 'redis://x' })).toThrow('DATABASE_URL is not set');
  });
});
