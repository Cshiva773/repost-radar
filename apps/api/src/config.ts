const DEFAULT_PORT = 8080;
const DEFAULT_LOG_LEVEL = 'info';

export interface ApiConfigDetails {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  logLevel: string;
}

function readRequiredEnv(environmentDetails: NodeJS.ProcessEnv, variableName: string): string {
  const variableValue = environmentDetails[variableName];
  if (!variableValue) throw new Error(`${variableName} is not set`);
  return variableValue;
}

export function loadApiConfig(environmentDetails: NodeJS.ProcessEnv = process.env): ApiConfigDetails {
  const parsedPort = Number(environmentDetails.PORT ?? DEFAULT_PORT);
  return {
    port: Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT,
    databaseUrl: readRequiredEnv(environmentDetails, 'DATABASE_URL'),
    redisUrl: readRequiredEnv(environmentDetails, 'REDIS_URL'),
    logLevel: environmentDetails.LOG_LEVEL ?? DEFAULT_LOG_LEVEL,
  };
}
