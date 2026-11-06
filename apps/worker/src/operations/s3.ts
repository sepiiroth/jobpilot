import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { OperationsEnvironment } from '@jobpilot/shared/operations';
import { encryptedBackup } from './backup.ts';

export function backupClient(config: OperationsEnvironment) {
  return new S3Client({
    endpoint: config.BACKUP_S3_ENDPOINT,
    region: config.BACKUP_S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.BACKUP_S3_ACCESS_KEY,
      secretAccessKey: config.BACKUP_S3_SECRET_KEY,
    },
    maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: {
      connectionTimeout: 5000,
      requestTimeout: 60000,
      throwOnRequestTimeout: true,
    },
  });
}
export async function uploadArchive(
  client: S3Client,
  bucket: string,
  file: string,
  key: string,
  size: number,
) {
  const hash = createHash('md5');
  for await (const chunk of createReadStream(file))
    hash.update(chunk as Buffer);
  const checksum = hash.digest('base64');
  for (let attempt = 0; attempt < 3; attempt++) {
    const body = createReadStream(file);
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentLength: size,
          ContentMD5: checksum,
          ContentType: 'application/octet-stream',
        }),
        { abortSignal: AbortSignal.timeout(90000) },
      );
      return;
    } catch (error) {
      const status =
        typeof error === 'object' && error !== null && '$metadata' in error
          ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
          : undefined;
      if (
        attempt === 2 ||
        (status !== undefined && status < 500 && status !== 429)
      )
        throw new Error('Backup upload failed');
      await delay(500 * 2 ** attempt);
    } finally {
      body.destroy();
    }
  }
}
export async function backupToS3(
  config: OperationsEnvironment & { DATABASE_URL: string },
) {
  const client = backupClient(config);
  try {
    await encryptedBackup(
      config.DATABASE_URL,
      config.BACKUP_AGE_RECIPIENT,
      (file, key, size) =>
        uploadArchive(client, config.BACKUP_S3_BUCKET, file, key, size),
    );
  } finally {
    client.destroy();
  }
}
