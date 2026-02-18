export interface UploadPresignInput {
  bucket: string;
  fileName: string;
  contentType: string;
  folder?: string;
  expiresInSeconds?: number;
}

export interface DeletePresignInput {
  bucket: string;
  key: string;
  expiresInSeconds?: number;
}

export interface ViewPresignInput {
  bucket: string;
  key: string;
  expiresInSeconds?: number;
}

export interface BatchUploadFileInput {
  fileName: string;
  contentType: string;
}

export interface BatchTempUploadPresignInput {
  bucket: string;
  userId: string;
  draftId: string;
  files: BatchUploadFileInput[];
  expiresInSeconds?: number;
}

export interface FinalizeTempObjectsInput {
  bucket: string;
  userId: string;
  draftId: string;
  keys: string[];
  targetFolder?: string;
}

export interface DeleteTempObjectsInput {
  bucket: string;
  userId: string;
  draftId: string;
  keys?: string[];
}

export interface UploadPresignResult {
  method: 'PUT';
  url: string;
  bucket: string;
  key: string;
  expiresInSeconds: number;
  headers: { 'Content-Type': string };
  fileUrl: string;
}

export interface DeletePresignResult {
  method: 'DELETE';
  url: string;
  bucket: string;
  key: string;
  expiresInSeconds: number;
}

export interface ViewPresignResult {
  method: 'GET';
  url: string;
  bucket: string;
  key: string;
  expiresInSeconds: number;
}

export interface BatchUploadPresignItem extends UploadPresignResult {}

export interface FinalizedObjectResult {
  fromKey: string;
  toKey: string;
  fileUrl: string;
}

export interface DeleteTempObjectsResult {
  deletedCount: number;
  deletedKeys: string[];
}

export interface UploadPresignRequestBody {
  bucket?: string;
  fileName?: string;
  contentType?: string;
  folder?: string;
  expiresInSeconds?: number;
}

export interface DeletePresignRequestBody {
  bucket?: string;
  key?: string;
  expiresInSeconds?: number;
}

export interface ViewPresignRequestBody {
  bucket?: string;
  key?: string;
  expiresInSeconds?: number;
}

export interface BatchTempUploadPresignRequestBody {
  bucket?: string;
  draftId?: string;
  files?: Array<{ fileName?: string; contentType?: string }>;
  expiresInSeconds?: number;
}

export interface FinalizeTempRequestBody {
  bucket?: string;
  draftId?: string;
  keys?: string[];
  targetFolder?: string;
}

export interface TempDeleteRequestBody {
  bucket?: string;
  draftId?: string;
  keys?: string[];
}

export interface DeleteObjectsInput {
  bucket: string;
  keys: string[];
}

export interface DeleteObjectsResult {
  deletedCount: number;
  deletedKeys: string[];
}

export interface DeleteBatchRequestBody {
  bucket?: string;
  keys?: string[];
}
