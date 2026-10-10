import { parseEnabledPlatforms } from '@repost-radar/platforms';

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
  /** Platforms creators may add watch targets for (ENABLED_PLATFORMS, default "reddit") */
  enabledPlatformList: string[];
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

function loadEnabledPlatforms(environmentDetails: NodeJS.ProcessEnv): string[] {
  const { enabledPlatformList, unknownPlatformList } = parseEnabledPlatforms(environmentDetails.ENABLED_PLATFORMS);
  if (unknownPlatformList.length) throw new Error(`ENABLED_PLATFORMS has unknown platform(s): ${unknownPlatformList.join(', ')}`);
  return enabledPlatformList;
}

export function loadApiConfig(environmentDetails: NodeJS.ProcessEnv = process.env): ApiConfigDetails {
  const parsedPort = Number(environmentDetails.PORT ?? DEFAULT_PORT);
  return {
    port: Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT,
    databaseUrl: readRequiredEnv(environmentDetails, 'DATABASE_URL'),
    redisUrl: readRequiredEnv(environmentDetails, 'REDIS_URL'),
    logLevel: environmentDetails.LOG_LEVEL ?? DEFAULT_LOG_LEVEL,
    objectStorage: loadObjectStorageConfig(environmentDetails),
    enabledPlatformList: loadEnabledPlatforms(environmentDetails),
  };
}
