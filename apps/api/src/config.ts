const DEFAULT_PORT = 8080;
const DEFAULT_LOG_LEVEL = 'info';
const DEFAULT_S3_REGION = 'us-east-1';

export interface ObjectStorageConfigDetails {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  region: string;
}

export interface ApiConfigDetails {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  logLevel: string;
  objectStorage: ObjectStorageConfigDetails;
}

function readRequiredEnv(environmentDetails: NodeJS.ProcessEnv, variableName: string): string {
  const variableValue = environmentDetails[variableName];
  if (!variableValue) throw new Error(`${variableName} is not set`);
  return variableValue;
}

function loadObjectStorageConfig(environmentDetails: NodeJS.ProcessEnv): ObjectStorageConfigDetails {
  return {
    endpoint: readRequiredEnv(environmentDetails, 'S3_ENDPOINT'),
    accessKeyId: readRequiredEnv(environmentDetails, 'S3_ACCESS_KEY'),
    secretAccessKey: readRequiredEnv(environmentDetails, 'S3_SECRET_KEY'),
    bucketName: readRequiredEnv(environmentDetails, 'S3_BUCKET'),
    region: environmentDetails.S3_REGION ?? DEFAULT_S3_REGION,
  };
}

export function loadApiConfig(environmentDetails: NodeJS.ProcessEnv = process.env): ApiConfigDetails {
  const parsedPort = Number(environmentDetails.PORT ?? DEFAULT_PORT);
  return {
    port: Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT,
    databaseUrl: readRequiredEnv(environmentDetails, 'DATABASE_URL'),
    redisUrl: readRequiredEnv(environmentDetails, 'REDIS_URL'),
    logLevel: environmentDetails.LOG_LEVEL ?? DEFAULT_LOG_LEVEL,
    objectStorage: loadObjectStorageConfig(environmentDetails),
  };
}
