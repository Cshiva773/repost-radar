import { describe, expect, it } from 'vitest';
import { loadCrawlerConfig } from './config.js';

const BASE_ENV = {
  DATABASE_URL: 'postgres://x',
  REDIS_URL: 'redis://x',
  S3_ENDPOINT: 'http://s3:8333',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
  S3_BUCKET: 'bucket',
};

describe('loadCrawlerConfig', () => {
  it('defaults the tick to 60 seconds', () => {
    expect(loadCrawlerConfig(BASE_ENV).tickSeconds).toBe(60);
  });

  it('clamps a tiny tick to the 5 second floor', () => {
    expect(loadCrawlerConfig({ ...BASE_ENV, CRAWLER_TICK_SECONDS: '1' }).tickSeconds).toBe(5);
  });

  it('ignores a non-numeric tick', () => {
    expect(loadCrawlerConfig({ ...BASE_ENV, CRAWLER_TICK_SECONDS: 'soon' }).tickSeconds).toBe(60);
  });

  it('throws when REDIS_URL is missing', () => {
    const { REDIS_URL: _omittedRedis, ...environmentWithoutRedis } = BASE_ENV;
    expect(() => loadCrawlerConfig(environmentWithoutRedis)).toThrow('REDIS_URL is not set');
  });

});
