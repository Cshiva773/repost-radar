import type { Redis } from 'ioredis';
import type pg from 'pg';

export type DependencyStatus = 'up' | 'down';

export interface HealthReportDetails {
  status: 'ok' | 'degraded';
  dependencies: Record<string, DependencyStatus>;
}

export async function checkPostgres(pool: pg.Pool): Promise<DependencyStatus> {
  try {
    await pool.query('SELECT 1');
    return 'up';
  } catch {
    return 'down';
  }
}

export async function checkRedis(redisClient: Redis): Promise<DependencyStatus> {
  try {
    return (await redisClient.ping()) === 'PONG' ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

export function buildHealthReport(dependencyStatusDetails: Record<string, DependencyStatus>): HealthReportDetails {
  const isEveryDependencyUp = Object.values(dependencyStatusDetails).every((status) => status === 'up');
  return { status: isEveryDependencyUp ? 'ok' : 'degraded', dependencies: dependencyStatusDetails };
}
