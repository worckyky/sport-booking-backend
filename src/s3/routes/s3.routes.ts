import { Router, Response } from 'express';
import { Readable } from 'stream';
import type { Pool } from 'pg';
import { authMiddleware, AuthRequest } from '../../authentication/middleware/auth.middleware';
import { ErrorCode, sendError } from '../../utils/errors';
import { S3API } from '../api/s3.api';
import {
  BatchTempUploadPresignRequestBody,
  DeleteBatchRequestBody,
  DeletePresignRequestBody,
  FinalizeTempRequestBody,
  TempDeleteRequestBody,
  UploadPresignRequestBody,
  ViewPresignRequestBody,
} from '../model/s3.model';

export default function createS3Routes(db: Pool): Router {
  const router = Router();
  const s3API = new S3API();

  // POST /s3/presign/upload - presigned URL for image upload
  router.post(
    '/presign/upload',
    authMiddleware(db),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const { bucket, fileName, contentType, folder, expiresInSeconds } = req.body as UploadPresignRequestBody;

        if (!bucket || typeof bucket !== 'string') {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'bucket is required', 'bucket');
        }
        if (!fileName || typeof fileName !== 'string') {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'fileName is required', 'fileName');
        }
        if (!contentType || typeof contentType !== 'string') {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'contentType is required', 'contentType');
        }

        const result = await s3API.createUploadPresign({
          bucket,
          fileName,
          contentType,
          folder,
          expiresInSeconds,
        });

        res.json(result);
      } catch (error) {
        if (error instanceof Error) {
          return sendError(res, 400, ErrorCode.VALIDATION_ERROR, error.message);
        }
        sendError(res, 500, ErrorCode.INTERNAL_ERROR, 'Internal server error');
      }
    }
  );

  // POST /s3/presign/delete - presigned URL for image delete
  router.post(
    '/presign/delete',
    authMiddleware(db),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const { bucket, key, expiresInSeconds } = req.body as DeletePresignRequestBody;

        if (!bucket || typeof bucket !== 'string') {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'bucket is required', 'bucket');
        }
        if (!key || typeof key !== 'string') {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'key is required', 'key');
        }

        const result = await s3API.createDeletePresign({
          bucket,
          key,
          expiresInSeconds,
        });
        res.json(result);
      } catch (error) {
        if (error instanceof Error) {
          return sendError(res, 400, ErrorCode.VALIDATION_ERROR, error.message);
        }
        sendError(res, 500, ErrorCode.INTERNAL_ERROR, 'Internal server error');
      }
    }
  );

  // POST /s3/presign/view - presigned URL for image read (private preview)
  router.post(
    '/presign/view',
    authMiddleware(db),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const { bucket, key, expiresInSeconds } = req.body as ViewPresignRequestBody;

        if (!bucket || typeof bucket !== 'string') {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'bucket is required', 'bucket');
        }
        if (!key || typeof key !== 'string') {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'key is required', 'key');
        }

        const result = await s3API.createViewPresign({
          bucket,
          key,
          expiresInSeconds,
        });
        res.json(result);
      } catch (error) {
        if (error instanceof Error) {
          return sendError(res, 400, ErrorCode.VALIDATION_ERROR, error.message);
        }
        sendError(res, 500, ErrorCode.INTERNAL_ERROR, 'Internal server error');
      }
    }
  );

  // POST /s3/presign/upload/temp/batch - presigned URLs for temporary image upload
  router.post(
    '/presign/upload/temp/batch',
    authMiddleware(db),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const { bucket, draftId, files, expiresInSeconds } = req.body as BatchTempUploadPresignRequestBody;

        if (!req.userId) {
          return sendError(res, 401, ErrorCode.UNAUTHORIZED, 'Unauthorized');
        }
        if (!bucket || typeof bucket !== 'string') {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'bucket is required', 'bucket');
        }
        if (!draftId || typeof draftId !== 'string') {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'draftId is required', 'draftId');
        }
        if (!Array.isArray(files) || files.length === 0) {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'files is required', 'files');
        }

        const result = await s3API.createBatchTempUploadPresign({
          bucket,
          userId: req.userId,
          draftId,
          files: files.map((file) => ({
            fileName: file.fileName || '',
            contentType: file.contentType || '',
          })),
          expiresInSeconds,
        });

        res.json({ items: result });
      } catch (error) {
        if (error instanceof Error) {
          return sendError(res, 400, ErrorCode.VALIDATION_ERROR, error.message);
        }
        sendError(res, 500, ErrorCode.INTERNAL_ERROR, 'Internal server error');
      }
    }
  );

  // POST /s3/finalize/temp - move files from tmp/{userId}/{draftId} to final folder
  router.post(
    '/finalize/temp',
    authMiddleware(db),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const { bucket, draftId, keys, targetFolder } = req.body as FinalizeTempRequestBody;

        if (!req.userId) {
          return sendError(res, 401, ErrorCode.UNAUTHORIZED, 'Unauthorized');
        }
        if (!bucket || typeof bucket !== 'string') {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'bucket is required', 'bucket');
        }
        if (!draftId || typeof draftId !== 'string') {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'draftId is required', 'draftId');
        }
        if (!Array.isArray(keys) || keys.length === 0) {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'keys is required', 'keys');
        }

        const result = await s3API.finalizeTempObjects({
          bucket,
          userId: req.userId,
          draftId,
          keys,
          targetFolder,
        });

        res.json({ items: result });
      } catch (error) {
        if (error instanceof Error) {
          return sendError(res, 400, ErrorCode.VALIDATION_ERROR, error.message);
        }
        sendError(res, 500, ErrorCode.INTERNAL_ERROR, 'Internal server error');
      }
    }
  );

  // POST /s3/temp/delete - delete tmp files for current user draft
  router.post(
    '/temp/delete',
    authMiddleware(db),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const { bucket, draftId, keys } = req.body as TempDeleteRequestBody;

        if (!req.userId) {
          return sendError(res, 401, ErrorCode.UNAUTHORIZED, 'Unauthorized');
        }
        if (!bucket || typeof bucket !== 'string') {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'bucket is required', 'bucket');
        }
        if (!draftId || typeof draftId !== 'string') {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'draftId is required', 'draftId');
        }
        if (keys !== undefined && !Array.isArray(keys)) {
          return sendError(res, 400, ErrorCode.INVALID_FORMAT, 'keys must be an array', 'keys');
        }

        const result = await s3API.deleteTempObjects({
          bucket,
          userId: req.userId,
          draftId,
          keys,
        });

        res.json(result);
      } catch (error) {
        if (error instanceof Error) {
          return sendError(res, 400, ErrorCode.VALIDATION_ERROR, error.message);
        }
        sendError(res, 500, ErrorCode.INTERNAL_ERROR, 'Internal server error');
      }
    }
  );

  // POST /s3/delete/batch - delete final image objects in bucket
  router.post(
    '/delete/batch',
    authMiddleware(db),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const { bucket, keys } = req.body as DeleteBatchRequestBody;

        if (!bucket || typeof bucket !== 'string') {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'bucket is required', 'bucket');
        }
        if (!Array.isArray(keys) || keys.length === 0) {
          return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'keys is required', 'keys');
        }

        const invalidKey = keys.find((key) => typeof key !== 'string' || !key.startsWith('images/'));
        if (invalidKey) {
          return sendError(
            res,
            400,
            ErrorCode.VALIDATION_ERROR,
            'Only keys under images/ can be deleted'
          );
        }

        const result = await s3API.deleteObjects({
          bucket,
          keys,
        });

        res.json(result);
      } catch (error) {
        if (error instanceof Error) {
          return sendError(res, 400, ErrorCode.VALIDATION_ERROR, error.message);
        }
        sendError(res, 500, ErrorCode.INTERNAL_ERROR, 'Internal server error');
      }
    }
  );

  // GET /s3/public/:bucket/* - public proxy for media objects
  router.get('/public/:bucket/*', async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const bucket = req.params.bucket;
      const key = decodeURIComponent(req.params[0] || '');

      if (!bucket) {
        return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'bucket is required', 'bucket');
      }
      if (!key) {
        return sendError(res, 400, ErrorCode.REQUIRED_FIELD, 'key is required', 'key');
      }
      const object = await s3API.getObject(bucket, key);
      const contentType = object.ContentType || 'application/octet-stream';
      if (object.ContentLength !== undefined) {
        res.setHeader('Content-Length', String(object.ContentLength));
      }
      if (object.ETag) {
        res.setHeader('ETag', object.ETag);
      }
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('Content-Type', contentType);

      const body = object.Body as unknown;
      if (body && typeof (body as Readable).pipe === 'function') {
        (body as Readable).pipe(res);
        return;
      }

      sendError(res, 500, ErrorCode.INTERNAL_ERROR, 'Object body stream is not available');
    } catch (error) {
      if (error instanceof Error && error.name === 'NoSuchKey') {
        return sendError(res, 404, ErrorCode.NOT_FOUND, 'Object not found');
      }
      sendError(res, 500, ErrorCode.INTERNAL_ERROR, 'Failed to read object');
    }
  });

  return router;
}
