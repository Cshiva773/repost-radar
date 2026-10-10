import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ObjectStorageConfigDetails } from '../config.js';

export interface StoredObjectDetails {
  bodyStream: Readable;
  contentType: string | undefined;
  contentLength: number | undefined;
}

export interface ObjectStorageInstance {
  putObject(storageKey: string, fileBuffer: Buffer, contentType: string): Promise<void>;
  /** undefined when the key does not exist (for example a crawled image removed by retention) */
  getObject(storageKey: string): Promise<StoredObjectDetails | undefined>;
  deleteObject(storageKey: string): Promise<void>;
}

function isMissingKeyError(error: unknown): boolean {
  const errorName = (error as { name?: string }).name;
  return errorName === 'NoSuchKey' || errorName === 'NotFound';
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
    async deleteObject(storageKey) {
      await s3Client.send(new DeleteObjectCommand({ Bucket: objectStorageConfig.bucketName, Key: storageKey }));
    },
    async getObject(storageKey) {
      try {
        const objectResponse = await s3Client.send(new GetObjectCommand({ Bucket: objectStorageConfig.bucketName, Key: storageKey }));
        return { bodyStream: objectResponse.Body as Readable, contentType: objectResponse.ContentType, contentLength: objectResponse.ContentLength };
      } catch (error) {
        if (isMissingKeyError(error)) return undefined;
        throw error;
      }
    },
  };
}
