import { S3Client } from '@aws-sdk/client-s3';

export interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  presignExpiresSeconds: number;
  publicBaseUrl?: string;
}

let s3Client: S3Client | null = null;

function readFirstDefined(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

function readBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value === 'true';
}

function readNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(60, Math.min(604800, Math.floor(parsed)));
}

function trimRightSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getS3Config(): S3Config {
  const endpoint = readFirstDefined('S3_ENDPOINT', 'MINIO_SERVER_URL');
  const accessKeyId = readFirstDefined('S3_ACCESS_KEY_ID', 'MINIO_ROOT_USER', 'SERVICE_USER_MINIO');
  const secretAccessKey = readFirstDefined('S3_SECRET_ACCESS_KEY', 'MINIO_ROOT_PASSWORD', 'SERVICE_PASSWORD_MINIO');
  const publicBaseUrl = readFirstDefined('S3_PUBLIC_BASE_URL');

  if (!endpoint) {
    throw new Error('Missing S3_ENDPOINT (or MINIO_SERVER_URL) env var');
  }
  if (!accessKeyId) {
    throw new Error('Missing S3_ACCESS_KEY_ID (or MINIO_ROOT_USER/SERVICE_USER_MINIO) env var');
  }
  if (!secretAccessKey) {
    throw new Error('Missing S3_SECRET_ACCESS_KEY (or MINIO_ROOT_PASSWORD/SERVICE_PASSWORD_MINIO) env var');
  }

  return {
    endpoint: trimRightSlash(endpoint),
    region: process.env.S3_REGION || 'us-east-1',
    accessKeyId,
    secretAccessKey,
    forcePathStyle: readBoolean(process.env.S3_FORCE_PATH_STYLE, true),
    presignExpiresSeconds: readNumber(process.env.S3_PRESIGN_EXPIRES_SECONDS, 900),
    publicBaseUrl: publicBaseUrl
      ? trimRightSlash(publicBaseUrl)
      : undefined,
  };
}

export function getS3Client(): S3Client {
  if (s3Client) return s3Client;

  const config = getS3Config();
  s3Client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return s3Client;
}

export function buildObjectPublicUrl(bucket: string, key: string): string {
  const config = getS3Config();
  const normalizedKey = key.replace(/^\/+/, '');

  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl}/${bucket}/${normalizedKey}`;
  }

  return `${config.endpoint}/${bucket}/${normalizedKey}`;
}
