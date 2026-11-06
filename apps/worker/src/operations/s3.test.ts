import { S3Client } from '@aws-sdk/client-s3';
import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { uploadArchive } from './s3.ts';

it('uploads only the provided ciphertext, checksums it and recreates the stream after a retry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobpilot-s3-test-')),
    file = join(dir, 'archive.age');
  const bytes = Buffer.concat([
    Buffer.from('age-encryption.org/v1\n'),
    randomBytes(128),
  ]);
  await writeFile(file, bytes);
  let attempts = 0;
  const bodies: Buffer[] = [];
  const client = new S3Client({
    region: 'us-east-1',
    endpoint: 'https://s3.example.invalid',
    forcePathStyle: true,
    maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: randomBytes(12).toString('hex'),
      secretAccessKey: randomBytes(32).toString('hex'),
    },
    requestHandler: {
      async handle(request: {
        body: unknown;
        headers: Record<string, string>;
        path: string;
      }) {
        attempts++;
        const chunks: Buffer[] = [];
        for await (const chunk of request.body as AsyncIterable<Buffer>)
          chunks.push(chunk);
        bodies.push(Buffer.concat(chunks));
        expect(request.headers['content-md5']).toBe(
          createHash('md5').update(bytes).digest('base64'),
        );
        expect(request.path).toBe(
          '/synthetic-bucket/jobpilot/archive.dump.age',
        );
        return {
          response: {
            statusCode: attempts === 1 ? 503 : 200,
            headers: { 'content-type': 'application/xml' },
            body: Readable.from(
              attempts === 1 ? ['<Error><Code>SlowDown</Code></Error>'] : [],
            ),
          },
        };
      },
    },
  });
  try {
    await uploadArchive(
      client,
      'synthetic-bucket',
      file,
      'jobpilot/archive.dump.age',
      bytes.length,
    );
    expect(attempts).toBe(2);
    expect(bodies).toEqual([bytes, bytes]);
  } finally {
    client.destroy();
    await rm(dir, { recursive: true, force: true });
  }
});
it('does not retry a rejected S3 credential or expose its error details', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobpilot-s3-test-')),
    file = join(dir, 'archive.age');
  await writeFile(file, 'ciphertext');
  let attempts = 0;
  const client = new S3Client({
    region: 'us-east-1',
    endpoint: 'https://s3.example.invalid',
    maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: randomBytes(12).toString('hex'),
      secretAccessKey: randomBytes(32).toString('hex'),
    },
    requestHandler: {
      async handle() {
        attempts++;
        return {
          response: {
            statusCode: 403,
            headers: { 'content-type': 'application/xml' },
            body: Readable.from([
              '<Error><Code>AccessDenied</Code><Message>Private provider details</Message></Error>',
            ]),
          },
        };
      },
    },
  });
  try {
    await expect(
      uploadArchive(client, 'synthetic-bucket', file, 'archive.age', 10),
    ).rejects.toThrow('Backup upload failed');
    expect(attempts).toBe(1);
  } finally {
    client.destroy();
    await rm(dir, { recursive: true, force: true });
  }
});
