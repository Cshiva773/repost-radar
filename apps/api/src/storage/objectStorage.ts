import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ObjectStorageConfigDetails } from '../config.js';

export interface ObjectStorageInstance {
  putObject(storageKey: string, fileBuffer: Buffer, contentType: string): Promise<void>;
}

export function createObjectStorage(objectStorageConfig: ObjectStorageConfigDetails): ObjectStorageInstance {
  const s3Client = new S3Client({
    endpoint: objectStorageConfig.endpoint,
    region: objectStorageConfig.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: objectStorageConfig.accessKeyId,
      secretAccessKey: objectStorageConfig.secretAccessKey,
    },
  });

  return {
    async putObject(storageKey, fileBuffer, contentType) {
      await s3Client.send(new PutObjectCommand({
        Bucket: objectStorageConfig.bucketName,
        Key: storageKey,
        Body: fileBuffer,
        ContentType: contentType,
      }));
    },
  };
}
