import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  DeleteObjectsCommandOutput,
  GetObjectCommand,
  GetObjectCommandOutput,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { buildObjectPublicUrl, getS3Client, getS3Config } from '../../config/s3';
import {
  BatchTempUploadPresignInput,
  BatchUploadPresignItem,
  DeleteObjectsInput,
  DeleteObjectsResult,
  DeletePresignInput,
  DeletePresignResult,
  DeleteTempObjectsInput,
  DeleteTempObjectsResult,
  FinalizeTempObjectsInput,
  FinalizedObjectResult,
  UploadPresignInput,
  UploadPresignResult,
  ViewPresignInput,
  ViewPresignResult,
} from '../model/s3.model';

const IMAGE_CONTENT_TYPE_PREFIX = 'image/';
const DEFAULT_FOLDER = 'images';

function normalizeFolder(folder?: string): string {
  const value = (folder || DEFAULT_FOLDER).trim().replace(/^\/+|\/+$/g, '');
  return value || DEFAULT_FOLDER;
}

function normalizeKey(key: string): string {
  return key.trim().replace(/^\/+/, '');
}

function normalizeBucket(bucket: string): string {
  return bucket.trim();
}

function normalizeDraftId(draftId: string): string {
  return draftId.trim().replace(/^\/+|\/+$/g, '');
}

function getTempPrefix(userId: string, draftId: string): string {
  return `tmp/${userId}/${draftId}/`;
}

function assertKeyInPrefix(key: string, prefix: string): void {
  if (!key.startsWith(prefix)) {
    throw new Error('Some keys are outside allowed tmp prefix');
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function extractExtension(fileName: string): string {
  const trimmed = fileName.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === trimmed.length - 1) {
    return '';
  }
  return trimmed.slice(dotIndex).toLowerCase();
}

function resolveExpiresSeconds(value: number | undefined, defaultValue: number): number {
  if (!value || !Number.isFinite(value)) return defaultValue;
  return Math.max(60, Math.min(604800, Math.floor(value)));
}

function assertImageContentType(contentType: string): void {
  if (!contentType || !contentType.startsWith(IMAGE_CONTENT_TYPE_PREFIX)) {
    throw new Error('contentType must start with image/');
  }
}

function buildCopySource(bucket: string, key: string): string {
  const encodedKey = key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `/${bucket}/${encodedKey}`;
}

export class S3API {
  async createUploadPresign(input: UploadPresignInput): Promise<UploadPresignResult> {
    const config = getS3Config();
    const bucket = normalizeBucket(input.bucket);
    const contentType = input.contentType.trim();
    const fileName = input.fileName.trim();

    if (!bucket) {
      throw new Error('bucket is required');
    }
    if (!fileName) {
      throw new Error('fileName is required');
    }
    assertImageContentType(contentType);

    const extension = extractExtension(fileName);
    const folder = normalizeFolder(input.folder);
    const key = `${folder}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
    const expiresInSeconds = resolveExpiresSeconds(input.expiresInSeconds, config.presignExpiresSeconds);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds });

    return {
      method: 'PUT',
      url,
      bucket,
      key,
      expiresInSeconds,
      headers: { 'Content-Type': contentType },
      fileUrl: buildObjectPublicUrl(bucket, key),
    };
  }

  async createDeletePresign(input: DeletePresignInput): Promise<DeletePresignResult> {
    const config = getS3Config();
    const bucket = normalizeBucket(input.bucket);
    const key = normalizeKey(input.key);
    if (!bucket) {
      throw new Error('bucket is required');
    }
    if (!key) {
      throw new Error('key is required');
    }

    const expiresInSeconds = resolveExpiresSeconds(input.expiresInSeconds, config.presignExpiresSeconds);

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const url = await getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds });

    return {
      method: 'DELETE',
      url,
      bucket,
      key,
      expiresInSeconds,
    };
  }

  async createViewPresign(input: ViewPresignInput): Promise<ViewPresignResult> {
    const config = getS3Config();
    const bucket = normalizeBucket(input.bucket);
    const key = normalizeKey(input.key);
    if (!bucket) {
      throw new Error('bucket is required');
    }
    if (!key) {
      throw new Error('key is required');
    }

    const expiresInSeconds = resolveExpiresSeconds(input.expiresInSeconds, config.presignExpiresSeconds);
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    const url = await getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds });

    return {
      method: 'GET',
      url,
      bucket,
      key,
      expiresInSeconds,
    };
  }

  async createBatchTempUploadPresign(input: BatchTempUploadPresignInput): Promise<BatchUploadPresignItem[]> {
    const bucket = normalizeBucket(input.bucket);
    const draftId = normalizeDraftId(input.draftId);
    const userId = input.userId.trim();
    const config = getS3Config();
    const expiresInSeconds = resolveExpiresSeconds(input.expiresInSeconds, config.presignExpiresSeconds);

    if (!bucket) throw new Error('bucket is required');
    if (!userId) throw new Error('userId is required');
    if (!draftId) throw new Error('draftId is required');
    if (!Array.isArray(input.files) || input.files.length === 0) {
      throw new Error('files must be a non-empty array');
    }
    if (input.files.length > 20) {
      throw new Error('Maximum 20 files per request');
    }

    const prefix = getTempPrefix(userId, draftId);
    const client = getS3Client();
    const result: BatchUploadPresignItem[] = [];

    for (const file of input.files) {
      const fileName = file.fileName.trim();
      const contentType = file.contentType.trim();
      if (!fileName) throw new Error('fileName is required for every file');
      assertImageContentType(contentType);

      const extension = extractExtension(fileName);
      const key = `${prefix}${randomUUID()}${extension}`;
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      });
      const url = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
      result.push({
        method: 'PUT',
        url,
        bucket,
        key,
        expiresInSeconds,
        headers: { 'Content-Type': contentType },
        fileUrl: buildObjectPublicUrl(bucket, key),
      });
    }

    return result;
  }

  async finalizeTempObjects(input: FinalizeTempObjectsInput): Promise<FinalizedObjectResult[]> {
    const bucket = normalizeBucket(input.bucket);
    const draftId = normalizeDraftId(input.draftId);
    const userId = input.userId.trim();
    const targetFolder = normalizeFolder(input.targetFolder || DEFAULT_FOLDER);
    if (!bucket) throw new Error('bucket is required');
    if (!userId) throw new Error('userId is required');
    if (!draftId) throw new Error('draftId is required');
    if (!Array.isArray(input.keys) || input.keys.length === 0) {
      throw new Error('keys must be a non-empty array');
    }
    if (input.keys.length > 50) {
      throw new Error('Maximum 50 keys per request');
    }

    const client = getS3Client();
    const prefix = getTempPrefix(userId, draftId);
    const output: FinalizedObjectResult[] = [];

    for (const rawKey of input.keys) {
      const fromKey = normalizeKey(rawKey);
      assertKeyInPrefix(fromKey, prefix);
      const extension = extractExtension(fromKey);
      const toKey = `${targetFolder}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;

      await client.send(new CopyObjectCommand({
        Bucket: bucket,
        Key: toKey,
        CopySource: buildCopySource(bucket, fromKey),
      }));

      await client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: fromKey,
      }));

      output.push({
        fromKey,
        toKey,
        fileUrl: buildObjectPublicUrl(bucket, toKey),
      });
    }

    return output;
  }

  async deleteTempObjects(input: DeleteTempObjectsInput): Promise<DeleteTempObjectsResult> {
    const bucket = normalizeBucket(input.bucket);
    const draftId = normalizeDraftId(input.draftId);
    const userId = input.userId.trim();
    if (!bucket) throw new Error('bucket is required');
    if (!userId) throw new Error('userId is required');
    if (!draftId) throw new Error('draftId is required');

    const client = getS3Client();
    const prefix = getTempPrefix(userId, draftId);
    let keysToDelete: string[] = [];

    if (input.keys && input.keys.length > 0) {
      keysToDelete = input.keys.map(normalizeKey);
      for (const key of keysToDelete) {
        assertKeyInPrefix(key, prefix);
      }
    } else {
      let continuationToken: string | undefined = undefined;
      do {
        const listed: ListObjectsV2CommandOutput = await client.send(new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }));

        const keys = (listed.Contents || [])
          .map((item) => item.Key)
          .filter((value): value is string => typeof value === 'string');
        keysToDelete.push(...keys);
        continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
      } while (continuationToken);
    }

    if (keysToDelete.length === 0) {
      return { deletedCount: 0, deletedKeys: [] };
    }

    const deletedKeys: string[] = [];
    for (const chunk of chunkArray(keysToDelete, 1000)) {
      const response: DeleteObjectsCommandOutput = await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: chunk.map((key) => ({ Key: key })),
          Quiet: false,
        },
      }));

      const removed = (response.Deleted || [])
        .map((item) => item.Key)
        .filter((value): value is string => typeof value === 'string');
      deletedKeys.push(...removed);
    }

    return {
      deletedCount: deletedKeys.length,
      deletedKeys,
    };
  }

  async deleteObjects(input: DeleteObjectsInput): Promise<DeleteObjectsResult> {
    const bucket = normalizeBucket(input.bucket);
    if (!bucket) throw new Error('bucket is required');
    if (!Array.isArray(input.keys) || input.keys.length === 0) {
      throw new Error('keys must be a non-empty array');
    }

    const normalizedKeys = input.keys
      .map(normalizeKey)
      .filter((key) => key.length > 0);

    if (normalizedKeys.length === 0) {
      return { deletedCount: 0, deletedKeys: [] };
    }

    const client = getS3Client();
    const deletedKeys: string[] = [];

    for (const key of Array.from(new Set(normalizedKeys))) {
      await client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }));
      deletedKeys.push(key);
    }

    return {
      deletedCount: deletedKeys.length,
      deletedKeys,
    };
  }

  async getObject(bucket: string, key: string): Promise<GetObjectCommandOutput> {
    const normalizedBucket = normalizeBucket(bucket);
    const normalizedKey = normalizeKey(key);
    if (!normalizedBucket) throw new Error('bucket is required');
    if (!normalizedKey) throw new Error('key is required');

    return getS3Client().send(new GetObjectCommand({
      Bucket: normalizedBucket,
      Key: normalizedKey,
    }));
  }
}
