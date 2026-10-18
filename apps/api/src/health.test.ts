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
  const BASE_ENV = {
    DATABASE_URL: 'postgres://x',
    REDIS_URL: 'redis://x',
    S3_ENDPOINT: 'http://s3:8333',
    S3_ACCESS_KEY: 'key',
    S3_SECRET_KEY: 'secret',
    S3_BUCKET: 'bucket',
    ADMIN_PASSWORD: 'a-long-local-password',
  };

  it('defaults the port to 8080', () => {
    expect(loadApiConfig(BASE_ENV).port).toBe(8080);
  });

  it('falls back to the default on a non-numeric port', () => {
    expect(loadApiConfig({ ...BASE_ENV, PORT: 'abc' }).port).toBe(8080);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadApiConfig({ REDIS_URL: 'redis://x' })).toThrow('DATABASE_URL is not set');
  });

  it('needs an admin password of at least 12 characters and defaults the username and cookie flags', () => {
    expect(() => loadApiConfig({ ...BASE_ENV, ADMIN_PASSWORD: 'short' })).toThrow('ADMIN_PASSWORD must be at least 12 characters');
    expect(loadApiConfig(BASE_ENV).auth).toEqual({ adminUsername: 'admin', adminPassword: 'a-long-local-password', sessionTtlHours: 24, isCookieSecure: false });
  });

  it('throws when the S3 bucket is missing', () => {
    const { S3_BUCKET: _omittedBucket, ...environmentWithoutBucket } = BASE_ENV;
    expect(() => loadApiConfig(environmentWithoutBucket)).toThrow('S3_BUCKET is not set');
  });
});
