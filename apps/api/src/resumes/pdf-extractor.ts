import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { ApiError } from '../common/errors.ts';
export class PdfExtractor {
  private active = 0;
  async extract(pdf: Buffer): Promise<string> {
    if (pdf.length > 5 * 1024 * 1024)
      throw new ApiError(413, 'PDF_TOO_LARGE', 'PDF exceeds 5 MiB');
    if (pdf.subarray(0, 5).toString() !== '%PDF-')
      throw new ApiError(415, 'INVALID_PDF', 'Invalid PDF signature');
    if (this.active >= 2)
      throw new ApiError(429, 'PDF_BUSY', 'PDF extraction is busy');
    this.active++;
    const worker = new Worker(
      new URL('./pdf-extractor.worker.mjs', import.meta.url),
      {
        workerData: {
          pdf: new Uint8Array(pdf),
          module: createRequire(import.meta.url).resolve('unpdf'),
        },
        resourceLimits: { maxOldGenerationSizeMb: 128 },
        execArgv: [],
        stdout: true,
        stderr: true,
      },
    );
    worker.stdout?.resume();
    worker.stderr?.resume();
    try {
      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          void worker.terminate();
          reject(new ApiError(422, 'PDF_TIMEOUT', 'PDF processing timed out'));
        }, 15000);
        worker.once('message', (message: unknown) => {
          clearTimeout(timer);
          if (
            typeof message === 'object' &&
            message !== null &&
            'text' in message &&
            typeof message.text === 'string' &&
            message.text.trim()
          )
            resolve(message.text);
          else
            reject(
              new ApiError(
                422,
                'PDF_UNREADABLE',
                'PDF contains no usable text or exceeds processing limits',
              ),
            );
        });
        worker.once('error', () => {
          clearTimeout(timer);
          reject(
            new ApiError(422, 'PDF_UNREADABLE', 'PDF could not be processed'),
          );
        });
        worker.once('exit', (code) => {
          clearTimeout(timer);
          if (code !== 0)
            reject(
              new ApiError(422, 'PDF_UNREADABLE', 'PDF could not be processed'),
            );
        });
      });
    } finally {
      await worker.terminate();
      this.active--;
    }
  }
}
